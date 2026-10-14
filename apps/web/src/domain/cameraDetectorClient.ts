import type { HolisticLandmarkerResult } from "@mediapipe/tasks-vision";
import { createHolisticCameraDetector } from "./holisticCameraDetector";
import type { CameraDetectorModel } from "./cameraDetectorModels";
export type CameraDetector = {
  mode: "worker" | "main-thread";
  detectForVideo: (source: HTMLVideoElement | HTMLImageElement, timestamp: number) => Promise<Pick<HolisticLandmarkerResult, "poseLandmarks" | "poseWorldLandmarks" | "leftHandLandmarks" | "rightHandLandmarks">>;
  close: () => void;
};
export async function createCameraDetectorClient(model: CameraDetectorModel = "holistic"): Promise<CameraDetector> {
  if (typeof Worker !== "undefined" && typeof createImageBitmap === "function") {
    let worker: Worker;
    try { worker = new Worker("/camera-detector-worker.js"); }
    catch { return mainThreadDetector(model); }
    let sequence = 0, closed = false;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    function close() {
      closed = true; worker.terminate();
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("Camera detector closed")); }
      pending.clear();
    }
    worker.onmessage = event => {
      const item = pending.get(event.data.id); if (!item) return;
      pending.delete(event.data.id); clearTimeout(item.timer);
      if (event.data.error) item.reject(new Error(event.data.error)); else item.resolve(event.data.result ?? event.data.ready);
    };
    worker.onerror = () => close();
    const request = (operation: "init" | "detect", image?: ImageBitmap, timestamp?: number) => new Promise<unknown>((resolve, reject) => {
      if (closed) { image?.close(); reject(new Error("Camera detector closed")); return; }
      const id = sequence++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("Camera inference worker timed out")); close(); }, operation === "init" ? 20000 : 10000);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, operation, image, timestamp, model }, image ? [image] : []); }
      catch (error) { pending.delete(id); clearTimeout(timer); image?.close(); reject(error); }
    });
    try {
      await request("init");
      let detecting = false;
      return { mode: "worker", close, detectForVideo: async (source, timestamp) => {
        if (detecting) throw new Error("Camera inference is already in progress");
        detecting = true;
        try { const image = await createImageBitmap(source);
          return await request("detect", image, timestamp) as Awaited<ReturnType<CameraDetector["detectForVideo"]>>;
        } finally { detecting = false; }
      } };
    } catch { close(); }
  }
  return mainThreadDetector(model);
}
async function mainThreadDetector(model: CameraDetectorModel): Promise<CameraDetector> {
  const detector = await createHolisticCameraDetector(model);
  return { mode: "main-thread", close: () => detector.close(), detectForVideo: async (source, timestamp) => detector.detectForVideo(source, timestamp) };
}
