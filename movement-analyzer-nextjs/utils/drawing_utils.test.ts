import { drawPoseOnFrame } from './drawing_utils'; // Adjust path
import fs from 'fs'; // Mocked in jest.setup.js
import { loadImage, createCanvas, _mockCanvasContext as mockCanvasContext, _mockCanvas as mockCanvas } from 'canvas'; // Import mocks from mocked canvas
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils'; // Mocked
import { POSE_CONNECTIONS, NormalizedLandmarkList, NormalizedLandmark } from '@mediapipe/pose'; // POSE_CONNECTIONS from mocked pose

// Type assertion for mocked modules
const mockedFs = fs as jest.Mocked<typeof fs> & { __resetMocks: () => void };
const mockedLoadImage = loadImage as jest.Mock;
const mockedCreateCanvas = createCanvas as jest.Mock;
const mockedDrawConnectors = drawConnectors as jest.Mock;
const mockedDrawLandmarks = drawLandmarks as jest.Mock;

// Helper to create mock NormalizedLandmarkList
const createMockPoseLandmarks = (count: number = 33): NormalizedLandmarkList => {
  const landmarks: NormalizedLandmark[] = [];
  for (let i = 0; i < count; i++) {
    landmarks.push({ x: 0.5, y: 0.5, z: 0.5, visibility: 0.95 });
  }
  return landmarks;
};

describe('drawPoseOnFrame', () => {
  const originalFramePath = 'EXISTING_MOCK_FILE/frame.png';
  const annotatedFramePath = '/output/annotated_frame.png';
  let mockPoseData: NormalizedLandmarkList | undefined;

  beforeEach(() => {
    mockedFs.__resetMocks();
    mockCanvasContext.drawImage.mockClear();
    mockCanvasContext.beginPath.mockClear();
    mockCanvasContext.moveTo.mockClear();
    mockCanvasContext.lineTo.mockClear();
    mockCanvasContext.stroke.mockClear();
    mockCanvasContext.arc.mockClear();
    mockCanvasContext.fill.mockClear();
    mockedLoadImage.mockClear();
    mockedCreateCanvas.mockClear();
    mockedDrawConnectors.mockClear();
    mockedDrawLandmarks.mockClear();

    // Default successful load image
    mockedLoadImage.mockResolvedValue({ width: 100, height: 100, src: originalFramePath, complete: true });
    // Default successful write stream
    (mockedFs.createWriteStream as jest.Mock).mockImplementation((path) => {
        const stream = new (require('stream').Writable)();
        stream._write = (chunk, encoding, callback) => { callback(); };
        setTimeout(() => stream.emit('finish'), 0);
        return stream;
    });
  });

  test('should draw using @mediapipe/drawing_utils when landmarks are provided', async () => {
    mockPoseData = createMockPoseLandmarks();
    await drawPoseOnFrame(originalFramePath, mockPoseData, annotatedFramePath);

    expect(mockedLoadImage).toHaveBeenCalledWith(originalFramePath);
    expect(mockedCreateCanvas).toHaveBeenCalledWith(100, 100);
    expect(mockCanvasContext.drawImage).toHaveBeenCalledTimes(1);
    expect(mockedDrawConnectors).toHaveBeenCalledWith(mockCanvasContext, mockPoseData, POSE_CONNECTIONS, expect.any(Object));
    expect(mockedDrawLandmarks).toHaveBeenCalledWith(mockCanvasContext, mockPoseData, expect.any(Object));
    expect(mockedFs.createWriteStream).toHaveBeenCalledWith(annotatedFramePath);
  });

  test('should fallback to manual drawing if @mediapipe/drawing_utils fails', async () => {
    mockPoseData = createMockPoseLandmarks();
    mockedDrawConnectors.mockImplementation(() => { throw new Error('MediaPipe draw error'); });
    // mockedDrawLandmarks will also not be called or could also throw

    await drawPoseOnFrame(originalFramePath, mockPoseData, annotatedFramePath);

    expect(mockedLoadImage).toHaveBeenCalledWith(originalFramePath);
    expect(mockCanvasContext.drawImage).toHaveBeenCalledTimes(1);
    expect(mockedDrawConnectors).toHaveBeenCalledTimes(1); // It was attempted
    
    // Check for manual drawing calls (very basic check)
    expect(mockCanvasContext.beginPath).toHaveBeenCalled(); // Called for connections and landmarks
    expect(mockCanvasContext.moveTo).toHaveBeenCalled();   // Called for connections
    expect(mockCanvasContext.lineTo).toHaveBeenCalled();   // Called for connections
    expect(mockCanvasContext.stroke).toHaveBeenCalled();  // Called for connections
    expect(mockCanvasContext.arc).toHaveBeenCalled();     // Called for landmarks
    expect(mockCanvasContext.fill).toHaveBeenCalled();    // Called for landmarks
    expect(mockedFs.createWriteStream).toHaveBeenCalledWith(annotatedFramePath);
  });

  test('should only draw original image if no landmarks are provided', async () => {
    mockPoseData = undefined;
    await drawPoseOnFrame(originalFramePath, mockPoseData, annotatedFramePath);

    expect(mockedLoadImage).toHaveBeenCalledWith(originalFramePath);
    expect(mockCanvasContext.drawImage).toHaveBeenCalledTimes(1);
    expect(mockedDrawConnectors).not.toHaveBeenCalled();
    expect(mockedDrawLandmarks).not.toHaveBeenCalled();
    expect(mockCanvasContext.beginPath).not.toHaveBeenCalled(); // No manual drawing either
    expect(mockedFs.createWriteStream).toHaveBeenCalledWith(annotatedFramePath);
  });

  test('should reject if loadImage fails', async () => {
    mockedLoadImage.mockRejectedValue(new Error('Failed to load image'));
    mockPoseData = createMockPoseLandmarks();

    await expect(drawPoseOnFrame(originalFramePath, mockPoseData, annotatedFramePath))
      .rejects.toThrow(`Failed to load original frame ${originalFramePath}: Failed to load image`);
  });

  test('should reject if file saving (createWriteStream) fails', async () => {
    (mockedFs.createWriteStream as jest.Mock).mockImplementation((path) => {
        const stream = new (require('stream').Writable)();
        stream._write = (chunk, encoding, callback) => { callback(); };
        setTimeout(() => stream.emit('error', new Error('Mock save error')), 0);
        return stream;
    });
    mockPoseData = createMockPoseLandmarks();

    await expect(drawPoseOnFrame(originalFramePath, mockPoseData, annotatedFramePath))
      .rejects.toThrow(`Failed to write annotated frame ${annotatedFramePath}: Mock save error`);
  });
});
