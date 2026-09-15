import { describe, expect, it } from "vitest";
import { retargetLandmarkFrame } from "./retargeting";
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
