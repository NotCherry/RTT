import { describe, expect, it } from "vitest";
import {
  buildIncrementalSamples,
  framesToKeyframes,
  interpolatePositions,
  keyframesToFrames,
  normalizeFrames,
} from "./timeline";

describe("gesture timeline", () => {
  it("keeps authored keyframes separate from derived playback frames", () => {
    const keyframes = framesToKeyframes(
      [
        { timestamp: 0, positions: [0, 0] },
        { timestamp: 800, positions: [1, -1] },
      ],
      20,
    );
    expect(keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 16]);
    expect(keyframesToFrames(keyframes, 20)[1]).toEqual({
      timestamp: 800,
      positions: [1, -1],
    });
  });

  const frames = [
    { timestamp: 200, positions: [1, 2] },
    { timestamp: 0, positions: [0, 0] },
  ];

  it("orders frames and interpolates every joint between checkpoints", () => {
    expect(normalizeFrames(frames)).toEqual([
      { timestamp: 0, positions: [0, 0] },
      { timestamp: 200, positions: [1, 2] },
    ]);
    expect(interpolatePositions(frames, 100)).toEqual([0.5, 1]);
  });

  it("creates small next-state deltas for each timeline segment", () => {
    const samples = buildIncrementalSamples(
      [
        { timestamp: 0, positions: [0, 0] },
        { timestamp: 300, positions: [0.9, -0.6] },
      ],
      100,
    );
    expect(samples).toHaveLength(3);
    expect(samples[0]).toMatchObject({
      current: [0, 0],
      goal: [0.9, -0.6],
      progress: 0,
    });
    samples.forEach((sample) => {
      expect(sample.delta[0]).toBeCloseTo(0.3, 10);
      expect(sample.delta[1]).toBeCloseTo(-0.2, 10);
    });
  });
});
