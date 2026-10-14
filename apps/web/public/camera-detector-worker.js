/* Classic worker: MediaPipe's WASM loader requires importScripts globals. */
importScripts("/mediapipe/vision_bundle.js");
let detector, body, model;
self.onmessage = async event => {
  const { id, operation, image, timestamp } = event.data;
  try {
    if (operation === "init") {
      model = event.data.model ?? "holistic";
      const files = await Vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
      body = await Vision.PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: "/mediapipe/models/pose_landmarker_full.task", delegate: "CPU" }, runningMode: "VIDEO", numPoses: 2, minPosePresenceConfidence: .5 });
      if (model === "pose") {
        detector = body;
        self.postMessage({ id, ready: true }); return;
      }
      const create = delegate => Vision.HolisticLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: "/mediapipe/models/holistic_landmarker.task", delegate },
        runningMode: "VIDEO", minPosePresenceConfidence: .5, minHandLandmarksConfidence: .5,
      });
      // CPU inference in the worker avoids offscreen GPU context stalls on software-rendered browsers.
      detector = await create("CPU");
      self.postMessage({ id, ready: true });
    } else {
      if (!detector || !image) throw new Error("Camera detector is not initialized");
      const people = model === "holistic" ? body.detectForVideo(image, timestamp) : null;
      if (people?.landmarks.length > 1) {
        self.postMessage({ id, result: { poseLandmarks: people.landmarks, poseWorldLandmarks: people.worldLandmarks, leftHandLandmarks: [], rightHandLandmarks: [] } }); return;
      }
      const result = detector.detectForVideo(image, timestamp);
      self.postMessage({ id, result: model === "pose" ? { poseLandmarks: result.landmarks, poseWorldLandmarks: result.worldLandmarks, leftHandLandmarks: [], rightHandLandmarks: [] }
        : { poseLandmarks: result.poseLandmarks, poseWorldLandmarks: result.poseWorldLandmarks, leftHandLandmarks: result.leftHandLandmarks, rightHandLandmarks: result.rightHandLandmarks } });
    }
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : "Camera inference failed" }); }
  finally { image?.close(); }
};
