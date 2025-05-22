import { extractFrames, createVideoFromFrames } from './video_processing'; // Adjust path
import fs from 'fs'; // Mocked in jest.setup.js
import path from 'path';
import ffmpeg from 'fluent-ffmpeg'; // Mocked in jest.setup.js

// Type assertion for the mocked ffmpeg
const mockedFfmpeg = ffmpeg as jest.Mocked<typeof ffmpeg> & { 
    _ffprobeError: any; 
    _ffprobeData: any; 
    _ffmpegError: any;
    __resetMocks: () => void;
};
const mockedFs = fs as jest.Mocked<typeof fs> & { __resetMocks: () => void };


describe('extractFrames', () => {
  const videoPath = 'EXISTING_MOCK_FILE/video.mp4'; // fs.existsSync will return true
  const videoIdentifier = 'test_video';
  const outputDirBase = path.join(process.cwd(), 'public', 'test_temp_frames');
  let targetFrames: number;

  beforeEach(() => {
    // Reset mocks before each test
    mockedFfmpeg.__resetMocks();
    mockedFs.__resetMocks();
    
    // Default behavior for fs.existsSync unless overridden in a specific test
    mockedFs.existsSync.mockImplementation((p) => p === videoPath || p.toString().includes('EXISTING_MOCK_DIR'));
    mockedFs.readdirSync.mockReturnValue([]); // Default to no files
  });

  test('should extract frames successfully for a normal video', async () => {
    targetFrames = 5;
    mockedFfmpeg._ffprobeData = {
      streams: [{ codec_type: 'video', duration: '10.0', width: 1920, height: 1080, r_frame_rate: '30/1' }],
      format: { duration: '10.0' },
    };
    const mockGeneratedFrames = Array.from({ length: targetFrames }, (_, i) => `frame_${String(i + 1).padStart(4, '0')}.png`);
    mockedFs.readdirSync.mockReturnValue(mockGeneratedFrames);

    const framePaths = await extractFrames(videoPath, videoIdentifier, targetFrames, outputDirBase);
    
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining(outputDirBase), { recursive: true });
    expect(mockedFfmpeg().outputOptions).toHaveBeenCalledWith(expect.arrayContaining([`-vf`, `fps=${targetFrames}/10`]));
    expect(framePaths).toHaveLength(targetFrames);
    framePaths.forEach((fp, i) => expect(fp).toContain(mockGeneratedFrames[i]));
  });

  test('should pad frames if fewer are extracted than targetFrames', async () => {
    targetFrames = 10;
    const actualExtractedCount = 5;
    mockedFfmpeg._ffprobeData = {
      streams: [{ codec_type: 'video', duration: '2.0', width: 1920, height: 1080, r_frame_rate: '30/1' }],
      format: { duration: '2.0' },
    };
    const mockGeneratedFrames = Array.from({ length: actualExtractedCount }, (_, i) => `frame_${String(i + 1).padStart(4, '0')}.png`);
    mockedFs.readdirSync.mockReturnValue(mockGeneratedFrames);

    const framePaths = await extractFrames(videoPath, videoIdentifier, targetFrames, outputDirBase);

    expect(framePaths).toHaveLength(targetFrames);
    // Check that the last (targetFrames - actualExtractedCount) frames are duplicates of the actual last frame
    const lastActualFramePath = path.join(outputDirBase, expect.any(String), mockGeneratedFrames[actualExtractedCount - 1]);
    for (let i = actualExtractedCount; i < targetFrames; i++) {
      expect(framePaths[i]).toEqual(lastActualFramePath);
    }
  });

  test('should truncate frames if more are extracted than targetFrames', async () => {
    targetFrames = 3;
    const actualExtractedCount = 5; // ffmpeg somehow produced more
     mockedFfmpeg._ffprobeData = {
      streams: [{ codec_type: 'video', duration: '1.0', width: 1920, height: 1080, r_frame_rate: '30/1' }],
      format: { duration: '1.0' },
    };
    const mockGeneratedFrames = Array.from({ length: actualExtractedCount }, (_, i) => `frame_${String(i + 1).padStart(4, '0')}.png`);
    mockedFs.readdirSync.mockReturnValue(mockGeneratedFrames);

    const framePaths = await extractFrames(videoPath, videoIdentifier, targetFrames, outputDirBase);
    expect(framePaths).toHaveLength(targetFrames);
    expect(framePaths[targetFrames-1]).toContain(mockGeneratedFrames[targetFrames-1]);
  });
  
  test('should handle zero duration by extracting one frame and padding', async () => {
    targetFrames = 5;
    mockedFfmpeg._ffprobeData = {
      streams: [{ codec_type: 'video', duration: '0', width: 1920, height: 1080, r_frame_rate: '30/1' }],
      format: { duration: '0' },
    };
    mockedFs.readdirSync.mockReturnValue(['frame_0001.png']); // Only one frame extracted

    const framePaths = await extractFrames(videoPath, videoIdentifier, targetFrames, outputDirBase);
    
    expect(mockedFfmpeg().outputOptions).toHaveBeenCalledWith(expect.arrayContaining(['-vframes', '1']));
    expect(framePaths).toHaveLength(targetFrames);
    expect(framePaths[0]).toContain('frame_0001.png');
    for(let i = 1; i < targetFrames; i++) {
        expect(framePaths[i]).toEqual(framePaths[0]); // All padded from the first
    }
  });

  test('should reject if ffprobe fails', async () => {
    targetFrames = 5;
    mockedFfmpeg._ffprobeError = new Error('ffprobe mock error');
    
    await expect(extractFrames(videoPath, videoIdentifier, targetFrames, outputDirBase))
      .rejects.toThrow('ffprobe error: ffprobe mock error');
  });

  test('should reject and attempt cleanup if ffmpeg run fails', async () => {
    targetFrames = 5;
    mockedFfmpeg._ffprobeData = { // ffprobe succeeds
      streams: [{ codec_type: 'video', duration: '5.0', width: 1920, height: 1080, r_frame_rate: '30/1' }],
      format: { duration: '5.0' },
    };
    mockedFfmpeg._ffmpegError = new Error('ffmpeg mock run error'); // ffmpeg run fails
    
    // Mock fs.existsSync for the output directory to be true so rm is called
    mockedFs.existsSync.mockImplementation(p => p.toString().startsWith(outputDirBase) || p === videoPath);

    await expect(extractFrames(videoPath, videoIdentifier, targetFrames, outputDirBase))
      .rejects.toThrow('ffmpeg (multi-frame) error: ffmpeg mock run error');
    
    expect(mockedFs.rm).toHaveBeenCalledWith(
        expect.stringContaining(outputDirBase), // Path to the unique output subdir
        { recursive: true, force: true }, 
        expect.any(Function)
    );
  });

  test('should reject if targetFrames is zero or negative', async () => {
    await expect(extractFrames(videoPath, videoIdentifier, 0, outputDirBase))
      .rejects.toThrow('targetFrames must be a positive number.');
    await expect(extractFrames(videoPath, videoIdentifier, -1, outputDirBase))
      .rejects.toThrow('targetFrames must be a positive number.');
  });

  test('should reject if video file does not exist', async () => {
    mockedFs.existsSync.mockReturnValue(false); // Video file does not exist
    targetFrames = 5;
    await expect(extractFrames('nonexistent/video.mp4', videoIdentifier, targetFrames, outputDirBase))
      .rejects.toThrow('Video file not found: nonexistent/video.mp4');
  });

  test('should reject if no frames are extracted and targetFrames > 0', async () => {
    targetFrames = 5;
    mockedFfmpeg._ffprobeData = {
      streams: [{ codec_type: 'video', duration: '10.0', width: 1920, height: 1080, r_frame_rate: '30/1' }],
      format: { duration: '10.0' },
    };
    mockedFs.readdirSync.mockReturnValue([]); // No frames extracted

    await expect(extractFrames(videoPath, videoIdentifier, targetFrames, outputDirBase))
      .rejects.toThrow(`No frames were extracted for video ${videoIdentifier}`);
  });
});


