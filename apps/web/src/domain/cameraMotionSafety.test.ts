import { expect, it } from "vitest";
import { createMotionGuard, observeMotion, stepMotion, safeCameraGesture } from "./cameraMotionSafety";
import { g1ArmJoints } from "./fixtures/g1ArmJoints";
import { retargetLandmarkFrame } from "./retargeting";
import type { Joint, LandmarkFrame } from "@/types";
const joints = [{ lower: -2, upper: 2, velocity: 0.2 }] as Joint[];
const frame = (x = 0.5): LandmarkFrame => ({ timestamp: 0, confidence: 1, pose: Array.from({ length: 33 }, () => ({ x, y: .5, z: 0, visibility: 1 })), left_hand: [], right_hand: [] });
it("caps speed by URDF velocity and never catches up after suspension", () => {
  const guard = createMotionGuard([0]);
  observeMotion(guard, frame(), [10], 0);
  expect(stepMotion(guard, joints, 100, 10000)[0]).toBeCloseTo(.01);
  expect(stepMotion(guard, joints, 400, 300)[0]).toBeCloseTo(.01);
});
it("follows rapid arm targets six times faster without manual interruption", () => {
  const guard = createMotionGuard([0]);
  const free = [{ lower: -3, upper: 3 }] as Joint[];
  observeMotion(guard, frame(), [0], 0);
  observeMotion(guard, frame(), [2], 20);
  expect(guard.paused).toBe(false);
  expect(stepMotion(guard, free, 40, 20)[0]).toBeCloseTo(.06);
});
it("holds missing tracking without returning to neutral", () => {
  const guard = createMotionGuard([1]);
  observeMotion(guard, null, null, 0);
  expect(stepMotion(guard, joints, 50, 50)).toEqual([1]);
});
it("automatically recovers after a displaced subject becomes consistent", () => {
  const guard = createMotionGuard([0]);
  observeMotion(guard, frame(), [0], 0);
  observeMotion(guard, frame(.8), [1], 100);
  expect(guard.paused).toBe(true);
  expect(stepMotion(guard, joints, 100, 50)).toEqual([0]);
  observeMotion(guard, frame(.8), [1], 150);
  expect(guard.paused).toBe(true);
  observeMotion(guard, frame(.8), [1], 200);
  expect(guard.paused).toBe(false);
  expect(stepMotion(guard, joints, 200, 50)[0]).toBeCloseTo(.01);
});
it("holds gaps briefly and then recovers without a checkpoint", () => {
  const guard = createMotionGuard([0]);
  observeMotion(guard, frame(), [0], 0);
  observeMotion(guard, frame(), [1], 1000);
  expect(guard.target).toBeNull();
  observeMotion(guard, frame(), [1], 1100);
  expect(guard.paused).toBe(false);
  observeMotion(guard, frame(), [NaN], 1120);
  expect(guard.target).toBeNull();
});
it("restarts settling when observations keep switching", () => {
  const guard = createMotionGuard([0]);
  observeMotion(guard, frame(), [0], 0);
  observeMotion(guard, frame(.8), [1], 50);
  observeMotion(guard, frame(.5), [0], 100);
  observeMotion(guard, frame(.8), [1], 150);
  expect(guard.target).toBeNull();
});
it("rejects out-of-order observations and invalid timing", () => {
  const guard = createMotionGuard([0]);
  observeMotion(guard, frame(), [.2], 100);
  expect(stepMotion(guard, joints, 100, NaN)).toEqual([0]);
  observeMotion(guard, frame(), [.3], 90);
  expect(guard.target).toBeNull();
});
it("does not require torso visibility for ordinary arm-only teaching", () => {
  const guard = createMotionGuard([0]);
  const arm = { ...frame(), pose: frame().pose.map(p => ({ ...p, visibility: 0 })), confidence: 1 };
  observeMotion(guard, arm, [0], 0);
  observeMotion(guard, arm, [1], 30);
  expect(guard.paused).toBe(false);
});
it("guards saved gestures and recovers later consistent observations", () => {
  const pose: LandmarkFrame = { ...frame(), pose: Array.from({ length: 33 }, (_, i) => ({
    x: i % 2 ? .3 : .7, y: i <= 12 ? .2 : i <= 14 ? .4 : i <= 16 ? .6 : .8, z: 0,
  })) };
  const neutral = g1ArmJoints.map(() => 0);
  expect(retargetLandmarkFrame(pose, g1ArmJoints, neutral, "g1-upper-body").some(q => Math.abs(q) > .05)).toBe(true);
  const switched = { ...pose, timestamp: 200, pose: pose.pose.map(p => ({ ...p, x: p.x + .4 })) };
  const guarded = safeCameraGesture([pose, { ...pose, timestamp: 100 }, switched, { ...switched, timestamp: 300 }], g1ArmJoints, neutral, "g1-upper-body");
  expect(guarded.pausedAt).toBe(200);
  expect(guarded.positions[2]).toEqual(guarded.positions[1]);
  expect(guarded.positions[3]).not.toEqual(guarded.positions[2]);
});
