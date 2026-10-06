import type { Joint, LandmarkFrame } from "@/types";
import { hasUsablePose, retargetLandmarkFrame, type RetargetingProfile } from "./retargeting";

export const CAMERA_SPEED_LIMIT = 3; // preview radians/second; hardware has independent limits
export const CAMERA_STALE_MS = 250;
const REACQUIRE_MS = 100;
export type MotionGuard = {
  positions: number[];
  target: number[] | null;
  previous: LandmarkFrame | null;
  receivedAt: number;
  paused: boolean;
  candidate: { frame: LandmarkFrame; target: number[]; since: number } | null;
};
export function createMotionGuard(positions: number[]): MotionGuard {
  return { positions: [...positions], target: null, previous: null, receivedAt: -Infinity, paused: false, candidate: null };
}
function discontinuity(previous: LandmarkFrame, frame: LandmarkFrame) {
  const visible = [11, 12, 23, 24].filter((i) => [previous.pose[i], frame.pose[i]].every(
    (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.visibility ?? 1) >= 0.5,
  ));
  // Missing torso points are common in arm teaching; they cannot establish an identity change.
  return visible.length >= 2 && visible.some((i) => Math.hypot(previous.pose[i].x - frame.pose[i].x, previous.pose[i].y - frame.pose[i].y) > 0.18);
}
export function observeMotion(guard: MotionGuard, frame: LandmarkFrame | null, target: number[] | null, now: number) {
  if (!Number.isFinite(now) || now < guard.receivedAt || !frame || !hasUsablePose(frame)
    || !target || target.length !== guard.positions.length || !target.every(Number.isFinite)) {
    guard.target = null;
    guard.candidate = null;
    return;
  }
  const gap = guard.previous && now - guard.receivedAt > CAMERA_STALE_MS;
  if (guard.paused || gap || (guard.previous && discontinuity(guard.previous, frame))) {
    guard.paused = true;
    guard.target = null;
    const candidate = guard.candidate;
    if (!candidate || discontinuity(candidate.frame, frame)
      || target.some((q, i) => Math.abs(q - candidate.target[i]) > 0.4)) {
      guard.candidate = { frame, target: [...target], since: now };
    } else {
      guard.candidate = { ...candidate, frame, target: [...target] };
      if (now - candidate.since >= REACQUIRE_MS) {
        guard.paused = false;
        guard.candidate = null;
      }
    }
  }
  guard.previous = frame;
  guard.receivedAt = now;
  if (!guard.paused) guard.target = [...target];
}
export function stepMotion(guard: MotionGuard, joints: Joint[], now: number, elapsedMs: number, maxSpeed = CAMERA_SPEED_LIMIT) {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(now) || !Number.isFinite(maxSpeed) || maxSpeed <= 0
    || guard.paused || !guard.target || now - guard.receivedAt > CAMERA_STALE_MS) return [...guard.positions];
  const dt = Math.max(0, Math.min(50, elapsedMs)) / 1000;
  guard.positions = guard.positions.map((q, i) => {
    const joint = joints[i];
    if (!joint || !Number.isFinite(q)) return q;
    const speed = Math.min(maxSpeed, joint.velocity != null && joint.velocity > 0 ? joint.velocity : maxSpeed);
    const target = Math.max(joint.lower, Math.min(joint.upper, guard.target![i]));
    return q + Math.max(-speed * dt, Math.min(speed * dt, target - q));
  });
  return [...guard.positions];
}
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
