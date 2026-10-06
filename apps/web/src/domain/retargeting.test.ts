import { describe, expect, it } from "vitest";
import { hasUsablePose, mappingCoverage, retargetLandmarkFrame } from "./retargeting";
import type { Joint, LandmarkFrame } from "@/types";

const joints = [
  "waist_yaw_joint",
  "left_shoulder_pitch_joint",
  "left_shoulder_roll_joint",
  "left_shoulder_yaw_joint",
  "left_elbow_joint",
  "left_wrist_roll_joint",
  "right_shoulder_pitch_joint",
  "right_shoulder_roll_joint",
  "right_shoulder_yaw_joint",
  "right_elbow_joint",
  "right_wrist_roll_joint",
  "left_knee_joint",
].map((name) => ({ name, lower: -0.4, upper: 0.4, controllable: true } as Joint));

const point = (x: number, y: number) => ({ x, y, z: 0, visibility: 1 });
const frame: LandmarkFrame = {
  timestamp: 0,
  pose: Array.from({ length: 33 }, () => point(0.5, 0.5)),
  left_hand: Array.from({ length: 21 }, () => point(0.3, 0.4)),
  right_hand: Array.from({ length: 21 }, () => point(0.7, 0.4)),
  confidence: 1,
};

frame.pose[11] = point(0.3, 0.3);
frame.pose[13] = point(0.1, 0.7);
frame.pose[15] = point(0.6, 0.9);
frame.pose[12] = point(0.7, 0.3);
frame.pose[14] = point(0.9, 0.7);
frame.pose[16] = point(0.4, 0.9);
frame.pose[23] = point(0.35, 0.8);
frame.pose[24] = point(0.65, 0.8);

describe("retargetLandmarkFrame", () => {
  it("keeps unmapped joints neutral and clamps all G1 outputs to their limits", () => {
    const neutral = joints.map(() => 0.2);
    const output = retargetLandmarkFrame(frame, joints, neutral, "g1-upper-body");

    expect(output).toHaveLength(joints.length);
    expect(output.at(-1)).toBe(0.2);
    expect(output.some((value, index) => index < joints.length - 1 && value !== 0.2)).toBe(true);
    output.forEach((value, index) => {
      expect(value).toBeGreaterThanOrEqual(joints[index].lower);
      expect(value).toBeLessThanOrEqual(joints[index].upper);
    });
  });
});

function standing(): LandmarkFrame {
  const result: LandmarkFrame = { timestamp: 0, confidence: 1, left_hand: [], right_hand: [], pose: Array.from({ length: 33 }, () => point(0.5, 0.5)) };
  for (const [index, x, y] of [[11, .65, .2], [12, .35, .2], [13, .65, .4], [14, .35, .4], [15, .65, .6], [16, .35, .6], [23, .6, .5], [24, .4, .5], [25, .6, .7], [26, .4, .7], [27, .6, .9], [28, .4, .9]]) result.pose[index] = point(x, y);
  return result;
}
const bodyJoints = ["left_shoulder_pitch_joint", "left_shoulder_roll_joint", "left_elbow_joint", "right_shoulder_roll_joint", "right_elbow_joint", "left_hip_roll_joint", "left_knee_joint", "right_knee_joint", "waist_yaw_joint"].map(name => ({ name, lower: -3, upper: 3, controllable: true } as Joint));

it("keeps shoulders and legs neutral while aligning G1 forearms with hanging human arms", () => {
  const neutral = bodyJoints.map(() => .1);
  const expected = bodyJoints.map((joint) => joint.name.endsWith("elbow_joint") ? .1 + Math.PI / 2 : .1);
  expect(retargetLandmarkFrame(standing(), bodyJoints, neutral, "g1-full-body")).toEqual(expected);
});
it("selects anatomical left or right and leaves the opposite side and waist neutral", () => {
  const observed = standing();
  observed.pose[13] = point(.85, .2); observed.pose[15] = point(.85, .4);
  observed.pose[14] = point(.15, .2); observed.pose[16] = point(.15, .4);
  const left = retargetLandmarkFrame(observed, bodyJoints, bodyJoints.map(() => 0), "g1-left-arm");
  const right = retargetLandmarkFrame(observed, bodyJoints, bodyJoints.map(() => 0), "g1-single-arm");
  expect(left[1]).toBeCloseTo(Math.PI / 2); expect(left[3]).toBe(0);
  expect(right[1]).toBe(0); expect(right[3]).toBeCloseTo(-Math.PI / 2);
  expect(left.at(-1)).toBe(0); expect(right.at(-1)).toBe(0);
});
it("maps visible knees only in full-body mode", () => {
  const observed = standing(); observed.pose[27] = point(.8, .7);
  expect(retargetLandmarkFrame(observed, bodyJoints, bodyJoints.map(() => 0), "g1-full-body")[6]).toBeCloseTo(Math.PI / 2);
  expect(retargetLandmarkFrame(observed, bodyJoints, bodyJoints.map(() => 0), "g1-upper-body")[6]).toBe(0);
});
it("retains occluded limbs and invalid coordinates at neutral while mapping visible limbs", () => {
  const observed = standing(); observed.pose[13] = { ...point(.85, .2), visibility: .1 };
  observed.pose[14] = point(.15, .2); observed.pose[15].x = NaN;
  const output = retargetLandmarkFrame(observed, bodyJoints, bodyJoints.map(() => .1), "g1-upper-body");
  expect(output[1]).toBe(.1); expect(output[2]).toBe(.1); expect(output[3]).not.toBe(.1);
  expect(output.every(Number.isFinite)).toBe(true);
});
it("maps 3D forward motion invariant to body translation and size", () => {
  const observed = standing(); observed.pose_world = observed.pose.map(p => ({ ...p }));
  observed.pose_world[13] = { ...point(.65, .2), z: -.3 }; observed.pose_world[15] = { ...point(.65, .2), z: -.6 };
  const neutral = bodyJoints.map(() => 0);
  const output = retargetLandmarkFrame(observed, bodyJoints, neutral, "g1-upper-body");
  expect(output[0]).toBeCloseTo(-Math.PI / 2);
  observed.pose_world = observed.pose_world.map(p => ({ ...p, x: p.x * 2 + 3, y: p.y * 2 - 4, z: p.z * 2 + 1 }));
  retargetLandmarkFrame(observed, bodyJoints, neutral, "g1-upper-body").forEach((value, index) => expect(value).toBeCloseTo(output[index]));
});
it("keeps flat forward feet neutral and ignores empty world landmarks", () => {
  const observed = standing();
  observed.pose_world = [];
  const ankle = { name: "left_ankle_pitch_joint", lower: -1, upper: 1, controllable: true } as Joint;
  expect(retargetLandmarkFrame(observed, [ankle], [.1], "g1-full-body")).toEqual([.1]);
  observed.pose[29] = point(.6, .9); observed.pose[31] = point(.6, .9);
  observed.pose_world = observed.pose.map(p => ({ ...p }));
  observed.pose_world[31].z = -.2;
  expect(retargetLandmarkFrame(observed, [ankle], [.1], "g1-full-body")[0]).toBeCloseTo(.1);
  observed.pose[31].visibility = .1;
  expect(retargetLandmarkFrame(observed, [ankle], [.1], "g1-full-body")[0]).toBe(.1);
});
it("does not turn tiny lateral tracking noise into a large roll when raising an arm forward", () => {
  const observed = standing();
  observed.pose_world = observed.pose.map(p => ({ ...p }));
  observed.pose_world[13] = { ...point(.651, .199), z: -.3 };
  observed.pose_world[15] = { ...point(.652, .198), z: -.6 };
  const output = retargetLandmarkFrame(observed, bodyJoints, bodyJoints.map(() => 0), "g1-upper-body");
  expect(Math.abs(output[1])).toBeLessThan(.01);
  expect(output[0]).toBeCloseTo(-Math.PI / 2, 1);
});

