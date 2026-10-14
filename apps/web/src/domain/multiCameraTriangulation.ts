import { Matrix3, Vector3 } from "three";
import type { LandmarkPoint } from "@/types";
import type { CalibratedCamera } from "./multiCameraContract";

type Observation = { camera: CalibratedCamera; point: LandmarkPoint };
const matrix = (values: number[]) =>
  new Matrix3().set(
    ...(values as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ]),
  );
const rotation = (c: CalibratedCamera) => matrix(c.rotation);
const translation = (c: CalibratedCamera) =>
  new Vector3(...(c.translation as [number, number, number]));

function distort(x: number, y: number, c: CalibratedCamera) {
  const [k1, k2, p1, p2, k3] = c.distortion;
  const r2 = x * x + y * y,
    factor = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
  return [
    x * factor + 2 * p1 * x * y + p2 * (r2 + 2 * x * x),
    y * factor + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y,
  ];
}
function ray({ camera: c, point: p }: Observation) {
  const uv = new Vector3(p.x * c.width, p.y * c.height, 1).applyMatrix3(
    matrix(c.intrinsic).invert(),
  );
  let x = uv.x / uv.z,
    y = uv.y / uv.z;
  for (let i = 0; i < 10; i++) {
    const [dx, dy] = distort(x, y, c);
    x += uv.x / uv.z - dx;
    y += uv.y / uv.z - dy;
  }
  const inverse = rotation(c).transpose();
  return {
    center: translation(c).negate().applyMatrix3(inverse),
    direction: new Vector3(x, y, 1).normalize().applyMatrix3(inverse),
  };
}
export function projectPoint(world: Vector3, c: CalibratedCamera) {
  const v = world.clone().applyMatrix3(rotation(c)).add(translation(c));
  if (v.z <= 1e-5) return null;
  const [x, y] = distort(v.x / v.z, v.y / v.z, c);
  const p = new Vector3(x, y, 1).applyMatrix3(matrix(c.intrinsic));
  return { x: p.x / p.z / c.width, y: p.y / p.z / c.height, z: 0 };
}
function intersection(observations: Observation[]) {
  const a = Array(9).fill(0),
    b = new Vector3();
  const rays = observations.map(ray);
  // Near-parallel rays provide no trustworthy depth, even when they intersect numerically.
  if (
    !rays.some((r, i) =>
      rays.some(
        (other, j) =>
          j > i && r.direction.clone().cross(other.direction).length() > 0.035,
      ),
    )
  )
    return null;
  for (let index = 0; index < rays.length; index++) {
    const { center, direction } = rays[index],
      d = direction.toArray(),
      o = center.toArray();
    const w = (observations[index].point.visibility ?? 1) ** 2;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const value = w * (Number(i === j) - d[i] * d[j]);
        a[i * 3 + j] += value;
        b.setComponent(i, b.getComponent(i) + value * o[j]);
      }
  }
  const system = matrix(a);
  if (Math.abs(system.determinant()) < 1e-8) return null;
  const position = b.applyMatrix3(system.invert());
  return position.toArray().every(Number.isFinite) ? position : null;
}
const errorPx = (world: Vector3, o: Observation) => {
  const p = projectPoint(world, o.camera);
  return p
    ? Math.hypot(
        (p.x - o.point.x) * o.camera.width,
        (p.y - o.point.y) * o.camera.height,
      )
    : Infinity;
};

export function triangulateLandmark(
  observations: Observation[],
  maximumErrorPx = 6,
) {
  const valid = observations.filter(
    (o) =>
      [o.point.x, o.point.y, o.point.visibility ?? 1].every(Number.isFinite) &&
      o.point.x >= 0 &&
      o.point.x <= 1 &&
      o.point.y >= 0 &&
      o.point.y <= 1 &&
      (o.point.visibility ?? 1) >= 0.5 &&
      (o.point.visibility ?? 1) <= 1,
  );
  let best: { inliers: Observation[]; error: number } | null = null;
  for (let i = 0; i < valid.length; i++)
    for (let j = i + 1; j < valid.length; j++) {
      const position = intersection([valid[i], valid[j]]);
      if (!position) continue;
      const inliers = valid.filter(
        (o) => errorPx(position, o) <= maximumErrorPx,
      );
      const error = inliers.reduce((sum, o) => sum + errorPx(position, o), 0);
      if (
        inliers.length >= 2 &&
        (!best ||
          inliers.length > best.inliers.length ||
          (inliers.length === best.inliers.length && error < best.error))
      )
        best = { inliers, error };
    }
  if (!best) return null;
  const world = intersection(best.inliers);
  if (!world || best.inliers.some((o) => errorPx(world, o) > maximumErrorPx))
    return null;
  return {
    world,
    visibility: Math.min(...best.inliers.map((o) => o.point.visibility ?? 1)),
    views: best.inliers.map((o) => o.camera.id),
    reprojection_error_px: Math.max(...best.inliers.map(o => errorPx(world, o))),
  };
}

export function cameraRelative(world: Vector3, c: CalibratedCamera) {
  return world.clone().applyMatrix3(rotation(c)).add(translation(c));
}
