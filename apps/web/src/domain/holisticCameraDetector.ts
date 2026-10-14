export async function createHolisticCameraDetector() {
  const vision = await import("@mediapipe/tasks-vision");
  const files = await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
  const create = (delegate: "GPU" | "CPU") => vision.HolisticLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: "/mediapipe/models/holistic_landmarker.task", delegate }, runningMode: "VIDEO",
    minPosePresenceConfidence: .5, minHandLandmarksConfidence: .5,
  });
  try { return await create("GPU"); } catch { return create("CPU"); }
}
