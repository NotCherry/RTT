import type { LandmarkFrame } from "@/types";
import { hasUsablePose } from "./retargeting";

export async function createCameraDetector() {
  const vision = await import("@mediapipe/tasks-vision");
  const files = await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
  const create = (delegate: "GPU" | "CPU") =>
    vision.HolisticLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: "/mediapipe/models/holistic_landmarker.task", delegate },
      runningMode: "VIDEO",
      minPosePresenceConfidence: 0.5,
      minHandLandmarksConfidence: 0.5,
    });
  try {
    return await create("GPU");
  } catch {
    return create("CPU");
  }
}
export type CameraDetector = Awaited<ReturnType<typeof createCameraDetector>>;
export function detectCameraFrame(
  detector: CameraDetector,
  source: HTMLVideoElement | HTMLImageElement,
  timestamp: number,
): LandmarkFrame | null {
  const result = detector.detectForVideo(source, timestamp);
  const pose = result.poseLandmarks?.[0] ?? [];
  if (!pose.length) return null;
  const points = (input: typeof pose) => input.map(({ x, y, z, visibility }) => ({ x, y, z, visibility }));
  return {
    timestamp,
    pose: points(pose),
    left_hand: points(result.leftHandLandmarks?.[0] ?? []),
    right_hand: points(result.rightHandLandmarks?.[0] ?? []),
    confidence: pose.reduce((sum, point) => sum + (point.visibility ?? 1), 0) / pose.length,
  };
}

function waitForMedia(video: HTMLVideoElement, event: string, signal: AbortSignal, action: () => void) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve();
    };
    const done = () => finish();
    const failed = () => finish(new Error("Recorded video could not be decoded."));
    const aborted = () => finish(new DOMException("Extraction cancelled", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Video decoding timed out. Retry extraction.")), 15000);
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    else {
      try {
        action();
      } catch (error) {
        finish(error as Error);
      }
    }
  });
}

export async function extractCameraRecording(
  blob: Blob,
  sampleRate: number,
  durationMs: number,
  signal: AbortSignal,
  progress: (percent: number) => void,
) {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  const url = URL.createObjectURL(blob);
  let detector: CameraDetector | undefined;
  try {
    await waitForMedia(video, "loadeddata", signal, () => {
      video.src = url;
      video.load();
    });
    // MediaRecorder WebM often has no duration header. A large seek discovers its end.
    if (!Number.isFinite(video.duration))
      await waitForMedia(video, "seeked", signal, () => {
        video.currentTime = 1e10;
      });
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : durationMs;
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error("The recording has no readable duration. Record a new clip.");
    signal.throwIfAborted();
    detector = await createCameraDetector();
    signal.throwIfAborted();
    const frames: LandmarkFrame[] = [];
    let rejected = 0;
    for (let timestamp = 0; timestamp < duration; timestamp += 1000 / sampleRate) {
      signal.throwIfAborted();
      const seconds = timestamp / 1000;
      if (Math.abs(video.currentTime - seconds) > 0.00001)
        await waitForMedia(video, "seeked", signal, () => {
          video.currentTime = seconds;
        });
      const frame = detectCameraFrame(detector, video, timestamp);
      if (frame && hasUsablePose(frame)) frames.push(frame);
      else rejected++;
      progress(Math.min(100, Math.round(((timestamp + 1000 / sampleRate) / duration) * 100)));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return {
      frames,
      rejected_frames: rejected,
      duration_ms: duration,
      processed: true,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } finally {
    detector?.close();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