it("continues full-body arm mapping when hips and legs are hidden and aggregate confidence is low", () => {
  const observed = standing();
  observed.confidence = .25;
  for (let i = 23; i < 33; i++) observed.pose[i].visibility = .1;
  observed.pose[13] = point(.85, .2);
  observed.pose[15] = point(.85, .4);
  observed.pose_world = observed.pose.map(p => ({ ...p }));
  const neutral = bodyJoints.map(() => .1);
  expect(hasUsablePose(observed)).toBe(true);
  const output = retargetLandmarkFrame(observed, bodyJoints, neutral, "g1-full-body");
  expect(output[1]).toBeGreaterThan(1);
  expect(output[6]).toBe(.1);
  expect(output[7]).toBe(.1);
  expect(output.at(-1)).toBe(.1);
  expect(mappingCoverage(observed, bodyJoints, "g1-full-body").mapped).toContain("left_shoulder_roll_joint");
});
it("maps an isolated visible elbow when the entire torso is occluded", () => {
  const observed = standing();
  for (const index of [12, 23, 24]) observed.pose[index].visibility = 0;
  observed.pose[15] = point(.85, .4);
  const elbow = { name: "left_elbow_joint", lower: -2, upper: 2, controllable: true } as Joint;
  expect(retargetLandmarkFrame(observed, [elbow], [0], "g1-full-body")[0]).toBeCloseTo(0);
  expect(mappingCoverage(observed, [elbow], "g1-full-body").mapped).toEqual(["left_elbow_joint"]);
});
it("does not drive extrapolated off-camera legs even when their visibility score is high", () => {
  const observed = standing();
  observed.pose[25].y = 1.2;
  observed.pose[27].y = 1.6;
  const knee = { name: "left_knee_joint", lower: -2, upper: 2, controllable: true } as Joint;
  expect(retargetLandmarkFrame(observed, [knee], [.3], "g1-full-body")).toEqual([.3]);
});
it("maps visible torso tilt and turn while leaving hidden legs neutral", () => {
  const observed = standing();
  observed.pose_world = observed.pose.map(p => ({ ...p }));
  for (let i = 25; i < 33; i++) observed.pose[i].visibility = 0;
  observed.pose_world[11].x += .1;
  observed.pose_world[12].x += .1;
  observed.pose_world[11].z -= .12;
  observed.pose_world[12].z -= .08;
  const names = ["waist_roll_joint", "waist_pitch_joint", "waist_yaw_joint", "left_knee_joint"];
  const joints = names.map(name => ({ name, lower: -2, upper: 2, controllable: true } as Joint));
  const output = retargetLandmarkFrame(observed, joints, joints.map(() => 0), "g1-full-body");
  expect(output[0]).toBeLessThan(0); // Anatomical lean left is a negative X-axis rotation.
  expect(output[1]).toBeGreaterThan(0); // Bend toward the camera is a positive Y-axis rotation.
  expect(output[2]).toBeLessThan(0); // Left shoulder forward turns the torso to its right.
  expect(output[3]).toBe(0);
  expect(retargetLandmarkFrame(observed, joints, joints.map(() => 0), "g1-left-arm")).toEqual([0, 0, 0, 0]);
});
it("rejects a low-confidence frame when no actual segment is visible", () => {
  const observed = standing();
  observed.confidence = .2;
  observed.pose.forEach(p => p.visibility = .1);
  expect(hasUsablePose(observed)).toBe(false);
});
