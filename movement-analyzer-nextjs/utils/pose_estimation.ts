import { Pose, Results as PoseResults, NormalizedLandmarkList } from '@mediapipe/pose';
import { loadImage, Image as CanvasImage } from 'canvas'; // Use CanvasImage to avoid conflict with DOM Image
import path from 'path';

/**
 * Estimates poses for a series of image frames using MediaPipe Pose.
 *
 * @param framePaths An array of absolute paths to the frame image files.
 * @returns A Promise that resolves to an array of pose landmark lists.
 *          Each element in the array corresponds to a frame and can be
 *          NormalizedLandmarkList | undefined if no pose is detected.
 */
export async function estimatePosesForFrames(
  framePaths: string[]
): Promise<(NormalizedLandmarkList | undefined)[]> {
  if (!framePaths || framePaths.length === 0) {
    return [];
  }

  // Initialize MediaPipe Pose
  // Note: This configuration is crucial for Node.js execution.
  // The WASM and model files need to be accessible. Using a CDN is a common workaround.
  const poseEstimator = new Pose({
    locateFile: (file) => {
      // Attempt to load WASM/model files from CDN.
      // This might require internet access from the execution environment.
      // If the environment is sandboxed without internet, these files would need
      // to be hosted locally (e.g., in the 'public' folder) and this path adjusted.
      return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`;
    },
  });

  poseEstimator.setOptions({
    modelComplexity: 1,       // 0 (lite), 1 (full), 2 (heavy) - balance accuracy/performance
    smoothLandmarks: true,    // Filter landmarks across frames to reduce jitter
    minDetectionConfidence: 0.5, // Minimum confidence value for pose detection
    minTrackingConfidence: 0.5,  // Minimum confidence value for tracking across frames
  });

  const allPoseLandmarks: (NormalizedLandmarkList | undefined)[] = [];

  try {
    for (const framePath of framePaths) {
      let image: CanvasImage;
      try {
        image = await loadImage(framePath);
      } catch (error: any) {
        console.error(`Failed to load image: ${framePath}`, error);
        allPoseLandmarks.push(undefined); // Add undefined if image loading fails
        continue; // Skip to the next frame
      }

      // MediaPipe's `send` method expects an object that resembles an HTMLImageElement or HTMLVideoElement.
      // The `Image` object from `canvas` might work directly or might need shimming.
      // The `as unknown as HTMLImageElement` cast is a common attempt to satisfy TypeScript
      // when the underlying JS might be more flexible. This is a critical point for compatibility.
      // We also need to ensure the image has width and height properties, which `canvas.Image` provides.
      const inputForPose = {
        image: image as unknown as HTMLImageElement, // This cast is often needed
        width: image.width,   // Explicitly providing width
        height: image.height, // Explicitly providing height
      };
      
      try {
        const results: PoseResults = await new Promise((resolve) => {
          poseEstimator.onResults((res: PoseResults) => {
            resolve(res);
          });
          poseEstimator.send(inputForPose);
        });
        allPoseLandmarks.push(results.poseLandmarks);
      } catch (error: any) {
          console.error(`Error during pose estimation for frame ${framePath}:`, error);
          allPoseLandmarks.push(undefined);
      }
    }
  } finally {
    // Close the pose estimator to free up resources
    // This is important, especially if creating estimators frequently.
    await poseEstimator.close();
  }

  return allPoseLandmarks;
}
