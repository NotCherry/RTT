import { expect, it } from "vitest";
import { Vector3 } from "three";
import type { LandmarkFrame } from "@/types";
import { fuseCameraViews, fuseRecordedViews } from "./multiCameraPose";
import {
  parseCameraCalibration,
  type CalibratedCamera,
} from "./multiCameraContract";
import { projectPoint, triangulateLandmark } from "./multiCameraTriangulation";
import { posePoint } from "./retargetingGeometry";
import { mappingCoverage } from "./retargeting";
import type { Joint } from "@/types";

function body(timestamp = 1000): LandmarkFrame {
  const world = Array.from({ length: 33 }, () => ({
    x: 0,
    y: -0.1,
    z: 0,
    visibility: 1,
  }));
  world[11] = { x: 0.2, y: -0.5, z: 0, visibility: 1 };
  world[12] = { x: -0.2, y: -0.5, z: 0, visibility: 1 };
  world[23] = { x: 0.15, y: 0, z: 0, visibility: 1 };
  world[24] = { x: -0.15, y: 0, z: 0, visibility: 1 };
  world[14] = { x: -0.35, y: -0.25, z: -0.1, visibility: 1 };
  return {
    timestamp,
    confidence: 1,
    pose_world: world,
    pose: world.map((p) => ({ ...p, x: 0.5 + p.x * 0.4, y: 0.5 + p.y * 0.5 })),
    left_hand: [],
    right_hand: [],
  };
}
const camera = (id: string, x: number): CalibratedCamera => ({
  id,
  width: 640,
  height: 480,
  intrinsic: [800, 0, 320, 0, 800, 240, 0, 0, 1],
  distortion: [0, 0, 0, 0, 0],
  rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  translation: [-x, 0, 0],
});
const cameras = [
  camera("view-1", 0),
  camera("view-2", 0.7),
  camera("view-3", -0.7),
];
const calibration = { version: 1 as const, cameras };
function projected(c: CalibratedCamera, timestamp = 1000): LandmarkFrame {
  const frame = body(timestamp);
  frame.pose = frame.pose_world!.map((p) => ({
    ...projectPoint(new Vector3(p.x, p.y, p.z + 3), c)!,
    visibility: 1,
  }));
  return { ...frame, source_width: 640, source_height: 480 };
}
it("aligns differently oriented cameras and recovers an occluded elbow without mixing image coordinates", () => {
  const primary = body(),
    other = body();
  primary.pose[14].visibility = primary.pose_world![14].visibility = 0;
  other.pose_world = other.pose_world!.map((p) => ({
    ...p,
    x: p.z,
    y: p.y,
    z: -p.x,
  }));
  const fused = fuseCameraViews([
    { id: "view-1", frame: primary },
    { id: "view-2", frame: other },
  ])!;
  expect(fused.pose).toEqual(primary.pose);
  expect(fused.pose_world![14]).toMatchObject({
    x: -0.35,
    y: -0.25,
    z: -0.1,
    visibility: 1,
  });
  expect(posePoint(fused, 14)).toMatchObject({ x: -0.35, y: -0.25, z: -0.1 });
  expect(fused.multi_view?.contributing_views).toHaveLength(2);
  const joints = [
    {
      name: "right_elbow_joint",
      lower: -2,
      upper: 2,
      controllable: true,
    } as Joint,
  ];
  expect(mappingCoverage(primary, joints, "g1-upper-body").mapped).toEqual([]);
  expect(mappingCoverage(fused, joints, "g1-upper-body").mapped).toEqual([
    "right_elbow_joint",
  ]);
});
it("ignores stale secondary views and requires a fresh primary", () => {
  const primary = body(),
    other = body(1200);
  primary.pose[14].visibility = 0;
  expect(
    fuseCameraViews([
      { id: "view-1", frame: primary },
      { id: "view-2", frame: other },
    ])!.pose_world![14].visibility,
  ).toBe(0);
  expect(
    fuseCameraViews([
      { id: "view-1", frame: null },
      { id: "view-2", frame: other },
    ]),
  ).toBeNull();
});
it("rejects disagreeing body estimates and keeps single-camera/2D fallback intact", () => {
  const primary = body(),
    other = body();
  other.pose_world![14].x = 2;
  expect(
    fuseCameraViews([
      { id: "view-1", frame: primary },
      { id: "view-2", frame: other },
    ])!.pose_world![14].x,
  ).toBeCloseTo(-0.35);
  expect(fuseCameraViews([{ id: "view-1", frame: primary }])).toBe(primary);
  delete primary.pose_world;
  expect(
    fuseCameraViews([
      { id: "view-1", frame: primary },
      { id: "view-2", frame: other },
    ])!.pose_world,
  ).toBeUndefined();
});
it("reconstructs depth from three calibrated views and rescues primary-view occlusion", () => {
  const views = cameras.map((c) => ({ id: c.id, frame: projected(c) }));
  views[0].frame.pose[14].visibility = 0;
  const fused = fuseCameraViews(views, "triangulated", calibration)!;
  expect(fused.pose_world![14].x).toBeCloseTo(-0.35, 5);
  expect(fused.pose_world![14].z).toBeCloseTo(2.9, 5);
  expect(fused.multi_view?.triangulated_landmarks).toBe(33);
  expect(posePoint(fused, 14)).not.toBeNull();
});
it("never blends monocular hip-relative coordinates into reconstructed coordinates", () => {
  const views = cameras
    .slice(0, 2)
    .map((c) => ({ id: c.id, frame: projected(c) }));
  views[1].frame.pose[14].visibility = 0;
  expect(
    fuseCameraViews(views, "triangulated", calibration)!.pose_world![14]
      .visibility,
  ).toBe(0);
});
it("rejects changed calibration resolution, absent calibration, and parallel camera rays", () => {
  const primary = projected(cameras[0]);
  primary.source_width = 1280;
  const views = [
    { id: "view-1", frame: primary },
    { id: "view-2", frame: projected(cameras[1]) },
  ];
  expect(fuseCameraViews(views, "triangulated", calibration)).toBeNull();
  expect(fuseCameraViews(views, "triangulated")).toBeNull();
  const point = { x: 0.5, y: 0.5, z: 0, visibility: 1 };
  expect(
    triangulateLandmark([
      { camera: cameras[0], point },
      { camera: cameras[1], point },
    ]),
  ).toBeNull();
});
it("rejects a third view with a reprojection outlier and handles lens distortion", () => {
  const world = new Vector3(0.15, -0.1, 3);
  const observations = cameras.map((c) => ({
    camera: { ...c, distortion: [0.1, -0.02, 0.001, 0.001, 0] },
    point: {
      ...projectPoint(world, {
        ...c,
        distortion: [0.1, -0.02, 0.001, 0.001, 0],
      })!,
      visibility: 1,
    },
  }));
  observations[2].point.y += 0.2;
  const result = triangulateLandmark(observations)!;
  expect(result.views).toEqual(["view-1", "view-2"]);
  expect(result.world.distanceTo(world)).toBeLessThan(0.0001);
});
it("aligns independent recording start offsets and never reuses a distant frame", () => {
  const primary = [body(0), body(100), body(200)];
  primary.forEach((f) => {
    f.pose[14].visibility = 0;
  });
  const fused = fuseRecordedViews(
    [
      { id: "view-1", frames: primary, offset_ms: 0 },
      { id: "view-2", frames: [body(0)], offset_ms: 100 },
    ],
    "body-aligned",
  );
  expect(fused.map((f) => f.timestamp)).toEqual([0, 100, 200]);
  expect(fused[1].pose_world![14].visibility).toBe(1);
  const stale = fuseRecordedViews(
    [
      { id: "view-1", frames: [body(0)], offset_ms: 0 },
      { id: "view-2", frames: [body(0)], offset_ms: 500 },
    ],
    "body-aligned",
  );
  expect(stale[0].multi_view?.contributing_views).toEqual(["view-1"]);
});
it("validates calibration IDs and proper camera rotations", () => {
  expect(parseCameraCalibration(calibration).cameras).toHaveLength(3);
  expect(() =>
    parseCameraCalibration({
      ...calibration,
      cameras: [cameras[0], cameras[0]],
    }),
  ).toThrow(/unique/);
  expect(() =>
    parseCameraCalibration({
      ...calibration,
      cameras: [{ ...cameras[0], rotation: Array(9).fill(0) }, cameras[1]],
    }),
  ).toThrow(/orthonormal/);
  expect(() =>
    parseCameraCalibration({
      ...calibration,
      cameras: [
        { ...cameras[0], intrinsic: Array(9).fill(Infinity) },
        cameras[1],
      ],
    }),
  ).toThrow(/Invalid/);
});
