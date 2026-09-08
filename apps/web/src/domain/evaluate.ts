import type {
  Demonstration,
  DemonstrationFrame,
  TrainingConfig,
} from "../types";

export type RolloutArgs = {
  frames: DemonstrationFrame[];
  current: number[];
  timestepMs: number;
  maxSteps: number;
  approachMode: "scripted" | "learned";
  timelineFps: number | null;
};

/**
 * Build the evaluation rollout request from the archived demonstration.
 * Stage 1 always uses the scripted bounded-interpolation controller, and
 * gesture density follows the authored timeline fps so the predicted
 * trajectory covers the motion faithfully (timestep stays as fallback).
 */
function framesWithInterpolation(demonstration: Demonstration): DemonstrationFrame[] {
  // Prefer keyframes so step vs linear interpolation is preserved through rollout.
  // Mirrors backend authored_frames() preference.
  if (demonstration.keyframes && demonstration.keyframes.length) {
    const ordered = [...demonstration.keyframes].sort((a, b) => a.frame - b.frame);
    return ordered.map((k) => ({
      timestamp: k.timestamp,
      positions: [...k.positions],
      interpolation: k.interpolation,
    }));
  }
  return demonstration.frames;
}

export function buildRolloutArgs(
  demonstration: Demonstration,
  config: TrainingConfig,
): RolloutArgs {
  return {
    frames: framesWithInterpolation(demonstration),
    current: demonstration.current,
    timestepMs: config.timestep_ms,
    maxSteps: config.rollout_steps,
    approachMode: "scripted",
    timelineFps: demonstration.timeline_fps ?? null,
  };
}
