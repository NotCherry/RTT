import type { Joint, LandmarkFrame } from "@/types";
import { bodyBasis, dot, midpoint, posePoint, robotVector, rotateX, rotateY, rotateZ, sub, unit, visiblePosePoint, type BodyBasis } from "./retargetingGeometry";

export type RetargetingProfile = "g1-upper-body" | "g1-single-arm" | "g1-left-arm" | "g1-full-body";
export const RETARGETING_PROFILE_VERSION = 3;
export type RetargetingAdjustments = Record<string, { scale: number; offset: number }>;
const upright = { x: 0, y: 1, z: 0 };
const boundedAsin = (value: number) => Math.asin(Math.max(-1, Math.min(1, value)));

/** Map each visible segment independently; never require an entire body to be visible. */
function observations(frame: LandmarkFrame, profile: RetargetingProfile, joints: Joint[]) {
  const values: Record<string, number> = {};
  if (!hasUsablePose(frame)) return values;
  const depth = Boolean(frame.pose_world?.length);
  const point = (index: number) => posePoint(frame, index);
  const ls = point(11), rs = point(12), lh = point(23), rh = point(24);
  const hipSpan = lh && rh ? sub(lh, rh) : null;
  const torsoDown = ls && rs && lh && rh ? sub(midpoint(lh, rh), midpoint(ls, rs)) : null;
  // Missing hips still permit shoulder-relative arm motion. Torso tilt then stays neutral.
  const torso = ls && rs ? bodyBasis(sub(ls, rs), torsoDown ?? upright) : null;
  const pelvis = hipSpan ? bodyBasis(hipSpan, upright) : null;
  const singleArm = profile === "g1-single-arm" || profile === "g1-left-arm";
  if (!singleArm && torsoDown && torso && pelvis) {
    // Decompose the G1 waist chain in its actual yaw → roll → pitch order.
    values.waist_roll_joint = -boundedAsin(dot(torso.left, pelvis.down));
    if (depth) {
      values.waist_pitch_joint = Math.atan2(dot(torso.forward, pelvis.down), dot(torso.down, pelvis.down));
      values.waist_yaw_joint = -Math.atan2(dot(torso.left, pelvis.forward), dot(torso.left, pelvis.left));
    }
  }
  function limb(side: "left" | "right", leg: boolean, basis: BodyBasis | null) {
    const first = leg ? (side === "left" ? 23 : 24) : (side === "left" ? 11 : 12);
    const a = point(first), b = point(first + 2), c = point(first + 4);
    const upper = a && b ? unit(sub(b, a)) : null;
    const lower = b && c ? unit(sub(c, b)) : null;
    const prefix = `${side}_${leg ? "hip" : "shoulder"}`;
    const pitchOrigin = leg ? 0 : joints.find(joint => joint.name === `${side}_shoulder_pitch_joint`)?.origin?.rpy?.[0] ?? 0;
    const rollOrigin = leg ? 0 : joints.find(joint => joint.name === `${side}_shoulder_roll_joint`)?.origin?.rpy?.[0] ?? 0;
    const localUpper = upper && basis ? rotateX(robotVector(upper, basis), depth ? -pitchOrigin : 0) : null;
    // G1's pitch joint is canted; solve in its fixed frame before the roll joint.
    const roll = localUpper ? boundedAsin(localUpper.y) - (depth ? rollOrigin : 0) : null;
    // At a fully lateral arm raise, pitch has no observable direction. Keep it zero.
    const pitch = upper && basis && depth
      ? localUpper && Math.hypot(localUpper.x, localUpper.z) > .05
        ? -Math.atan2(localUpper.x, -localUpper.z) : 0
      : null;
    if (roll !== null) values[`${prefix}_roll_joint`] = roll;
    if (pitch !== null) values[`${prefix}_pitch_joint`] = pitch;
    let yaw = 0;
    let elbow: number | null = null;
    if (upper && lower) {
      const flexion = Math.acos(Math.max(-1, Math.min(1, dot(upper, lower))));
      if (leg) values[`${side}_knee_joint`] = flexion;
      else {
        // G1's zero-angle forearm points forward, while its upper arm points down.
        // Straight human elbows therefore require +pi/2, rather than zero.
        elbow = Math.PI / 2 - flexion;
        if (basis && pitch !== null && roll !== null) {
          const localLower = rotateX(rotateY(rotateX(robotVector(lower, basis), -pitchOrigin), -pitch), -(roll + rollOrigin));
          if (Math.hypot(localLower.x, localLower.y) > .15) {
            yaw = Math.atan2(localLower.y, localLower.x);
            values[`${side}_shoulder_yaw_joint`] = yaw;
          }
          elbow = Math.atan2(-localLower.z, Math.hypot(localLower.x, localLower.y));
        }
        values[`${side}_elbow_joint`] = elbow;
      }
    }
    if (leg && depth && basis && lower && c) {
      const heel = point(side === "left" ? 29 : 30), toe = point(side === "left" ? 31 : 32);
      const foot = heel && toe ? unit(sub(toe, heel)) : null;
      if (foot) values[`${side}_ankle_pitch_joint`] = Math.atan2(dot(foot, basis.down), dot(foot, basis.forward)) - Math.atan2(dot(lower, basis.forward), dot(lower, basis.down));
    }
    if (!leg && depth && basis && pitch !== null && roll !== null && elbow !== null && c) {
      const pinky = point(side === "left" ? 17 : 18), index = point(side === "left" ? 19 : 20);
      const hand = pinky && index ? unit(sub(midpoint(pinky, index), c)) : null;
      if (hand) {
        const localHand = rotateY(rotateZ(rotateX(rotateY(rotateX(robotVector(hand, basis), -pitchOrigin), -pitch), -(roll + rollOrigin)), -yaw), -elbow);
        values[`${side}_wrist_pitch_joint`] = Math.hypot(localHand.x, localHand.z) > .05 ? -Math.atan2(localHand.z, localHand.x) : 0;
        values[`${side}_wrist_yaw_joint`] = boundedAsin(localHand.y);
      }
    }
  }
  const sides: ("left" | "right")[] = profile === "g1-single-arm" ? ["right"] : profile === "g1-left-arm" ? ["left"] : ["left", "right"];
  for (const side of sides) {
    limb(side, false, torso);
    if (profile === "g1-full-body") limb(side, true, pelvis);
  }
  return values;
}

