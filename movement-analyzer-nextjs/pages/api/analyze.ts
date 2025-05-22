import type { NextApiRequest, NextApiResponse } from 'next';
import formidable, { File as FormidableFile, Fields as FormidableFields, Files as FormidableFiles } from 'formidable';
import fs from 'fs';
import path from 'path';
import ffmpeg, { FfprobeData } from 'fluent-ffmpeg';
import { v4 as uuidv4 } from 'uuid';
import { loadImage, Image as CanvasImage } from 'canvas'; // For getImageDimensions

// Import utility functions
import { extractFrames, createVideoFromFrames } from '../../utils/video_processing';
import { estimatePosesForFrames } from '../../utils/pose_estimation';
import { drawPoseOnFrame } from '../../utils/drawing_utils';
import { calculateSimilarity } from '../../utils/analysis';

// Disable Next.js body parser for this route to use formidable
export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_SHORT_VIDEO_DURATION_S = 5;
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const PROCESSED_VIDEOS_DIR_PUBLIC = path.join(process.cwd(), 'public', 'processed_videos'); // For final videos
const BASE_TEMP_DIR = path.join(process.cwd(), 'public', 'temp_processing'); // For intermediate files

// Ensure directories exist
[UPLOAD_DIR, PROCESSED_VIDEOS_DIR_PUBLIC, BASE_TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

interface FormidableParseResult {
  fields: FormidableFields;
  files: FormidableFiles;
}

interface ApiErrorResponse {
  success: false;
  error: string;
  details?: any;
}

interface ApiSuccessResponse {
  success: true;
  message?: string; // Optional for success
  annotated_short_video_url: string;
  annotated_reference_video_url: string;
  similarity_score: number;
  analysis_text: string;
}

interface VideoMetadata {
    duration: number;
    width: number;
    height: number;
    fps: number;
}

// Helper function to get video metadata including dimensions and FPS
async function getVideoMetadata(filePath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata: FfprobeData) => {
            if (err) {
                return reject(new Error(`ffprobe error: ${err.message}`));
            }
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            if (!videoStream || typeof videoStream.duration !== 'string' || 
                !videoStream.width || !videoStream.height || !videoStream.r_frame_rate) {
                return reject(new Error('Essential video metadata (duration, width, height, fps) not found.'));
            }
            const duration = parseFloat(videoStream.duration);
            const fpsString = videoStream.r_frame_rate;
            const [num, den] = fpsString.split('/').map(Number);
            const fps = den && num ? num / den : 30; // Default to 30 if parsing fails

            resolve({
                duration,
                width: videoStream.width,
                height: videoStream.height,
                fps: fps,
            });
        });
    });
}

// Helper to get image dimensions (fallback if needed, primary is ffprobe)
async function getImageDimensions(imagePath: string): Promise<{width: number, height: number}> {
  const image = await loadImage(imagePath);
  return {width: image.width, height: image.height};
}


