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
export function buildRolloutArgs(
  demonstration: Demonstration,
  config: TrainingConfig,
): RolloutArgs {
  return {
    frames: demonstration.frames,
    current: demonstration.current,
    timestepMs: config.timestep_ms,
    maxSteps: config.rollout_steps,
    approachMode: "scripted",
    timelineFps: demonstration.timeline_fps ?? null,
  };
}
