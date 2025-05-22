import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const TEMP_FRAMES_BASE_DIR = path.join(process.cwd(), 'public', 'temp_frames');

interface FfprobeData {
  streams: {
    codec_type?: string;
    r_frame_rate?: string; // e.g., "25/1"
    avg_frame_rate?: string; // e.g., "25/1"
    duration?: string; // e.g., "10.5"
    nb_frames?: string; // Number of frames as a string
  }[];
  format: {
    duration?: string; // e.g., "10.5"
    nb_frames?: string; // Total frames in container
  };
}

/**
 * Extracts a specific number of frames from a video file.
 *
 * @param videoPath Absolute path to the input video file.
 * @param videoIdentifier A unique identifier for the video (e.g., original name or a UUID)
 *                        to create a unique sub-folder for its frames.
 * @param targetFrames The desired number of frames to extract.
 * @param outputDirBase Base directory to save frames (e.g., 'public/temp_frames/').
 *                      The function will create a subdirectory inside this.
 * @returns A Promise that resolves to an array of absolute file paths for the extracted frames.
 */
export async function extractFrames(
  videoPath: string,
  videoIdentifier: string, // Using a generic identifier
  targetFrames: number,
  outputDirBase: string = TEMP_FRAMES_BASE_DIR
): Promise<string[]> {
  return new Promise(async (resolve, reject) => {
    if (!fs.existsSync(videoPath)) {
      return reject(new Error(`Video file not found: ${videoPath}`));
    }
    if (targetFrames <= 0) {
        return reject(new Error('targetFrames must be a positive number.'));
    }

    let metadata: FfprobeData;
    try {
      metadata = await new Promise<FfprobeData>((resolveMeta, rejectMeta) => {
        ffmpeg.ffprobe(videoPath, (err, data) => {
          if (err) {
            return rejectMeta(new Error(`ffprobe error: ${err.message}`));
          }
          resolveMeta(data as FfprobeData); // Cast as FfprobeData, actual structure might vary
        });
      });
    } catch (error) {
      return reject(error);
    }

    const videoStream = metadata.streams.find(s => s.codec_type === 'video');
    let duration = parseFloat(videoStream?.duration || metadata.format?.duration || '0');
    
    // Fallback for FPS if r_frame_rate is not available or invalid
    let fpsString = videoStream?.r_frame_rate || videoStream?.avg_frame_rate || "0/0";
    let fpsParts = fpsString.split('/').map(Number);
    let fps = (fpsParts.length === 2 && fpsParts[1] !== 0) ? (fpsParts[0] / fpsParts[1]) : 30; // Default to 30 if unknown

    if (isNaN(duration)) duration = 0;
    if (isNaN(fps) || fps === 0) fps = 30; // Default to 30 FPS if not correctly determined or zero

    // Use a UUID for the output sub-directory to ensure uniqueness and avoid sanitization issues
    const uniqueOutputSubDirName = uuidv4();
    const outputDirForThisVideo = path.join(outputDirBase, uniqueOutputSubDirName);

    try {
      if (!fs.existsSync(outputDirForThisVideo)) {
        fs.mkdirSync(outputDirForThisVideo, { recursive: true });
      }
    } catch (error: any) {
      return reject(new Error(`Failed to create output directory ${outputDirForThisVideo}: ${error.message}`));
    }

    const outputPattern = path.join(outputDirForThisVideo, 'frame_%04d.png');
    let actualExtractedFrameCount = 0;

    try {
      if (duration <= 0 || fps <= 0) {
        // If duration or FPS is unknown/zero, try to extract just one frame (the first one)
        // and then pad it. This is a fallback.
        console.warn(`Video ${videoIdentifier} has duration ${duration}s or FPS ${fps}. Attempting to extract first frame only.`);
        await new Promise<void>((resolveCmd, rejectCmd) => {
            ffmpeg(videoPath)
              .outputOptions(['-vframes', '1'])
              .output(outputPattern) // Will produce frame_0001.png
              .on('end', () => {
                actualExtractedFrameCount = 1; // We expect 1 frame
                resolveCmd();
              })
              .on('error', (err) => rejectCmd(new Error(`ffmpeg (single frame) error: ${err.message}`)))
              .run();
          });

      } else {
        // Normal case: duration and FPS are known
        // The -vf "fps=..." option selects frames based on time, so it should give `targetFrames`
        // spread across the duration.
        // Use vsync vfr to prevent duplicate frames if source fps is lower than requested output.
        await new Promise<void>((resolveCmd, rejectCmd) => {
          ffmpeg(videoPath)
            .outputOptions([
              '-vf', `fps=${targetFrames}/${duration}`,
              '-vsync', 'vfr' // Variable frame rate sync; important for getting correct number of frames
            ])
            .output(outputPattern)
            .on('end', () => {
              // ffmpeg with fps filter might not produce exact number of frames
              // We will count them from the directory
              resolveCmd();
            })
            .on('error', (err) => rejectCmd(new Error(`ffmpeg (multi-frame) error: ${err.message}`)))
            .run();
        });
      }

      // List extracted frames
      const extractedFrameFiles = fs.readdirSync(outputDirForThisVideo)
        .filter(file => file.startsWith('frame_') && file.endsWith('.png'))
        .sort(); // Ensure order: frame_0001, frame_0002 ...

      actualExtractedFrameCount = extractedFrameFiles.length;
      let framePaths: string[] = extractedFrameFiles.map(file => path.join(outputDirForThisVideo, file));

      if (actualExtractedFrameCount === 0 && targetFrames > 0) {
        // This can happen if ffmpeg fails silently to extract frames or video is truly empty
        return reject(new Error(`No frames were extracted for video ${videoIdentifier}. Check video validity and ffmpeg logs.`));
      }

      // Padding: If fewer frames were extracted than targetFrames, duplicate the last one.
      if (actualExtractedFrameCount < targetFrames && actualExtractedFrameCount > 0) {
        const lastFramePath = framePaths[actualExtractedFrameCount - 1];
        for (let i = actualExtractedFrameCount; i < targetFrames; i++) {
          framePaths.push(lastFramePath); // Add path to the last valid frame
        }
      } else if (actualExtractedFrameCount > targetFrames) {
        // If ffmpeg extracted more frames than requested (can happen with some fps filter rounding),
        // truncate to targetFrames. This is less common with vsync vfr.
        framePaths = framePaths.slice(0, targetFrames);
      }


      if (framePaths.length === 0 && targetFrames > 0) {
        // If after all logic, framePaths is empty and we expected frames, this is an issue.
        return reject(new Error(`Frame extraction resulted in an empty list for ${videoIdentifier}, expected ${targetFrames} frames.`));
      }
      
      resolve(framePaths);

    } catch (error: any) {
      // Cleanup partially created directory if errors occur during ffmpeg or file listing
      if (fs.existsSync(outputDirForThisVideo)) {
        fs.rm(outputDirForThisVideo, { recursive: true, force: true }, (err) => {
            if (err) console.error(`Error cleaning up directory ${outputDirForThisVideo}:`, err);
        });
      }
      reject(error);
    }
  });
}

