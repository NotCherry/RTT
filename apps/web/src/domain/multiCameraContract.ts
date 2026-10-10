import type { LandmarkFrame } from "@/types";

export type CameraInput = {
  id: string;
  kind: "local" | "ip";
  deviceId: string;
  address: string;
};
export type PoseFusionModel = "body-aligned" | "triangulated";
export type CalibratedCamera = {
  id: string;
  width: number;
  height: number;
  intrinsic: number[];
  distortion: number[];
  rotation: number[];
  translation: number[];
};
export type CameraCalibration = {
  version: 1;
  cameras: CalibratedCamera[];
  rms_px?: number;
};
export type CameraViewRecording = {
  id: string;
  source:
    | { kind: "local-media-stream"; stream_count: 1 }
    | { kind: "ip-image-stream"; url: string };
  offset_ms: number;
  duration_ms: number;
  width?: number;
  height?: number;
  frames: LandmarkFrame[];
  video?: Blob;
};
export type MultiCameraSource = {
  kind: "multi-camera";
  stream_count: 2 | 3;
  model: PoseFusionModel;
  calibration?: CameraCalibration;
};
export type MultiViewQuality = {
  model: PoseFusionModel;
  contributing_views: string[];
  fused_landmarks: number;
  triangulated_landmarks: number;
};

export function parseCameraCalibration(value: unknown): CameraCalibration {
  const rig = value as CameraCalibration;
  if (
    !rig ||
    rig.version !== 1 ||
    !Array.isArray(rig.cameras) ||
    ![2, 3].includes(rig.cameras.length)
  )
    throw new Error(
      "Calibration must contain two or three cameras (version 1).",
    );
  const numeric = (v: unknown, length: number) =>
    Array.isArray(v) && v.length === length && v.every(Number.isFinite);
  for (const c of rig.cameras) {
    if (
      !c ||
      typeof c.id !== "string" ||
      !/^view-[123]$/.test(c.id) ||
      !Number.isInteger(c.width) ||
      !Number.isInteger(c.height) ||
      c.width < 1 ||
      c.height < 1 ||
      !numeric(c.intrinsic, 9) ||
      !numeric(c.rotation, 9) ||
      !numeric(c.translation, 3) ||
      !numeric(c.distortion, 5) ||
      c.intrinsic[0] <= 0 ||
      c.intrinsic[4] <= 0 ||
      c.intrinsic[3] !== 0 ||
      c.intrinsic[6] !== 0 ||
      c.intrinsic[7] !== 0 ||
      c.intrinsic[8] !== 1
    )
      throw new Error(
        "Invalid camera dimensions, intrinsics, distortion or transform.",
      );
    const r = c.rotation;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const product = [0, 1, 2].reduce(
          (sum, k) => sum + r[i * 3 + k] * r[j * 3 + k],
          0,
        );
        if (Math.abs(product - Number(i === j)) > 0.01)
          throw new Error("Camera rotation must be orthonormal.");
      }
    const det =
      r[0] * (r[4] * r[8] - r[5] * r[7]) -
      r[1] * (r[3] * r[8] - r[5] * r[6]) +
      r[2] * (r[3] * r[7] - r[4] * r[6]);
    if (Math.abs(det - 1) > 0.01)
      throw new Error("Camera rotation must have determinant +1.");
  }
  if (new Set(rig.cameras.map((c) => c.id)).size !== rig.cameras.length)
    throw new Error("Camera calibration IDs must be unique.");
  if (
    rig.rms_px !== undefined &&
    (!Number.isFinite(rig.rms_px) || rig.rms_px < 0 || rig.rms_px > 2)
  )
    throw new Error("Calibration reprojection error must be at most 2 pixels.");
  return structuredClone(rig);
}
