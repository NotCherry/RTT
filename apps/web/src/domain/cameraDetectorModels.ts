export type CameraDetectorModel = "holistic" | "pose";
export const cameraDetectorModels = [
  { id: "holistic" as const, label: "MediaPipe Holistic · body and hands", asset: "/mediapipe/models/holistic_landmarker.task" },
  { id: "pose" as const, label: "MediaPipe Pose Full · body only", asset: "/mediapipe/models/pose_landmarker_full.task" },
];