describe('createVideoFromFrames', () => {
    const inputFramesDir = 'EXISTING_MOCK_DIR/annotated_frames';
    const framePattern = 'frame_%04d.png';
    const outputVideoPath = '/output/video.mp4';
    const fps = 30;
    const videoSize = { width: 1280, height: 720 };

    beforeEach(() => {
        mockedFfmpeg.__resetMocks();
        mockedFs.__resetMocks();
        // Default behavior for fs.existsSync for inputFramesDir
        mockedFs.existsSync.mockReturnValue(true);
        // Default behavior for readdirSync to return some matching files
        mockedFs.readdirSync.mockReturnValue(['frame_0001.png', 'frame_0002.png']);
    });

    test('should create video successfully', async () => {
        await createVideoFromFrames(inputFramesDir, framePattern, outputVideoPath, fps, videoSize);

        expect(mockedFfmpeg().input).toHaveBeenCalledWith(path.join(inputFramesDir, framePattern));
        expect(mockedFfmpeg().inputOptions).toHaveBeenCalledWith(expect.arrayContaining([`-framerate ${fps}`]));
        expect(mockedFfmpeg().outputOptions).toHaveBeenCalledWith(expect.arrayContaining([
            '-c:v libx264',
            '-pix_fmt yuv420p',
            `-s ${videoSize.width}x${videoSize.height}`
        ]));
        expect(mockedFfmpeg().output).toHaveBeenCalledWith(outputVideoPath);
        expect(mockedFfmpeg().run).toHaveBeenCalled();
    });

    test('should reject if inputFramesDir does not exist', async () => {
        mockedFs.existsSync.mockReturnValue(false);
        await expect(createVideoFromFrames(inputFramesDir, framePattern, outputVideoPath, fps, videoSize))
            .rejects.toThrow(`Input frames directory not found: ${inputFramesDir}`);
    });

    test('should reject if no frames match pattern in inputFramesDir', async () => {
        mockedFs.readdirSync.mockReturnValue([]); // No matching files
        await expect(createVideoFromFrames(inputFramesDir, framePattern, outputVideoPath, fps, videoSize))
            .rejects.toThrow(`No frames found in ${inputFramesDir} matching pattern ${framePattern}`);
    });
    
    test('should reject if ffmpeg run fails', async () => {
        mockedFfmpeg._ffmpegError = new Error('ffmpeg video creation failed');
        await expect(createVideoFromFrames(inputFramesDir, framePattern, outputVideoPath, fps, videoSize))
            .rejects.toThrow('FFmpeg error creating video: ffmpeg video creation failed');
    });
});
