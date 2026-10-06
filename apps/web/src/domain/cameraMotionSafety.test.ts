import { expect, it } from "vitest";
import { createMotionGuard, observeMotion, stepMotion, safeCameraGesture } from "./cameraMotionSafety";
import { g1ArmJoints } from "./fixtures/g1ArmJoints";
import { retargetLandmarkFrame } from "./retargeting";
import type { Joint, LandmarkFrame } from "@/types";
const joints = [{ lower: -2, upper: 2, velocity: 0.2 }] as Joint[];
const frame = (x = 0.5): LandmarkFrame => ({ timestamp: 0, confidence: 1, pose: Array.from({ length: 33 }, () => ({ x, y: 0.5, z: 0, visibility: 1 })), left_hand: [], right_hand: [] });
it("caps speed by both the preview limit and URDF velocity and never catches up after suspension", () => {
  const guard = createMotionGuard([0]);
  observeMotion(guard, frame(), [10], 0);
  expect(stepMotion(guard, joints, 100, 10000)[0]).toBeCloseTo(0.02);
  expect(stepMotion(guard, joints, 400, 300)[0]).toBeCloseTo(0.02);
});
it("holds on missing tracking rather than returning to neutral", () => {
  const guard = createMotionGuard([1]);
  observeMotion(guard, null, null, 0);
  expect(stepMotion(guard, joints, 50, 50)).toEqual([1]);
});
it("latches a person jump until explicitly resumed, then approaches gradually", () => {
  const guard = createMotionGuard([0]);
  observeMotion(guard, frame(), [0], 0);
  observeMotion(guard, frame(0.8), [1], 100);
  expect(guard.paused).toBe(true);
  expect(stepMotion(guard, joints, 100, 100)).toEqual([0]);
  observeMotion(guard, frame(0.8), [1], 150);
  expect(guard.paused).toBe(true);
  guard.paused = false;
  expect(stepMotion(guard, joints, 150, 50)[0]).toBeCloseTo(0.01);
});
it("requires confirmation after a long gap and rejects nonfinite target packets", () => {
  const guard = createMotionGuard([0]);
  observeMotion(guard, frame(), [0], 0);
  observeMotion(guard, frame(), [1], 1000);
  expect(guard.paused).toBe(true);
  observeMotion(guard, frame(), [NaN], 1100);
  expect(guard.target).toBeNull();
});
it("still detects a joint teleport following a missing observation", () => {
  const guard = createMotionGuard([0]);
  observeMotion(guard, frame(), [0], 0);
  observeMotion(guard, null, null, 50);
  observeMotion(guard, frame(), [1.5], 100);
  expect(guard.paused).toBe(true);
});
it("rejects out-of-order observations and invalid tick timing", () => {
  const guard = createMotionGuard([0]);
  observeMotion(guard, frame(), [0.2], 100);
  expect(stepMotion(guard, joints, 100, NaN)).toEqual([0]);
  observeMotion(guard, frame(), [0.3], 90);
  expect(guard.paused).toBe(true);
  expect(guard.target).toBeNull();
});

it("guards archived gestures and holds the rest of a clip after a subject discontinuity", () => {
  const pose: LandmarkFrame = { ...frame(), pose: Array.from({ length: 33 }, (_, i) => ({
    x: i % 2 ? 0.3 : 0.7, y: i <= 12 ? 0.2 : i <= 14 ? 0.4 : i <= 16 ? 0.6 : 0.8, z: 0,
  })) };
  const neutral = g1ArmJoints.map(() => 0);
  expect(retargetLandmarkFrame(pose, g1ArmJoints, neutral, "g1-upper-body").some(q => Math.abs(q) > 0.05)).toBe(true);
  const switched = { ...pose, timestamp: 200, pose: pose.pose.map(p => ({ ...p, x: p.x + 0.4 })) };
  const guarded = safeCameraGesture([pose, { ...pose, timestamp: 100 }, switched, { ...switched, timestamp: 300 }], g1ArmJoints, neutral, "g1-upper-body");
  const result = guarded.positions;
  expect(guarded.pausedAt).toBe(200);
  expect(result[0]).toEqual(neutral);
  expect(result[1].some(q => Math.abs(q) > 0)).toBe(true);
  expect(result[1].every(q => Math.abs(q) <= 0.05)).toBe(true);
  expect(result[2]).toEqual(result[1]);
  expect(result[3]).toEqual(result[1]);
});
