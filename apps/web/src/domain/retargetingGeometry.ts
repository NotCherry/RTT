import type { LandmarkFrame, LandmarkPoint } from "@/types";

export type Vector = { x: number; y: number; z: number };
export type BodyBasis = { down: Vector; left: Vector; forward: Vector };
export const sub = (a: Vector, b: Vector): Vector => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const dot = (a: Vector, b: Vector) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vector, b: Vector): Vector => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const midpoint = (a: Vector, b: Vector): Vector => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
export const unit = (v: Vector) => {
  const length = Math.hypot(v.x, v.y, v.z);
  return length > 1e-6 ? { x: v.x / length, y: v.y / length, z: v.z / length } : null;
};
const finite = (p?: LandmarkPoint) => p && [p.x, p.y, p.z].every(Number.isFinite);
export const visiblePosePoint = (p?: LandmarkPoint, confidence = .5) => Boolean(
  finite(p) && (p!.visibility ?? 1) >= confidence && p!.x >= 0 && p!.x <= 1 && p!.y >= 0 && p!.y <= 1,
);
export function posePoint(frame: LandmarkFrame, index: number): Vector | null {
  const p = frame.pose[index];
  if (!visiblePosePoint(p)) return null;
  if (frame.pose_world?.length) {
    const world = frame.pose_world[index];
    return finite(world) && (world.visibility ?? 1) >= .5 ? world : null;
  }
  const aspect = frame.source_aspect_ratio;
  return { x: p.x * (aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : 1), y: p.y, z: 0 };
}
export function bodyBasis(leftSpan: Vector, downHint: Vector): BodyBasis | null {
  const down = unit(downHint);
  if (!down) return null;
  const along = dot(leftSpan, down);
  const left = unit(sub(leftSpan, { x: down.x * along, y: down.y * along, z: down.z * along }));
  const forward = left && unit(cross(down, left));
  return left && forward ? { left, down, forward } : null;
}
export const robotVector = (v: Vector, basis: BodyBasis): Vector => ({ x: dot(v, basis.forward), y: dot(v, basis.left), z: -dot(v, basis.down) });
export function rotateX(v: Vector, angle: number): Vector {
  return { x: v.x, y: v.y * Math.cos(angle) - v.z * Math.sin(angle), z: v.y * Math.sin(angle) + v.z * Math.cos(angle) };
}
export function rotateY(v: Vector, angle: number): Vector {
  return { x: v.x * Math.cos(angle) + v.z * Math.sin(angle), y: v.y, z: -v.x * Math.sin(angle) + v.z * Math.cos(angle) };
}
export function rotateZ(v: Vector, angle: number): Vector {
  return { x: v.x * Math.cos(angle) - v.y * Math.sin(angle), y: v.x * Math.sin(angle) + v.y * Math.cos(angle), z: v.z };
}