/**
 * Creates a video from a sequence of image frames.
 *
 * @param inputFramesDir Directory containing the sequentially named input frames (e.g., frame_0001.png).
 * @param framePattern The pattern for input frames (e.g., 'frame_%04d.png').
 * @param outputVideoPath Absolute path to save the output video.
 * @param fps Frames per second for the output video.
 * @param videoSize Dimensions of the video.
 * @returns A Promise that resolves when video creation is complete, or rejects on error.
 */
export async function createVideoFromFrames(
  inputFramesDir: string,
  framePattern: string, // e.g., "frame_%04d.png"
  outputVideoPath: string,
  fps: number,
  videoSize: { width: number; height: number }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const inputPath = path.join(inputFramesDir, framePattern);

    if (!fs.existsSync(inputFramesDir)) {
        return reject(new Error(`Input frames directory not found: ${inputFramesDir}`));
    }
    
    // Check if there are any files matching the pattern to prevent ffmpeg erroring on empty input
    // This is a basic check; ffmpeg might still error if files are not valid images etc.
    const files = fs.readdirSync(inputFramesDir);
    const frameFiles = files.filter(f => f.match(new RegExp(framePattern.replace('%04d', '\\d{4}')))); // Basic regex match
    if (frameFiles.length === 0) {
        return reject(new Error(`No frames found in ${inputFramesDir} matching pattern ${framePattern}`));
    }


    ffmpeg()
      .input(inputPath)
      .inputOptions([
        `-framerate ${fps}`,
        // '-start_number 0' // Assuming frames start from 0 or 1, e.g. frame_0000.png or frame_0001.png
                           // ffmpeg usually auto-detects start_number for image sequences if pattern is standard.
      ])
      .outputOptions([
        '-c:v libx264',      // Video codec
        '-pix_fmt yuv420p',  // Pixel format for broad compatibility
        `-s ${videoSize.width}x${videoSize.height}`, // Output video size
        '-preset fast',      // Encoding speed/quality trade-off
        '-crf 23'            // Constant Rate Factor (quality, lower is better, 18-28 is common)
      ])
      .output(outputVideoPath)
      .on('start', (commandLine) => {
        console.log('Spawned Ffmpeg with command: ' + commandLine);
      })
      .on('end', () => {
        resolve();
      })
      .on('error', (err, stdout, stderr) => {
        console.error('FFmpeg stdout:', stdout);
        console.error('FFmpeg stderr:', stderr);
        reject(new Error(`FFmpeg error creating video: ${err.message}`));
      })
      .run();
  });
}
