import httpMocks, { MockRequest, MockResponse } from 'node-mocks-http';
import { Writable } from 'stream';
import handler from './analyze'; // The API route handler
import fs from 'fs'; // Mocked
import ffmpeg from 'fluent-ffmpeg'; // Mocked

// Mock the utility modules
jest.mock('../../utils/video_processing');
jest.mock('../../utils/pose_estimation');
jest.mock('../../utils/drawing_utils');
jest.mock('../../utils/analysis');

// Import the mocked functions to configure their behavior
import { extractFrames, createVideoFromFrames } from '../../utils/video_processing';
import { estimatePosesForFrames } from '../../utils/pose_estimation';
import { drawPoseOnFrame } from '../../utils/drawing_utils';
import { calculateSimilarity } from '../../utils/analysis';

// Type assertion for mocked fs and ffmpeg
const mockedFs = fs as jest.Mocked<typeof fs> & { __resetMocks: () => void };
const mockedFfmpeg = ffmpeg as jest.Mocked<typeof ffmpeg> & { 
    _ffprobeError: any; 
    _ffprobeData: any; 
    _ffmpegError: any;
    __resetMocks: () => void;
};

// Helper to create a minimal mock FormidableFile
const createMockFormidableFile = (filepath: string, originalFilename: string, mimetype: string = 'video/mp4', size: number = 1024): any => ({
    filepath,
    originalFilename,
    mimetype,
    size,
    toJSON: () => ({ /* ... */ }), // formidable File objects have this
});


