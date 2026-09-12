import { describe, expect, it } from "vitest";
import {
  buildPosePredictionPreviewFrames,
  buildRolloutArgs,
} from "./evaluate";
import type { Demonstration, TrainingConfig } from "../types";

const config: TrainingConfig = {
  hidden_layers: [64, 64],
  activation: "relu",
  learning_rate: 0.003,
  epochs: 300,
  batch_size: 16,
  timestep_ms: 120,
  random_starts: 4,
  random_seed: 7,
  rollout_steps: 160,
};

function gesture(timelineFps?: number): Demonstration {
  return {
    id: "g1",
    name: "Wave",
    kind: "gesture",
    current: [0, 0],
    target: [0.5, 0.5],
    frames: [
      { timestamp: 0, positions: [0, 0] },
      { timestamp: 500, positions: [0.5, 0.5] },
    ],
    timeline_fps: timelineFps,
    duration_frames: 30,
    start_frame_index: 0,
  };
}

describe("rollout request", () => {
  it("forwards the timeline fps and uses the scripted approach", () => {
    const args = buildRolloutArgs(gesture(30), config);
    expect(args.timelineFps).toBe(30);
    expect(args.approachMode).toBe("scripted");
    expect(args.maxSteps).toBe(160);
    expect(args.timestepMs).toBe(120);
  });

  it("falls back to null fps when the demonstration has none", () => {
    expect(buildRolloutArgs(gesture(), config).timelineFps).toBeNull();
  });

  it("keeps legacy zero budgets positive and prefers keyframes for playback", () => {
    const args = buildRolloutArgs(
      {
        ...gesture(60),
        frames: [],
        keyframes: [
          {
            id: "k0",
            frame: 0,
            timestamp: 0,
            positions: [0, 0],
            interpolation: "linear",
          },
          {
            id: "k1",
            frame: 30,
            timestamp: 500,
            positions: [0.5, 0.5],
            interpolation: "linear",
          },
        ],
      },
      { ...config, rollout_steps: 0 },
    );
    expect(args.maxSteps).toBe(160);
    expect(args.frames).toHaveLength(2);
    expect(args.frames[1].positions).toEqual([0.5, 0.5]);
  });
});

describe("pose evaluation replay", () => {
  it("turns a static prediction into a visible transition", () => {
    const frames = buildPosePredictionPreviewFrames(
      [0, 0],
      [0.6, -0.4],
      [0.5, -0.5],
    );

    expect(frames).toHaveLength(13);
    expect(frames[0]).toMatchObject({
      timestamp: 0,
      positions: [0, 0],
      expected: [0, 0],
      phase: "approach",
      source: "derived-preview",
    });
    expect(frames.at(-1)).toMatchObject({
      timestamp: 720,
      positions: [0.6, -0.4],
      expected: [0.5, -0.5],
      phase: "gesture",
      source: "model-prediction",
    });
  });
});