export function retargetLandmarkFrame(frame: LandmarkFrame, joints: Joint[], neutral: number[], profile: RetargetingProfile, adjustments: RetargetingAdjustments = {}) {
  const measured = observations(frame, profile, joints);
  return joints.map((joint, index) => {
    const baseline = Number.isFinite(neutral[index]) ? neutral[index] : 0;
    const raw = measured[joint.name];
    const adjustment = adjustments[joint.name] ?? { scale: 1, offset: 0 };
    const next = raw === undefined ? baseline : baseline + raw * adjustment.scale + adjustment.offset;
    return Math.max(joint.lower, Math.min(joint.upper, Number.isFinite(next) ? next : baseline));
  });
}

export function mappingCoverage(frame: LandmarkFrame | null, joints: Joint[], profile: RetargetingProfile) {
  const measured = frame ? observations(frame, profile, joints) : {};
  return {
    mapped: joints.filter((joint) => measured[joint.name] !== undefined).map((joint) => joint.name),
    neutral: joints.filter((joint) => measured[joint.name] === undefined).map((joint) => joint.name),
    hasDepth: Boolean(frame?.pose_world?.length),
    torsoReference: frame && [11, 12, 23, 24].every((i) => posePoint(frame, i)) ? "hips" : "shoulders",
  };
}

export function hasUsablePose(frame: LandmarkFrame, minimumConfidence = .5) {
  if (!Number.isFinite(frame.confidence) || frame.confidence <= 0 || frame.pose.length < 17) return false;
  if (frame.confidence >= minimumConfidence) return true;
  // Occluded legs lower the aggregate detector score; a reliable visible segment is still useful.
  return [[11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28]].some(
    ([a, b]) => frame.pose[a]?.visibility !== undefined && frame.pose[b]?.visibility !== undefined
      && visiblePosePoint(frame.pose[a], minimumConfidence) && visiblePosePoint(frame.pose[b], minimumConfidence),
  );
}