describe('/api/analyze Integration Tests', () => {
  let req: MockRequest<any>;
  let res: MockResponse<any>;

  beforeEach(() => {
    // Reset all module mocks
    jest.clearAllMocks();
    mockedFs.__resetMocks(); // Reset fs mock specifically if needed
    mockedFfmpeg.__resetMocks(); // Reset ffmpeg mock

    // Default successful mock implementations for utility functions
    (extractFrames as jest.Mock).mockResolvedValue(Array(30).fill('mock_frame_path.png'));
    (estimatePosesForFrames as jest.Mock).mockResolvedValue(Array(30).fill([{ x: 0, y: 0, z: 0, score: 1 }])); // Simplified mock
    (drawPoseOnFrame as jest.Mock).mockResolvedValue(undefined);
    (createVideoFromFrames as jest.Mock).mockResolvedValue(undefined);
    (calculateSimilarity as jest.Mock).mockReturnValue({ score: 95.5, analysisText: 'Mock analysis text' });

    // Mock fs.existsSync to generally return true for paths that "should" exist
    mockedFs.existsSync.mockImplementation((p) => {
        if (p.toString().includes('EXISTING_MOCK_UPLOAD_short.mp4')) return true;
        if (p.toString().includes('EXISTING_MOCK_UPLOAD_ref.mp4')) return true;
        if (p.toString().includes('EXISTING_MOCK_DIR')) return true; // For base temp dir
        return false;
    });
    mockedFs.mkdirSync.mockReturnValue(undefined);
    mockedFs.rm.mockImplementation((p, opts, cb) => cb && cb(null)); // Simulate successful removal
    mockedFs.unlink.mockImplementation((p, cb) => cb && cb(null)); // Simulate successful unlink

    // Default ffprobe mock for getVideoMetadata (used for duration, fps, dimensions)
    mockedFfmpeg.ffprobe.mockImplementation((filePath, callback) => {
        callback(null, {
            streams: [{
                codec_type: 'video',
                duration: filePath.includes('short') ? '4.0' : '10.0', // Short video valid by default
                width: 1280,
                height: 720,
                r_frame_rate: '30/1',
            }],
            format: { duration: filePath.includes('short') ? '4.0' : '10.0' },
        });
    });
    
    res = httpMocks.createResponse();
  });

  // Test formidable parsing indirectly by mocking what `form.parse` would return
  // We need to mock formidable itself if we want to control its behavior more finely.
  // For now, let's assume formidable is part of the SUT and we mock inputs to it via `req` object.
  // The API handler uses formidable internally. A true integration test would need to simulate file uploads.
  // This is tricky with node-mocks-http alone. We'll simulate the *result* of formidable parsing.

  // A more robust way to test formidable is to mock `formidable.IncomingForm.prototype.parse`
  // For now, we'll rely on the internal structure and hope the mocks cover enough.
  // The current API handler uses `new formidable.Formidable(...)` then `form.parse`.

  test('should return 200 and analysis results for a valid request', async () => {
    // Simulate that formidable has parsed the files and fields
    // This requires a more complex mock setup for formidable itself, or refactoring the handler.
    // Let's try to mock formidable's parse method.
    const mockParse = jest.fn((request, callback) => {
        const files = {
            short_video: [createMockFormidableFile('EXISTING_MOCK_UPLOAD_short.mp4', 'short.mp4')],
            reference_video: [createMockFormidableFile('EXISTING_MOCK_UPLOAD_ref.mp4', 'ref.mp4')],
        };
        const fields = { targetFrames: ['30'] };
        callback(null, fields, files);
    });
    
    jest.mock('formidable', () => {
        // Mock the default export if it's a class, or specific methods
        const actualFormidable = jest.requireActual('formidable');
        return {
            ...actualFormidable, // Keep other exports like 'File' if needed
            // This is the key: mock the constructor or a prototype method
            // If the handler does `new Formidable().parse(...)`
            default: jest.fn().mockImplementation(() => ({ // Mock constructor
                parse: mockParse, 
                // Mock other methods/properties of Formidable instance if used by handler
                uploadDir: '', 
                keepExtensions: true, 
                maxFileSize: 0,
                on: jest.fn(), // if event listeners are used
            })),
            // If the handler does `formidable({ options }).parse(...)`
            // We might need to adjust based on how formidable is invoked.
            // The current handler uses `formidable({ options })` which returns an instance.
            // So, mocking the default export as a function that returns the mock instance.
            __esModule: true, // If it's an ES module
        };
    });
    
    // Re-import handler after mocking formidable
    const freshHandler = require('./analyze').default;

    req = httpMocks.createRequest({
      method: 'POST',
      // Headers are important for formidable to recognize it as a multipart request
      headers: { 'content-type': 'multipart/form-data; boundary=---TESTBOUNDARY' },
      // Body/files would normally be streams, but formidable mock handles this.
    });

    await freshHandler(req, res);

    expect(res.statusCode).toBe(200);
    const jsonResponse = res._getJSONData();
    expect(jsonResponse.success).toBe(true);
    expect(jsonResponse.annotated_short_video_url).toMatch(/_short_annotated.mp4$/);
    expect(jsonResponse.annotated_reference_video_url).toMatch(/_ref_annotated.mp4$/);
    expect(jsonResponse.similarity_score).toBe(95.5);
    expect(jsonResponse.analysis_text).toBe('Mock analysis text');

    // Check if cleanup was attempted for uploaded files and temp run directory
    expect(mockedFs.unlink).toHaveBeenCalledWith('EXISTING_MOCK_UPLOAD_short.mp4', expect.any(Function));
    expect(mockedFs.unlink).toHaveBeenCalledWith('EXISTING_MOCK_UPLOAD_ref.mp4', expect.any(Function));
    expect(mockedFs.rm).toHaveBeenCalledWith(expect.stringContaining(path.join('public', 'temp_processing')), expect.any(Object), expect.any(Function));
  });


  test('should return 400 if short video is too long', async () => {
    // Mock ffprobe to return a long duration for the short video
     mockedFfmpeg.ffprobe.mockImplementation((filePath, callback) => {
        if (filePath.includes('short')) {
            callback(null, {
                streams: [{ codec_type: 'video', duration: '10.0', width: 1280, height: 720, r_frame_rate: '30/1' }],
                format: { duration: '10.0' },
            });
        } else { // ref video
            callback(null, {
                streams: [{ codec_type: 'video', duration: '5.0', width: 1280, height: 720, r_frame_rate: '30/1' }],
                format: { duration: '5.0' },
            });
        }
    });
    
    const mockParse = jest.fn((request, callback) => {
        const files = {
            short_video: [createMockFormidableFile('EXISTING_MOCK_UPLOAD_short.mp4', 'short.mp4')],
            reference_video: [createMockFormidableFile('EXISTING_MOCK_UPLOAD_ref.mp4', 'ref.mp4')],
        };
        const fields = { targetFrames: ['30'] };
        callback(null, fields, files);
    });
    jest.mock('formidable', () => ({ default: jest.fn(() => ({ parse: mockParse })) , __esModule: true}));
    const freshHandler = require('./analyze').default;


    req = httpMocks.createRequest({ method: 'POST', headers: { 'content-type': 'multipart/form-data' } });
    await freshHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().success).toBe(false);
    expect(res._getJSONData().error).toContain('Short video exceeds 5s limit');
  });

  test('should return 400 if files are missing', async () => {
    const mockParse = jest.fn((request, callback) => {
        // Simulate missing reference_video
        const files = { short_video: [createMockFormidableFile('EXISTING_MOCK_UPLOAD_short.mp4', 'short.mp4')] };
        const fields = { targetFrames: ['30'] };
        callback(null, fields, files);
    });
    jest.mock('formidable', () => ({ default: jest.fn(() => ({ parse: mockParse })) , __esModule: true}));
    const freshHandler = require('./analyze').default;

    req = httpMocks.createRequest({ method: 'POST', headers: { 'content-type': 'multipart/form-data' } });
    await freshHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._getJSONData().success).toBe(false);
    expect(res._getJSONData().error).toContain('Missing video files');
  });

  test('should return 500 if a core utility function fails (e.g., estimatePosesForFrames)', async () => {
    (estimatePosesForFrames as jest.Mock).mockRejectedValue(new Error('Pose estimation mock error'));

    const mockParse = jest.fn((request, callback) => {
        const files = {
            short_video: [createMockFormidableFile('EXISTING_MOCK_UPLOAD_short.mp4', 'short.mp4')],
            reference_video: [createMockFormidableFile('EXISTING_MOCK_UPLOAD_ref.mp4', 'ref.mp4')],
        };
        const fields = { targetFrames: ['30'] };
        callback(null, fields, files);
    });
    jest.mock('formidable', () => ({ default: jest.fn(() => ({ parse: mockParse })) , __esModule: true}));
    const freshHandler = require('./analyze').default;

    req = httpMocks.createRequest({ method: 'POST', headers: { 'content-type': 'multipart/form-data' } });
    await freshHandler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res._getJSONData().success).toBe(false);
    expect(res._getJSONData().error).toContain('Processing failed: Pose estimation mock error');
  });
});
