// jest.setup.js

// --- Mock for fluent-ffmpeg ---
jest.mock('fluent-ffmpeg', () => {
  const mockFfmpeg = {
    ffprobe: jest.fn().mockImplementation((filePath, callback) => {
      // Simulate ffprobe success by default
      // Tests can override this mock for specific scenarios
      if (mockFfmpeg._ffprobeError) {
        callback(mockFfmpeg._ffprobeError, null);
      } else {
        callback(null, mockFfmpeg._ffprobeData || {
          streams: [{
            codec_type: 'video',
            duration: '5.0', // Default mock duration
            width: 1280,
            height: 720,
            r_frame_rate: '30/1',
            avg_frame_rate: '30/1',
          }],
          format: {
            duration: '5.0',
          },
        });
      }
    }),
    input: jest.fn().mockReturnThis(),
    inputOptions: jest.fn().mockReturnThis(),
    outputOptions: jest.fn().mockReturnThis(),
    output: jest.fn().mockReturnThis(),
    on: jest.fn().mockImplementation(function(event, callback) {
      // Simulate 'end' event by default for successful run
      // Simulate 'error' event if _ffmpegError is set
      if (event === 'end' && !mockFfmpeg._ffmpegError) {
        setTimeout(() => callback(), 0); // Simulate async behavior
      } else if (event === 'error' && mockFfmpeg._ffmpegError) {
        setTimeout(() => callback(mockFfmpeg._ffmpegError, '', ''), 0); // Simulate async behavior
      }
      return this; // Allow chaining
    }),
    run: jest.fn().mockImplementation(function() {
      // This is often where the 'end' or 'error' events are triggered in the .on mock
      // For simplicity, the .on mock handles immediate callback based on error states
      if (mockFfmpeg._ffmpegRunError) {
          // If run itself should throw or if an 'error' event should be emitted by .on()
          // This depends on how the code under test uses it.
          // Assuming .on('error', cb) is the primary error handling mechanism.
      }
    }),
    // --- Helper properties for controlling the mock from tests ---
    _ffprobeError: null,
    _ffprobeData: null,
    _ffmpegError: null, // For controlling .on('error', ...)
    _ffmpegRunError: null, // If .run() itself should throw (less common for this lib)
    // --- Reset function for tests ---
    __resetMocks: () => {
      mockFfmpeg.ffprobe.mockClear();
      mockFfmpeg.input.mockClear();
      mockFfmpeg.inputOptions.mockClear();
      mockFfmpeg.outputOptions.mockClear();
      mockFfmpeg.output.mockClear();
      mockFfmpeg.on.mockClear();
      mockFfmpeg.run.mockClear();
      mockFfmpeg._ffprobeError = null;
      mockFfmpeg._ffprobeData = null;
      mockFfmpeg._ffmpegError = null;
      mockFfmpeg._ffmpegRunError = null;
    },
  };
  // This allows `ffmpeg()` to be called as a function
  const ffmpegCommand = jest.fn(() => mockFfmpeg);
  // Attach properties to the command function itself if needed, e.g., ffmpegCommand.setFfmpegPath
  ffmpegCommand.setFfmpegPath = jest.fn();
  ffmpegCommand.setFfprobePath = jest.fn();
  
  // Also attach the helper properties to the command so tests can access them via the imported module
  ffmpegCommand._ffprobeError = mockFfmpeg._ffprobeError;
  ffmpegCommand._ffprobeData = mockFfmpeg._ffprobeData;
  ffmpegCommand._ffmpegError = mockFfmpeg._ffmpegError;
  ffmpegCommand._ffmpegRunError = mockFfmpeg._ffmpegRunError;
  ffmpegCommand.__resetMocks = mockFfmpeg.__resetMocks;
  
  // Make the mockFfmpeg object available on the command itself if it's used like `ffmpeg().ffprobe`
  // and also if properties are accessed directly like `ffmpeg.ffprobe` (though less common)
  Object.assign(ffmpegCommand, mockFfmpeg);


  return ffmpegCommand;
});

// --- Mock for canvas ---
jest.mock('canvas', () => {
  const mockCanvasContext = {
    drawImage: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    fillRect: jest.fn(), // Add other methods as needed by drawing_utils
    setLineDash: jest.fn(),
    getLineDash: jest.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    fillText: jest.fn(),
  };

  const mockCanvas = {
    getContext: jest.fn().mockReturnValue(mockCanvasContext),
    createPNGStream: jest.fn(() => ({
      pipe: jest.fn().mockImplementation((writableStream) => {
        // Simulate the 'finish' event for saving files
        writableStream.emit('finish');
        return writableStream;
      }),
    })),
    width: 0, // Default, can be set by tests
    height: 0, // Default, can be set by tests
  };

  return {
    loadImage: jest.fn().mockImplementation(async (src) => {
      // Simulate image loading, return a mock image object
      if (src === 'fail_load') throw new Error('Mock image load error');
      return {
        src,
        width: 1920, // Default mock width
        height: 1080, // Default mock height
        complete: true, // For MediaPipe Pose compatibility
      };
    }),
    createCanvas: jest.fn().mockImplementation((width, height) => {
        mockCanvas.width = width;
        mockCanvas.height = height;
        return mockCanvas;
    }),
    // Export Image class if it's used with `instanceof` or type checks
    Image: jest.fn().mockImplementation(() => ({ width: 0, height: 0, complete: true })), 
    // --- Helper for tests ---
    _mockCanvasContext: mockCanvasContext,
    _mockCanvas: mockCanvas,
    __resetMocks: () => {
      mockCanvasContext.drawImage.mockClear();
      mockCanvasContext.beginPath.mockClear();
      // ... clear other context method mocks
      mockCanvas.getContext.mockClear();
      mockCanvas.createPNGStream().pipe.mockClear();
      // @ts-ignore
      module.exports.loadImage.mockClear(); // since loadImage is a prop of the module
      // @ts-ignore
      module.exports.createCanvas.mockClear();
    }
  };
});

