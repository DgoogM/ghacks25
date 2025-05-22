import { loadImage, createCanvas, CanvasRenderingContext2D, Image as CanvasImage } from 'canvas';
import fs from 'fs';
import { NormalizedLandmarkList } from '@mediapipe/pose';
import { drawConnectors, drawLandmarks } from '@mediapipe/drawing_utils';
import { POSE_CONNECTIONS } from '@mediapipe/pose'; // POSE_CONNECTIONS provides pairs of landmarks to connect

/**
 * Draws the pose landmarks and connections on a given frame.
 *
 * @param originalFramePath Path to the original extracted frame.
 * @param poseLandmarks Pose landmarks detected by MediaPipe Pose.
 * @param annotatedFramePath Path to save the new frame with drawings.
 * @returns A Promise that resolves when drawing is complete and file is saved, or rejects on error.
 */
export async function drawPoseOnFrame(
  originalFramePath: string,
  poseLandmarks: NormalizedLandmarkList | undefined,
  annotatedFramePath: string
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    let image: CanvasImage;
    try {
      image = await loadImage(originalFramePath);
    } catch (error: any) {
      return reject(new Error(`Failed to load original frame ${originalFramePath}: ${error.message}`));
    }

    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');

    // Draw the original image onto the canvas
    ctx.drawImage(image, 0, 0);

    if (poseLandmarks && poseLandmarks.length > 0) {
      // --- Attempt to use @mediapipe/drawing_utils ---
      try {
        // Note: The context 'ctx' from node-canvas might not be fully compatible
        // with what @mediapipe/drawing_utils expects (a browser CanvasRenderingContext2D).
        // This is a common point of failure.
        drawConnectors(ctx as unknown as CanvasRenderingContext2D, poseLandmarks, POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
        drawLandmarks(ctx as unknown as CanvasRenderingContext2D, poseLandmarks, { color: '#FF0000', radius: 3, lineWidth: 1 });
      } catch (e: any) {
        console.warn(`MediaPipe drawing_utils failed (expected if in Node.js without full browser canvas compatibility): ${e.message}. Falling back to manual drawing.`);
        
        // --- Manual Drawing Fallback ---
        ctx.strokeStyle = '#00FF00'; // Green for connections
        ctx.lineWidth = 2;

        POSE_CONNECTIONS.forEach(connection => {
          const startLandmark = poseLandmarks[connection[0]];
          const endLandmark = poseLandmarks[connection[1]];
          if (startLandmark && endLandmark) {
            // Check visibility if available, otherwise assume visible
            const startVisible = startLandmark.visibility === undefined || startLandmark.visibility > 0.5;
            const endVisible = endLandmark.visibility === undefined || endLandmark.visibility > 0.5;

            if (startVisible && endVisible) {
              ctx.beginPath();
              ctx.moveTo(startLandmark.x * image.width, startLandmark.y * image.height);
              ctx.lineTo(endLandmark.x * image.width, endLandmark.y * image.height);
              ctx.stroke();
            }
          }
        });

        ctx.fillStyle = '#FF0000'; // Red for landmarks
        poseLandmarks.forEach(landmark => {
           const visible = landmark.visibility === undefined || landmark.visibility > 0.5;
           if (visible) {
            ctx.beginPath();
            ctx.arc(landmark.x * image.width, landmark.y * image.height, 3, 0, 2 * Math.PI); // 3px radius
            ctx.fill();
           }
        });
      }
    }

    // Save the canvas to a file
    try {
      const out = fs.createWriteStream(annotatedFramePath);
      const stream = canvas.createPNGStream();
      stream.pipe(out);
      out.on('finish', resolve);
      out.on('error', (err) => reject(new Error(`Failed to write annotated frame ${annotatedFramePath}: ${err.message}`)));
    } catch (error: any) {
      reject(new Error(`Failed to save annotated frame ${annotatedFramePath}: ${error.message}`));
    }
  });
}
