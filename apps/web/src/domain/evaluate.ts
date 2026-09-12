import type {
  Demonstration,
  DemonstrationFrame,
  RolloutFrame,
  TrainingConfig,
} from "../types";

const DEFAULT_ROLLOUT_STEPS = 160;
const POSE_PREVIEW_STEPS = 12;
const POSE_PREVIEW_STEP_MS = 60;

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
function framesWithInterpolation(
  demonstration: Demonstration,
): DemonstrationFrame[] {
  // Prefer keyframes so step vs linear interpolation is preserved through rollout.
  // Mirrors backend authored_frames() preference.
  if (demonstration.keyframes && demonstration.keyframes.length) {
    const ordered = [...demonstration.keyframes].sort(
      (a, b) => a.frame - b.frame,
    );
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
    // Keep the public API contract positive. A stale config saved with the
    // former 0=auto sentinel must not make evaluation fail with 422.
    maxSteps:
      config.rollout_steps > 0 ? config.rollout_steps : DEFAULT_ROLLOUT_STEPS,
    approachMode: "scripted",
    timelineFps: demonstration.timeline_fps ?? null,
  };
}

export function buildPosePredictionPreviewFrames(
  current: number[],
  predicted: number[],
  target: number[],
): RolloutFrame[] {
  const frameCount = POSE_PREVIEW_STEPS;
  return Array.from({ length: frameCount + 1 }, (_, step) => {
    const progress = step / frameCount;
    const interpolate = (start: number, end: number) =>
      start + (end - start) * progress;
    return {
      timestamp: step * POSE_PREVIEW_STEP_MS,
      positions: predicted.map((value, index) =>
        interpolate(current[index] ?? value, value),
      ),
      expected: target.map((value, index) =>
        interpolate(current[index] ?? value, value),
      ),
      phase: step === 0 ? "approach" : "gesture",
      source:
        step === frameCount ? "model-prediction" : "derived-preview",
    };
  });
}
