import type { CameraDetectorModel } from "./cameraDetectorModels";
export async function createHolisticCameraDetector(model: CameraDetectorModel = "holistic") {
  const vision = await import("@mediapipe/tasks-vision");
  const files = await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
  const body = await vision.PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: "/mediapipe/models/pose_landmarker_full.task", delegate: "CPU" }, runningMode: "VIDEO", numPoses: 2, minPosePresenceConfidence: .5 });
  if (model === "pose") {
    const detector = body;
    return { close: () => detector.close(), detectForVideo: (source: HTMLVideoElement | HTMLImageElement, timestamp: number) => {
      const result = detector.detectForVideo(source, timestamp);
      return { poseLandmarks: result.landmarks, poseWorldLandmarks: result.worldLandmarks, leftHandLandmarks: [], rightHandLandmarks: [] };
    } };
  }
  const create = (delegate: "GPU" | "CPU") => vision.HolisticLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: "/mediapipe/models/holistic_landmarker.task", delegate }, runningMode: "VIDEO",
    minPosePresenceConfidence: .5, minHandLandmarksConfidence: .5,
  });
  try {
    let detector;
    try { detector = await create("GPU"); } catch { detector = await create("CPU"); }
    return { close: () => { detector.close(); body.close(); }, detectForVideo: (source: HTMLVideoElement | HTMLImageElement, timestamp: number) => {
      const people = body.detectForVideo(source, timestamp);
      if (people.landmarks.length > 1) return { poseLandmarks: people.landmarks, poseWorldLandmarks: people.worldLandmarks, leftHandLandmarks: [], rightHandLandmarks: [] };
      return detector.detectForVideo(source, timestamp);
    } };
  } catch (error) { body.close(); throw error; }
}