export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiSuccessResponse | ApiErrorResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: `Method ${req.method} Not Allowed` });
  }

  const runId = uuidv4();
  const runTempDir = path.join(BASE_TEMP_DIR, runId);

  let shortVideoFile: FormidableFile | undefined = undefined;
  let referenceVideoFile: FormidableFile | undefined = undefined;
  let uploadedFilePaths: string[] = []; // Keep track of originally uploaded files for cleanup

  try {
    // 1. Parse form data (videos and targetFrames)
    const form = formidable({
      uploadDir: UPLOAD_DIR,
      keepExtensions: true,
      filename: () => `${uuidv4()}_upload${path.extname(arguments[2]?.originalFilename || '.tmp')}`, // Use original ext
      maxFileSize: 200 * 1024 * 1024,
    });
    
    const { fields, files } = await new Promise<FormidableParseResult>((resolve, reject) => {
      form.parse(req, (err, parsedFields, parsedFiles) => {
        if (err) return reject(err);
        resolve({ fields: parsedFields, files: parsedFiles });
      });
    });

    shortVideoFile = files.short_video?.[0];
    referenceVideoFile = files.reference_video?.[0];

    if (!shortVideoFile || !referenceVideoFile) {
      return res.status(400).json({ success: false, error: 'Missing video files. Expected "short_video" and "reference_video".' });
    }
    uploadedFilePaths.push(shortVideoFile.filepath, referenceVideoFile.filepath);

    let targetFrames: number;
    const targetFramesValue = fields.targetFrames?.[0];
    if (typeof targetFramesValue === 'string') targetFrames = parseInt(targetFramesValue, 10);
    else targetFrames = 30;
    if (isNaN(targetFrames) || targetFrames < 10 || targetFrames > 60) {
      targetFrames = 30;
      console.warn(`RunID ${runId}: Invalid targetFrames value. Defaulting to 30.`);
    }

    // 2. Initial Validation & Metadata Extraction
    const shortVideoMetadata = await getVideoMetadata(shortVideoFile.filepath);
    if (shortVideoMetadata.duration > MAX_SHORT_VIDEO_DURATION_S) {
      return res.status(400).json({ success: false, error: `Short video exceeds ${MAX_SHORT_VIDEO_DURATION_S}s. Duration: ${shortVideoMetadata.duration.toFixed(2)}s` });
    }
    const refVideoMetadata = await getVideoMetadata(referenceVideoFile.filepath);

    // 3. Define Paths & Create Temporary Directories for this run
    const shortFramesDir = path.join(runTempDir, 'short_frames');
    const refFramesDir = path.join(runTempDir, 'ref_frames');
    const shortAnnotatedFramesDir = path.join(runTempDir, 'short_annotated_frames');
    const refAnnotatedFramesDir = path.join(runTempDir, 'ref_annotated_frames');
    [shortFramesDir, refFramesDir, shortAnnotatedFramesDir, refAnnotatedFramesDir].forEach(dir => {
      fs.mkdirSync(dir, { recursive: true });
    });

    const annotatedShortVideoName = `${runId}_short_annotated.mp4`;
    const annotatedRefVideoName = `${runId}_ref_annotated.mp4`;
    const outputAnnotatedShortVideoPathAbs = path.join(PROCESSED_VIDEOS_DIR_PUBLIC, annotatedShortVideoName);
    const outputAnnotatedRefVideoPathAbs = path.join(PROCESSED_VIDEOS_DIR_PUBLIC, annotatedRefVideoName);

    // 4. Frame Extraction
    console.log(`RunID ${runId}: Extracting frames for short video...`);
    const shortFramePaths = await extractFrames(shortVideoFile.filepath, runId + '_short', targetFrames, shortFramesDir);
    console.log(`RunID ${runId}: Extracting frames for reference video...`);
    const refFramePaths = await extractFrames(referenceVideoFile.filepath, runId + '_ref', targetFrames, refFramesDir);

    // Dimensions for output video (use metadata from original videos)
    const shortVideoDims = { width: shortVideoMetadata.width, height: shortVideoMetadata.height };
    const refVideoDims = { width: refVideoMetadata.width, height: refVideoMetadata.height };

    // 5. Pose Estimation
    console.log(`RunID ${runId}: Estimating poses for short video frames...`);
    const shortPoses = await estimatePosesForFrames(shortFramePaths);
    console.log(`RunID ${runId}: Estimating poses for reference video frames...`);
    const refPoses = await estimatePosesForFrames(refFramePaths);

    // 6. Annotate Frames
    console.log(`RunID ${runId}: Annotating short video frames...`);
    for (let i = 0; i < targetFrames; i++) {
      const annotatedFrameOutPath = path.join(shortAnnotatedFramesDir, `frame_${String(i).padStart(4, '0')}.png`);
      await drawPoseOnFrame(shortFramePaths[i], shortPoses[i], annotatedFrameOutPath);
    }
    console.log(`RunID ${runId}: Annotating reference video frames...`);
    for (let i = 0; i < targetFrames; i++) {
      const annotatedFrameOutPath = path.join(refAnnotatedFramesDir, `frame_${String(i).padStart(4, '0')}.png`);
      await drawPoseOnFrame(refFramePaths[i], refPoses[i], annotatedFrameOutPath);
    }

    // 7. Create Annotated Videos
    console.log(`RunID ${runId}: Creating annotated short video...`);
    await createVideoFromFrames(shortAnnotatedFramesDir, 'frame_%04d.png', outputAnnotatedShortVideoPathAbs, shortVideoMetadata.fps, shortVideoDims);
    console.log(`RunID ${runId}: Creating annotated reference video...`);
    await createVideoFromFrames(refAnnotatedFramesDir, 'frame_%04d.png', outputAnnotatedRefVideoPathAbs, refVideoMetadata.fps, refVideoDims);

    // 8. Similarity Analysis
    console.log(`RunID ${runId}: Calculating similarity...`);
    const similarityResult = calculateSimilarity(shortPoses, refPoses, targetFrames);

    // 9. Prepare and Send Success Response
    console.log(`RunID ${runId}: Processing complete.`);
    return res.status(200).json({
      success: true,
      annotated_short_video_url: `/processed_videos/${annotatedShortVideoName}`,
      annotated_reference_video_url: `/processed_videos/${annotatedRefVideoName}`,
      similarity_score: similarityResult.score,
      analysis_text: similarityResult.analysisText,
    });

  } catch (error: any) {
    console.error(`RunID ${runId}: API Processing Error -`, error);
    return res.status(500).json({ success: false, error: `Processing failed: ${error.message}`, details: error.stack });
  } finally {
    console.log(`RunID ${runId}: Cleaning up temporary files...`);
    // Delete original uploads
    uploadedFilePaths.forEach(filePath => {
      if (fs.existsSync(filePath)) {
        fs.unlink(filePath, err => {
          if (err) console.error(`RunID ${runId}: Error deleting uploaded file ${filePath}:`, err);
        });
      }
    });
    // Delete the entire temporary directory for this run
    if (fs.existsSync(runTempDir)) {
      fs.rm(runTempDir, { recursive: true, force: true }, err => {
         if (err) console.error(`RunID ${runId}: Error deleting temp run directory ${runTempDir}:`, err);
      });
    }
    console.log(`RunID ${runId}: Cleanup attempt finished.`);
  }
}