// --- Mock for @mediapipe/pose ---
jest.mock('@mediapipe/pose', () => {
  const mockPoseInstance = {
    setOptions: jest.fn().mockReturnThis(),
    onResults: jest.fn().mockImplementation(function(callback) {
      // Store the callback to be triggered manually or by send()
      this._onResultsCallback = callback;
    }),
    send: jest.fn().mockImplementation(async function(input) {
      // Simulate processing and trigger onResults callback
      if (this._onResultsCallback) {
        // Allow tests to set mock results
        const results = mockPoseInstance._mockResults !== undefined ? mockPoseInstance._mockResults : { poseLandmarks: [] };
        this._onResultsCallback(results);
      }
    }),
    close: jest.fn().mockResolvedValue(undefined),
    // --- Helper properties for tests ---
    _onResultsCallback: null,
    _mockResults: undefined, // Tests can set this to control results
  };

  const Pose = jest.fn(() => mockPoseInstance);
  // Static properties like POSE_CONNECTIONS if needed by other modules directly
  Pose.POSE_CONNECTIONS = [/* mock connections if necessary, or import actual if simple array */]; 
                                     // Example: [[0,1], [1,2]]

  return {
    Pose,
    // Export other things if used, like POSE_CONNECTIONS
    POSE_CONNECTIONS: Pose.POSE_CONNECTIONS, 
    // --- Helper for tests ---
    __resetMocks: () => {
      mockPoseInstance.setOptions.mockClear();
      mockPoseInstance.onResults.mockClear();
      mockPoseInstance.send.mockClear();
      mockPoseInstance.close.mockClear();
      mockPoseInstance._mockResults = undefined;
      Pose.mockClear();
    },
    _mockPoseInstance: mockPoseInstance, // Expose instance for finer control if needed
  };
});


// --- Mock for @mediapipe/drawing_utils ---
jest.mock('@mediapipe/drawing_utils', () => ({
  drawConnectors: jest.fn(),
  drawLandmarks: jest.fn(),
  // --- Helper for tests ---
  __resetMocks: () => {
    // @ts-ignore
    module.exports.drawConnectors.mockClear();
    // @ts-ignore
    module.exports.drawLandmarks.mockClear();
  }
}));


// --- Mock for fs (selectively, or use jest-plugin-fs) ---
// For now, keeping it simple. If more complex fs interaction is needed,
// consider `memfs` or `jest-plugin-fs`.
const actualFs = jest.requireActual('fs');
jest.mock('fs', () => ({
  ...actualFs, // Inherit actual 'fs' behavior
  existsSync: jest.fn((path) => {
    // Default mock: assume files/dirs don't exist unless overridden in tests
    if (path.toString().includes('EXISTING_MOCK_FILE')) return true;
    if (path.toString().includes('EXISTING_MOCK_DIR')) return true;
    return false;
  }),
  mkdirSync: jest.fn((path, options) => {
    // console.log(`Mock fs.mkdirSync called with: ${path}`);
    return undefined;
  }),
  createWriteStream: jest.fn().mockImplementation((path) => {
    const stream = new (require('stream').Writable)();
    stream._write = (chunk, encoding, callback) => { callback(); }; // No-op
    // Simulate 'finish' event for saving files, similar to canvas.createPNGStream().pipe()
    setTimeout(() => stream.emit('finish'), 0); 
    return stream;
  }),
  unlink: jest.fn((path, callback) => {
    // console.log(`Mock fs.unlink called with: ${path}`);
    if (callback) callback(null); // Simulate success
  }),
  rm: jest.fn((path, options, callback) => {
    // console.log(`Mock fs.rm called with: ${path}`);
    if (callback) callback(null); // Simulate success
  }),
  // --- Helper for tests ---
  __resetMocks: () => {
    // @ts-ignore
    module.exports.existsSync.mockReset(); // Reset to default mock behavior
    // @ts-ignore
    module.exports.mkdirSync.mockClear();
    // @ts-ignore
    module.exports.createWriteStream.mockClear();
    // @ts-ignore
    module.exports.unlink.mockClear();
    // @ts-ignore
    module.exports.rm.mockClear();
     // Restore default existsSync behavior
    // @ts-ignore
    module.exports.existsSync.mockImplementation((path) => {
        if (path.toString().includes('EXISTING_MOCK_FILE')) return true;
        if (path.toString().includes('EXISTING_MOCK_DIR')) return true;
        return false;
    });
  }
}));

// Global afterEach to reset all custom mocks if they have a __resetMocks method
afterEach(() => {
  const ffmpeg = require('fluent-ffmpeg');
  if (ffmpeg.__resetMocks) ffmpeg.__resetMocks();

  const canvas = require('canvas');
  if (canvas.__resetMocks) canvas.__resetMocks();

  const mediapipePose = require('@mediapipe/pose');
  if (mediapipePose.__resetMocks) mediapipePose.__resetMocks();
  
  const mediapipeDrawingUtils = require('@mediapipe/drawing_utils');
  if (mediapipeDrawingUtils.__resetMocks) mediapipeDrawingUtils.__resetMocks();

  const fs = require('fs');
  if (fs.__resetMocks) fs.__resetMocks();
});
