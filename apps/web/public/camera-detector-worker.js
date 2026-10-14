/* Classic worker: MediaPipe's WASM loader requires importScripts globals. */
importScripts("/mediapipe/vision_bundle.js");
let detector;
self.onmessage = async event => {
  const { id, operation, image, timestamp } = event.data;
  try {
    if (operation === "init") {
      const files = await Vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
      const create = delegate => Vision.HolisticLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: "/mediapipe/models/holistic_landmarker.task", delegate },
        runningMode: "VIDEO", minPosePresenceConfidence: .5, minHandLandmarksConfidence: .5,
      });
      // CPU inference in the worker avoids offscreen GPU context stalls on software-rendered browsers.
      detector = await create("CPU");
      self.postMessage({ id, ready: true });
    } else {
      if (!detector || !image) throw new Error("Camera detector is not initialized");
      const result = detector.detectForVideo(image, timestamp);
      self.postMessage({ id, result: { poseLandmarks: result.poseLandmarks, poseWorldLandmarks: result.poseWorldLandmarks,
        leftHandLandmarks: result.leftHandLandmarks, rightHandLandmarks: result.rightHandLandmarks } });
    }
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : "Camera inference failed" }); }
  finally { image?.close(); }
};
