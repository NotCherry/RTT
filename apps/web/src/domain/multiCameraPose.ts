import type { LandmarkFrame, LandmarkPoint } from "@/types";
import {
  bodyBasis,
  dot,
  midpoint,
  sub,
  type Vector,
} from "./retargetingGeometry";
import type { CameraCalibration, PoseFusionModel } from "./multiCameraContract";
import {
  cameraRelative,
  triangulateLandmark,
} from "./multiCameraTriangulation";

export const VIEW_SYNC_MS = 100;
export type ViewObservation = { id: string; frame: LandmarkFrame | null };
const confidence = (p?: LandmarkPoint) =>
  p && [p.x, p.y, p.z, p.visibility ?? 1].every(Number.isFinite)
    ? Math.max(0, Math.min(1, p.visibility ?? 1))
    : 0;
const distance = (a: Vector, b: Vector) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function torso(frame: LandmarkFrame) {
  const points = [11, 12, 23, 24].map((i) => frame.pose_world?.[i]);
  if (
    points.some(
      (p, i) =>
        confidence(p) < 0.5 ||
        confidence(frame.pose[[11, 12, 23, 24][i]]) < 0.5,
    )
  )
    return null;
  const [ls, rs, lh, rh] = points as LandmarkPoint[];
  const origin = midpoint(lh, rh),
    shoulders = midpoint(ls, rs);
  const basis = bodyBasis(sub(ls, rs), sub(origin, shoulders));
  const scale = distance(origin, shoulders);
  return basis && scale > 0.1 && scale < 1 ? { basis, origin, scale } : null;
}
function transform(
  point: Vector,
  from: NonNullable<ReturnType<typeof torso>>,
  to: NonNullable<ReturnType<typeof torso>>,
) {
  const v = sub(point, from.origin),
    ratio = to.scale / from.scale;
  const axes = ["left", "down", "forward"] as const;
  const result = { ...to.origin };
  for (const axis of axes)
    for (const component of ["x", "y", "z"] as const)
      result[component] +=
        dot(v, from.basis[axis]) * ratio * to.basis[axis][component];
  return result;
}

/** Keep image landmarks in the primary view. Fuse only geometry in a common frame. */
export function fuseCameraViews(
  views: ViewObservation[],
  model: PoseFusionModel = "body-aligned",
  calibration?: CameraCalibration,
): LandmarkFrame | null {
  const primary = views[0]?.frame;
  if (!primary) return null;
  const fresh = views.filter(
    (v) =>
      v.frame &&
      Math.abs(v.frame.timestamp - primary.timestamp) <= VIEW_SYNC_MS,
  );
  if (views.length === 1) return primary;
  if (model === "body-aligned" && !primary.pose_world?.length)
    return {
      ...primary,
      multi_view: {
        model,
        contributing_views: [views[0].id],
        fused_landmarks: 0,
        triangulated_landmarks: 0,
      },
    };
  const reference = torso(primary);
  const contributors = new Set([views[0].id]);
  let fused = 0,
    triangulated = 0;
  const primaryCamera = calibration?.cameras.find((c) => c.id === views[0].id);
  const calibrated = fresh.filter((v) => {
    const c = calibration?.cameras.find((c) => c.id === v.id),
      f = v.frame!;
    return c && f.source_width === c.width && f.source_height === c.height;
  });
  // A changed crop or capture resolution invalidates the supplied calibration.
  if (
    model === "triangulated" &&
    (!primaryCamera || !calibrated.some((v) => v.id === views[0].id))
  )
    return null;
  const world = primary.pose.map((_, i): LandmarkPoint => {
    const fallback = primary.pose_world?.[i];
    const fallbackConfidence = Math.min(
      confidence(fallback),
      confidence(primary.pose[i]),
    );
    if (model === "triangulated") {
      const estimate = triangulateLandmark(
        calibrated
          .map((v) => ({
            camera: calibration!.cameras.find((c) => c.id === v.id)!,
            point: v.frame!.pose[i],
          }))
          .filter((o) => Boolean(o.point)),
      );
      if (estimate) {
        const point = cameraRelative(estimate.world, primaryCamera!);
        estimate.views.forEach((id) => contributors.add(id));
        fused++;
        triangulated++;
        return { ...point, visibility: estimate.visibility };
      }
      return { x: 0, y: 0, z: 0, visibility: 0 };
    } else if (reference) {
      const candidates = fresh
        .flatMap((v) => {
          const frame = v.frame!,
            basis = torso(frame),
            p = frame.pose_world?.[i];
          const weight = Math.min(confidence(p), confidence(frame.pose[i]));
          if (
            !basis ||
            !p ||
            weight < 0.5 ||
            Math.abs(basis.scale / reference.scale - 1) > 0.35
          )
            return [];
          return [{ id: v.id, point: transform(p, basis, reference), weight }];
        })
        .sort((a, b) => b.weight - a.weight);
      if (candidates.length) {
        const anchor = candidates[0];
        // Reject disagreeing monocular estimates instead of averaging unrelated people or flipped limbs.
        const inliers = candidates.filter(
          (c) => distance(c.point, anchor.point) < 0.18,
        );
        const sum = inliers.reduce((s, c) => s + c.weight * c.weight, 0);
        const point = { x: 0, y: 0, z: 0 };
        for (const c of inliers) {
          for (const axis of ["x", "y", "z"] as const)
            point[axis] += (c.point[axis] * c.weight * c.weight) / sum;
          contributors.add(c.id);
        }
        if (inliers.some((c) => c.id !== views[0].id)) fused++;
        return { ...point, visibility: anchor.weight };
      }
    }
    return fallback && fallbackConfidence >= 0.5
      ? { ...fallback, visibility: fallbackConfidence }
      : { x: 0, y: 0, z: 0, visibility: 0 };
  });
  if (!world.some((p) => (p.visibility ?? 0) >= 0.5)) return null;
  return {
    ...primary,
    pose_world: world,
    confidence: Math.max(...world.map((p) => p.visibility ?? 0)),
    multi_view: {
      model,
      contributing_views: [...contributors],
      fused_landmarks: fused,
      triangulated_landmarks: triangulated,
    },
  };
}

/** Recording timestamps share the primary clock; select nearest, never stale views. */
export function fuseRecordedViews(
  views: { id: string; frames: LandmarkFrame[]; offset_ms: number }[],
  model: PoseFusionModel,
  calibration?: CameraCalibration,
) {
  const aligned = views.map((v) => ({
    ...v,
    frames: v.frames.map((f) => ({
      ...f,
      timestamp: f.timestamp + v.offset_ms,
    })),
  }));
  const cursors = aligned.map(() => 0);
  return (aligned[0]?.frames ?? []).flatMap((primary) => {
    const observations = aligned.map((view, index) => {
      while (
        cursors[index] + 1 < view.frames.length &&
        Math.abs(
          view.frames[cursors[index] + 1].timestamp - primary.timestamp,
        ) < Math.abs(view.frames[cursors[index]].timestamp - primary.timestamp)
      )
        cursors[index]++;
      const frame = view.frames[cursors[index]];
      return {
        id: view.id,
        frame:
          frame && Math.abs(frame.timestamp - primary.timestamp) <= VIEW_SYNC_MS
            ? frame
            : null,
      };
    });
    const frame = fuseCameraViews(observations, model, calibration);
    return frame ? [frame] : [];
  });
}
