import { NormalizedLandmarkList, NormalizedLandmark } from '@mediapipe/pose';

const NORMALIZATION_CAP = 0.5; // Empirically determined cap for dissimilarity.
                               // Average distance of 0.5 units (normalized space) maps to 0% similarity.

interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number; // Optional, as its reliability/presence can vary
}

/**
 * Calculates the Euclidean distance between two 3D landmarks.
 * @param lm1 First landmark.
 * @param lm2 Second landmark.
 * @returns The Euclidean distance.
 */
function calculateEuclideanDistance(lm1: Landmark, lm2: Landmark): number {
  return Math.sqrt(
    Math.pow(lm1.x - lm2.x, 2) +
    Math.pow(lm1.y - lm2.y, 2) +
    Math.pow(lm1.z - lm2.z, 2)
  );
}

/**
 * Calculates the similarity score between two sequences of pose landmarks.
 *
 * @param poseLandmarks1 Array of pose landmarks for video 1.
 * @param poseLandmarks2 Array of pose landmarks for video 2.
 * @param targetFrames The expected number of frames/landmark sets in each array.
 * @returns An object containing the similarity score (0-100) and an analysis text.
 */
export function calculateSimilarity(
  poseLandmarks1: (NormalizedLandmarkList | undefined)[],
  poseLandmarks2: (NormalizedLandmarkList | undefined)[],
  targetFrames: number
): { score: number; analysisText: string } {
  // Input Validation
  if (
    poseLandmarks1.length !== targetFrames ||
    poseLandmarks2.length !== targetFrames
  ) {
    const errorMsg = `Input landmark arrays length mismatch. Expected ${targetFrames}, got ${poseLandmarks1.length} and ${poseLandmarks2.length}.`;
    console.error(errorMsg);
    // Consider if throwing an error is better, or returning a specific error state.
    // For now, returning a minimal score as per prompt suggestion ("default low score").
    return {
      score: 0,
      analysisText: `Error: Landmark data length mismatch. ${errorMsg}`,
    };
  }

  if (targetFrames === 0) {
    return { score: 0, analysisText: 'No frames to compare.' };
  }

  const frameDissimilarities: number[] = [];
  let mismatchedFrames = 0; // Frames where one pose is missing

  for (let i = 0; i < targetFrames; i++) {
    const landmarks1 = poseLandmarks1[i]; // This is NormalizedLandmarkList
    const landmarks2 = poseLandmarks2[i]; // This is NormalizedLandmarkList

    if (landmarks1 && landmarks2) {
      // Both poses are present, compare them
      if (landmarks1.length !== 33 || landmarks2.length !== 33) {
        // This shouldn't happen if MediaPipe provides standard 33 landmarks or undefined.
        // If it does, it means the NormalizedLandmarkList is malformed or incomplete.
        console.warn(`Frame ${i}: Unexpected number of landmarks. Vid1: ${landmarks1.length}, Vid2: ${landmarks2.length}. Skipping frame comparison.`);
        frameDissimilarities.push(1.0); // Assign high dissimilarity
        mismatchedFrames++;
        continue;
      }

      let currentFrameTotalDistance = 0;
      let numComparedLandmarks = 0;

      for (let j = 0; j < 33; j++) { // MediaPipe Pose has 33 landmarks
        const lm1 = landmarks1[j] as Landmark; // Casting from NormalizedLandmark
        const lm2 = landmarks2[j] as Landmark; // Casting from NormalizedLandmark

        // Basic check if landmark objects exist (though MediaPipe usually guarantees 33 if list exists)
        if (!lm1 || !lm2) {
            // This case is unlikely if landmarks1 and landmarks2 are valid NormalizedLandmarkList
            // and MediaPipe guarantees 33 landmarks per list.
            continue; 
        }
        
        // Optional: Visibility check (commented out as per prompt considerations)
        // const threshold = 0.5;
        // if ((lm1.visibility !== undefined && lm1.visibility < threshold) ||
        //     (lm2.visibility !== undefined && lm2.visibility < threshold)) {
        //   continue; // Skip less visible landmarks
        // }

        currentFrameTotalDistance += calculateEuclideanDistance(lm1, lm2);
        numComparedLandmarks++;
      }

      if (numComparedLandmarks > 0) {
        const avgFrameDissimilarity = currentFrameTotalDistance / numComparedLandmarks;
        frameDissimilarities.push(avgFrameDissimilarity);
      } else {
        // All landmarks were skipped (e.g., by visibility) or lists were unexpectedly empty
        frameDissimilarities.push(1.0); // Max dissimilarity
      }
    } else if (landmarks1 || landmarks2) {
      // One pose is missing
      frameDissimilarities.push(1.0); // Max dissimilarity
      mismatchedFrames++;
    } else {
      // Both poses are missing
      // Consider this low dissimilarity as both frames are "empty" similarly.
      // Or, could be high if any pose is important. For now, low.
      frameDissimilarities.push(0.1); // Low dissimilarity
    }
  }

  if (frameDissimilarities.length === 0) {
    // Should be caught by targetFrames === 0, but as a safeguard.
    return { score: 0, analysisText: 'No frame dissimilarities calculated.' };
  }

  const overallAvgDissimilarity =
    frameDissimilarities.reduce((sum, val) => sum + val, 0) /
    frameDissimilarities.length;

  // Convert dissimilarity to similarity score (0-100)
  // Score is 100 if dissimilarity is 0.
  // Score is 0 if dissimilarity is NORMALIZATION_CAP or more.
  const similarityScore = Math.max(0, (1 - overallAvgDissimilarity / NORMALIZATION_CAP)) * 100;

  let analysisText = `Overall similarity: ${similarityScore.toFixed(1)}%. `;
  analysisText += `Average dissimilarity per frame: ${overallAvgDissimilarity.toFixed(3)} (lower is better). `;
  if (mismatchedFrames > 0) {
    analysisText += `${mismatchedFrames} frame(s) had one pose missing. `;
  }
  // Could add more details: e.g., identify frames with highest dissimilarity
  // const maxDissimilarity = Math.max(...frameDissimilarities);
  // analysisText += `Maximum dissimilarity in a single frame: ${maxDissimilarity.toFixed(3)}.`;

  return {
    score: parseFloat(similarityScore.toFixed(1)), // Ensure score is also to one decimal place
    analysisText,
  };
}
