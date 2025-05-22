import { calculateSimilarity } from './analysis'; // Adjust path as necessary
import { NormalizedLandmarkList, NormalizedLandmark } from '@mediapipe/pose';

// Helper to create mock NormalizedLandmarkList
const createMockLandmarks = (baseValue: number = 0, count: number = 33): NormalizedLandmarkList => {
  const landmarks: NormalizedLandmark[] = [];
  for (let i = 0; i < count; i++) {
    landmarks.push({
      x: baseValue + i * 0.01,
      y: baseValue + i * 0.01,
      z: baseValue + i * 0.01,
      visibility: 0.9, // Assume good visibility for mock
    });
  }
  return landmarks;
};

describe('calculateSimilarity', () => {
  const targetFrames = 3;

  test('should return 100% similarity for identical poses', () => {
    const poses1: (NormalizedLandmarkList | undefined)[] = [
      createMockLandmarks(0.1),
      createMockLandmarks(0.2),
      createMockLandmarks(0.3),
    ];
    const { score, analysisText } = calculateSimilarity(poses1, poses1, targetFrames);
    expect(score).toBeCloseTo(100);
    expect(analysisText).toContain('Overall similarity: 100.0%');
  });

  test('should return ~0% similarity for completely different poses', () => {
    const poses1: (NormalizedLandmarkList | undefined)[] = [
      createMockLandmarks(0.1),
      createMockLandmarks(0.2),
      createMockLandmarks(0.3),
    ];
    const poses2: (NormalizedLandmarkList | undefined)[] = [
      createMockLandmarks(10.0), // Values far apart
      createMockLandmarks(11.0),
      createMockLandmarks(12.0),
    ];
    // NORMALIZATION_CAP is 0.5. If average distance is >= 0.5, score is 0.
    // Here, distances will be very large.
    const { score, analysisText } = calculateSimilarity(poses1, poses2, targetFrames);
    expect(score).toBeCloseTo(0);
    expect(analysisText).toContain('Overall similarity: 0.0%');
  });

  test('should handle missing poses in one video for some frames', () => {
    const poses1: (NormalizedLandmarkList | undefined)[] = [
      createMockLandmarks(0.1),
      undefined, // Frame 2 missing in video 1
      createMockLandmarks(0.3),
    ];
    const poses2: (NormalizedLandmarkList | undefined)[] = [
      createMockLandmarks(0.1), // Frame 1 similar
      createMockLandmarks(0.2), // Frame 2 present in video 2
      createMockLandmarks(0.31),// Frame 3 slightly different
    ];
    // Frame 0: dissimilarity ~0
    // Frame 1: dissimilarity 1.0 (mismatched)
    // Frame 2: dissimilarity small (e.g. if 0.3 vs 0.31, very small)
    // Overall avg dissimilarity: (0 + 1.0 + small_val) / 3 = ~0.33
    // Score = (1 - 0.33 / 0.5) * 100 = (1 - 0.66) * 100 = ~34%
    const { score, analysisText } = calculateSimilarity(poses1, poses2, targetFrames);
    // This score will be affected by the 1.0 dissimilarity for the missing frame
    expect(score).toBeLessThan(70); // Expect less than perfect, but not 0
    expect(score).toBeGreaterThan(10);
    expect(analysisText).toContain('1 frame(s) had one pose missing.');
  });

  test('should handle missing poses in both videos for some frames', () => {
    const poses1: (NormalizedLandmarkList | undefined)[] = [
      createMockLandmarks(0.1),
      undefined, // Frame 2 missing
      createMockLandmarks(0.3),
    ];
    const poses2: (NormalizedLandmarkList | undefined)[] = [
      createMockLandmarks(0.1),
      undefined, // Frame 2 also missing
      createMockLandmarks(0.3),
    ];
    // Frame 0: dissimilarity ~0
    // Frame 1: dissimilarity 0.1 (both missing)
    // Frame 2: dissimilarity ~0
    // Overall avg dissimilarity: (0 + 0.1 + 0) / 3 = ~0.033
    // Score = (1 - 0.033 / 0.5) * 100 = (1 - 0.066) * 100 = ~93.4%
    const { score, analysisText } = calculateSimilarity(poses1, poses2, targetFrames);
    expect(score).toBeGreaterThan(90);
    expect(analysisText).not.toContain('mismatchedFrames'); // Both missing is not a "mismatch" in the context of one having data
  });

  test('should handle input arrays of different lengths than targetFrames', () => {
    const poses1: (NormalizedLandmarkList | undefined)[] = [createMockLandmarks(0.1)]; // Length 1
    const poses2: (NormalizedLandmarkList | undefined)[] = [createMockLandmarks(0.1), createMockLandmarks(0.2)]; // Length 2
    const { score, analysisText } = calculateSimilarity(poses1, poses2, targetFrames); // targetFrames = 3
    expect(score).toBe(0);
    expect(analysisText).toContain('Error: Landmark data length mismatch.');
  });
  
  test('should handle targetFrames being 0', () => {
    const { score, analysisText } = calculateSimilarity([], [], 0);
    expect(score).toBe(0);
    expect(analysisText).toBe('No frames to compare.');
  });

  test('should handle poses with fewer than 33 landmarks (malformed)', () => {
    const poses1: (NormalizedLandmarkList | undefined)[] = [
        createMockLandmarks(0.1), 
        createMockLandmarks(0.2, 10) // Malformed: only 10 landmarks
    ];
    const poses2: (NormalizedLandmarkList | undefined)[] = [
        createMockLandmarks(0.1), 
        createMockLandmarks(0.2) // Correct
    ];
    // Frame 0: dissimilarity ~0
    // Frame 1: dissimilarity 1.0 (malformed landmark count)
    // Overall avg dissimilarity: (0 + 1.0) / 2 = 0.5
    // Score = (1 - 0.5 / 0.5) * 100 = 0
    const { score, analysisText } = calculateSimilarity(poses1, poses2, 2);
    expect(score).toBe(0); // Or a very low score depending on how it's penalized
    expect(analysisText).toContain('Unexpected number of landmarks');
  });

  test('should handle case where all landmarks are skipped (e.g., due to visibility, if implemented)', () => {
    // This test assumes that if numComparedLandmarks is 0, dissimilarity is 1.0
    const emptyLandmarks: NormalizedLandmarkList = []; // No landmarks to compare
    const poses1: (NormalizedLandmarkList | undefined)[] = [emptyLandmarks];
    const poses2: (NormalizedLandmarkList | undefined)[] = [emptyLandmarks];
    // The current code pushes 1.0 dissimilarity if numComparedLandmarks is 0 (after checking landmarks1 & 2 exist)
    // Or, if the landmark lists are actually empty, it might be caught by landmarks1.length !==33.
    // Let's test with valid but empty lists, which will trigger the length check.
    const { score, analysisText } = calculateSimilarity(poses1, poses2, 1);
    expect(score).toBe(0); // Because dissimilarity will be 1.0 due to length mismatch
    expect(analysisText).toContain('Unexpected number of landmarks');

    // If we had 33 landmarks, but all were not "visible" (hypothetically):
    const nonVisibleLandmarks = createMockLandmarks(0.1).map(lm => ({...lm, visibility: 0.1 }));
    const poses3 = [nonVisibleLandmarks as NormalizedLandmarkList];
    const poses4 = [nonVisibleLandmarks as NormalizedLandmarkList];
    // If visibility check was active and skipped all, numComparedLandmarks would be 0.
    // calculateSimilarity would then assign 1.0 dissimilarity.
    // Since visibility is not checked, this will result in 100% similarity.
    const { score: score2 } = calculateSimilarity(poses3, poses4, 1);
    expect(score2).toBeCloseTo(100);
  });

  test('should produce intermediate similarity for partially different poses', () => {
    const poses1: (NormalizedLandmarkList | undefined)[] = [
      createMockLandmarks(0.1),
      createMockLandmarks(0.2),
      createMockLandmarks(0.3),
    ];
    const poses2: (NormalizedLandmarkList | undefined)[] = [
      createMockLandmarks(0.1),        // Identical
      createMockLandmarks(0.25),       // Slightly different
      createMockLandmarks(1.0),        // Very different
    ];
    // Frame 0: dissimilarity ~0
    // Frame 1: dissimilarity small (e.g., sum of (0.05*0.01)*33 for each landmark for x,y,z )
    //          avg landmark dist = sqrt(3 * (0.05)^2) = sqrt(0.0075) ~ 0.086
    // Frame 2: dissimilarity large (e.g., sum of (0.7*0.01)*33 )
    //          avg landmark dist = sqrt(3 * (0.7)^2) = sqrt(1.47) ~ 1.21 (capped at NORMALIZATION_CAP for score calc implicitly)
    // Avg Dissimilarity: (0 + 0.086 + 1.21) / 3 = 1.296 / 3 = 0.432
    // Score = (1 - 0.432 / 0.5) * 100 = (1 - 0.864) * 100 = 13.6%
    const { score, analysisText } = calculateSimilarity(poses1, poses2, targetFrames);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
    expect(score).toBeCloseTo(13.6, 0); // Check with 1 decimal place precision
  });
});
