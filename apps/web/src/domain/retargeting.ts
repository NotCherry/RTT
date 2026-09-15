import type { Joint, LandmarkFrame } from "@/types";

export type RetargetingProfile = "g1-upper-body" | "g1-single-arm";

export type RetargetingAdjustments = Record<string, { scale: number; offset: number }>;

function clamp(value: number, joint: Joint) {
  return Math.max(joint.lower, Math.min(joint.upper, value));
}

function angle(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

function jointAngle(frame: LandmarkFrame, shoulder: number, elbow: number, wrist: number) {
  const points = frame.pose;
  if (!points[shoulder] || !points[elbow] || !points[wrist]) return 0;
  const upper = angle(points[shoulder], points[elbow]);
  const lower = angle(points[elbow], points[wrist]);
  return Math.atan2(Math.sin(lower - upper), Math.cos(lower - upper));
}

/**
 * Converts observable camera angles to a conservative G1 posture. Unmapped
 * joints deliberately stay at the calibrated neutral position.
 */
export function retargetLandmarkFrame(
  frame: LandmarkFrame,
  joints: Joint[],
  neutral: number[],
  profile: RetargetingProfile,
  adjustments: RetargetingAdjustments = {},
) {
  const next = [...neutral];
  const write = (name: string, raw: number) => {
    const index = joints.findIndex((joint) => joint.name === name);
    if (index < 0) return;
    const adjustment = adjustments[name] ?? { scale: 1, offset: 0 };
    next[index] = clamp(raw * adjustment.scale + adjustment.offset, joints[index]);
  };
  const pose = frame.pose;
  const leftShoulder = pose[11];
  const rightShoulder = pose[12];
  const leftHip = pose[23];
  const rightHip = pose[24];
  if (leftShoulder && rightShoulder && leftHip && rightHip) {
    write("waist_yaw_joint", angle(leftHip, rightHip) - angle(leftShoulder, rightShoulder));
  }
  const applyArm = (side: "left" | "right") => {
    const shoulder = side === "left" ? 11 : 12;
    const elbow = side === "left" ? 13 : 14;
    const wrist = side === "left" ? 15 : 16;
    const shoulderPoint = pose[shoulder];
    const elbowPoint = pose[elbow];
    if (!shoulderPoint || !elbowPoint) return;
    const armDirection = angle(shoulderPoint, elbowPoint);
    write(`${side}_shoulder_pitch_joint`, -armDirection);
    write(`${side}_shoulder_roll_joint`, elbowPoint.x - shoulderPoint.x);
    write(`${side}_shoulder_yaw_joint`, elbowPoint.y - shoulderPoint.y);
    write(`${side}_elbow_joint`, jointAngle(frame, shoulder, elbow, wrist));
    const hand = side === "left" ? frame.left_hand : frame.right_hand;
    if (hand[0] && hand[9]) write(`${side}_wrist_roll_joint`, angle(hand[0], hand[9]));
  };
  if (profile === "g1-upper-body") {
    applyArm("left");
    applyArm("right");
  } else {
    applyArm("right");
  }
  return next;
}

export function hasUsablePose(frame: LandmarkFrame, minimumConfidence = 0.5) {
  return frame.confidence >= minimumConfidence && frame.pose.length >= 17;
}
