import type { Joint, LandmarkFrame } from "@/types";
import { hasUsablePose, retargetLandmarkFrame, type RetargetingProfile } from "./retargeting";

export const CAMERA_SPEED_LIMIT = 0.5; // radians/second; preview default, not a hardware rating
export const CAMERA_STALE_MS = 250;
export type MotionGuard = {
  positions: number[];
  target: number[] | null;
  previous: LandmarkFrame | null;
  previousTarget: number[] | null;
  receivedAt: number;
  paused: boolean;
};
export function createMotionGuard(positions: number[]): MotionGuard {
  return { positions: [...positions], target: null, previous: null, previousTarget: null, receivedAt: -Infinity, paused: false };
}
function discontinuity(previous: LandmarkFrame, frame: LandmarkFrame) {
  // Image-space torso continuity is a heuristic, not person identification.
  const indices = [11, 12, 23, 24];
  const visible = indices.filter((i) => [previous.pose[i], frame.pose[i]].every(
    (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 1) >= 0.5,
  ));
  if (visible.length < 2) return true;
  return visible.some((i) => Math.hypot(previous.pose[i].x - frame.pose[i].x, previous.pose[i].y - frame.pose[i].y) > 0.18);
}
export function observeMotion(guard: MotionGuard, frame: LandmarkFrame | null, target: number[] | null, now: number) {
  if (!Number.isFinite(now) || now < guard.receivedAt) {
    guard.target = null;
    guard.paused = true;
    return;
  }
  if (!frame || !hasUsablePose(frame) || !target || target.length !== guard.positions.length || !target.every(Number.isFinite)) {
    guard.target = null;
    return;
  }
  const gap = guard.previous && now - guard.receivedAt > CAMERA_STALE_MS;
  const jump = guard.previous && (discontinuity(guard.previous, frame)
    || (guard.previousTarget && target.some((q, i) => Math.abs(q - guard.previousTarget![i]) > 0.8)));
  if (gap || jump) guard.paused = true;
  guard.previous = frame;
  guard.receivedAt = now;
  guard.target = [...target];
  guard.previousTarget = [...target];
}
export function stepMotion(guard: MotionGuard, joints: Joint[], now: number, elapsedMs: number) {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(now) || guard.paused || !guard.target || now - guard.receivedAt > CAMERA_STALE_MS) return [...guard.positions];
  // Never spend a suspended tab's elapsed time as one large command step.
  const dt = Math.max(0, Math.min(100, elapsedMs)) / 1000;
  guard.positions = guard.positions.map((q, i) => {
    const joint = joints[i];
    if (!joint || !Number.isFinite(q)) return q;
    const speed = Math.min(CAMERA_SPEED_LIMIT, joint.velocity != null && joint.velocity > 0 ? joint.velocity : CAMERA_SPEED_LIMIT);
    const target = Math.max(joint.lower, Math.min(joint.upper, guard.target![i]));
    return q + Math.max(-speed * dt, Math.min(speed * dt, target - q));
  });
  return [...guard.positions];
}

/** Preserve observation timestamps; missing time never authorizes a teleport. */
export function safeCameraGesture(frames: LandmarkFrame[], joints: Joint[], neutral: number[], profile: RetargetingProfile) {
  const guard = createMotionGuard(neutral);
  let previousTime = frames[0]?.timestamp ?? 0;
  let pausedAt: number | null = null;
  const positions = frames.map((frame) => {
    observeMotion(guard, frame, retargetLandmarkFrame(frame, joints, neutral, profile), frame.timestamp);
    if (guard.paused && pausedAt === null) pausedAt = frame.timestamp;
    const positions = stepMotion(guard, joints, frame.timestamp, frame.timestamp - previousTime);
    previousTime = frame.timestamp;
    return positions;
  });
  return { positions, pausedAt };
}
