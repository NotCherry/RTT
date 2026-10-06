import type { Joint, LandmarkFrame, LandmarkPoint } from "@/types";

export type RetargetingProfile = "g1-upper-body" | "g1-single-arm" | "g1-left-arm" | "g1-full-body";
export const RETARGETING_PROFILE_VERSION = 2;
export type RetargetingAdjustments = Record<string, { scale: number; offset: number }>;
type Vector = { x: number; y: number; z: number };
const sub = (a: Vector, b: Vector): Vector => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vector, b: Vector) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vector, b: Vector): Vector => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (v: Vector) => {
  const length = Math.hypot(v.x, v.y, v.z);
  return length > 1e-6 ? { x: v.x / length, y: v.y / length, z: v.z / length } : null;
};
const midpoint = (a: Vector, b: Vector): Vector => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
const valid = (p?: LandmarkPoint) => p && [p.x, p.y, p.z].every(Number.isFinite) && (p.visibility ?? 1) >= 0.5;

/** Conservative torso-relative mapping. Unobservable rotations retain neutral. */
function observations(frame: LandmarkFrame, profile: RetargetingProfile) {
  const values: Record<string, number> = {};
  if (!hasUsablePose(frame)) return values;
  const world = frame.pose_world?.length ? frame.pose_world : undefined;
  const point = (index: number): Vector | null => {
    if (!valid(frame.pose[index])) return null;
    if (world) return valid(world[index]) ? world[index] : null;
    const p = frame.pose[index];
    return { x: p.x * (frame.source_aspect_ratio ?? 1), y: p.y, z: 0 };
  };
  const ls = point(11), rs = point(12), lh = point(23), rh = point(24);
  if (!ls || !rs || !lh || !rh) return values;
  const down = unit(sub(midpoint(lh, rh), midpoint(ls, rs)));
  if (!down) return values;
  const shoulderLeft = sub(ls, rs);
  const left = unit(sub(shoulderLeft, { x: down.x * dot(shoulderLeft, down), y: down.y * dot(shoulderLeft, down), z: down.z * dot(shoulderLeft, down) }));
  if (!left) return values;
  const forward = unit(cross(down, left));
  if (!forward) return values;
  const bend = (a: Vector, b: Vector, c: Vector) => {
    const upper = unit(sub(b, a)), lower = unit(sub(c, b));
    return upper && lower ? Math.acos(Math.max(-1, Math.min(1, dot(upper, lower)))) : null;
  };
  const limb = (side: "left" | "right", leg: boolean) => {
    const first = leg ? (side === "left" ? 23 : 24) : (side === "left" ? 11 : 12);
    const a = point(first), b = point(first + 2), c = point(first + 4);
    if (!a || !b) return;
    const direction = unit(sub(b, a));
    if (!direction) return;
    const prefix = `${side}_${leg ? "hip" : "shoulder"}`;
    // Positive robot roll lifts the anatomical left limb; right roll is negative.
    values[`${prefix}_roll_joint`] = Math.asin(Math.max(-1, Math.min(1, dot(direction, left))));
    if (world) values[`${prefix}_pitch_joint`] = -Math.atan2(dot(direction, forward), dot(direction, down));
    if (c) {
      const flexion = bend(a, b, c);
      if (flexion !== null) values[`${side}_${leg ? "knee" : "elbow"}_joint`] = flexion;
    }
    // Ankle pitch needs 3D foot orientation; a frontal image cannot establish it.
    if (leg && world && c) {
      const heel = point(side === "left" ? 29 : 30), toe = point(side === "left" ? 31 : 32);
      const shin = unit(sub(c, b));
      if (heel && toe && shin) {
        const foot = unit(sub(toe, heel));
        if (foot) values[`${side}_ankle_pitch_joint`] = Math.atan2(dot(foot, down), dot(foot, forward)) - Math.atan2(dot(shin, forward), dot(shin, down));
      }
    }
  };
  const sides: ("left" | "right")[] = profile === "g1-single-arm" ? ["right"] : profile === "g1-left-arm" ? ["left"] : ["left", "right"];
  for (const side of sides) {
    limb(side, false);
    if (profile === "g1-full-body") limb(side, true);
  }
  return values;
}

export function retargetLandmarkFrame(frame: LandmarkFrame, joints: Joint[], neutral: number[], profile: RetargetingProfile, adjustments: RetargetingAdjustments = {}) {
  const measured = observations(frame, profile);
  return joints.map((joint, index) => {
    const baseline = Number.isFinite(neutral[index]) ? neutral[index] : 0;
    const raw = measured[joint.name];
    const adjustment = adjustments[joint.name] ?? { scale: 1, offset: 0 };
    const next = raw === undefined ? baseline : baseline + raw * adjustment.scale + adjustment.offset;
    return Math.max(joint.lower, Math.min(joint.upper, Number.isFinite(next) ? next : baseline));
  });
}

export function mappingCoverage(frame: LandmarkFrame | null, joints: Joint[], profile: RetargetingProfile) {
  const measured = frame ? observations(frame, profile) : {};
  return {
    mapped: joints.filter((joint) => measured[joint.name] !== undefined).map((joint) => joint.name),
    neutral: joints.filter((joint) => measured[joint.name] === undefined).map((joint) => joint.name),
    hasDepth: Boolean(frame?.pose_world?.length),
  };
}

export function hasUsablePose(frame: LandmarkFrame, minimumConfidence = 0.5) {
  return Number.isFinite(frame.confidence) && frame.confidence >= minimumConfidence && frame.pose.length >= 17;
}
