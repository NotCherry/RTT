import type { CameraRecording } from "./cameraArchive";
import { cameraDetectorModels } from "./cameraDetectorModels";
import { extractCameraRecording } from "./cameraProcessing";
import { hasUsablePose } from "./retargeting";
export type DetectorBenchmarkResult = { detector: string; frames: number; detected_frames: number; mean_processing_ms: number; p95_processing_ms: number; worker_fps: number };
export async function benchmarkCameraDetectors(recording: CameraRecording, signal: AbortSignal, progress: (value: number) => void) {
  if (!recording.video) throw new Error("A retained source video is required for a detector comparison");
  const results: DetectorBenchmarkResult[] = [];
  for (const [index, detector] of cameraDetectorModels.entries()) {
    signal.throwIfAborted();
    const result = await extractCameraRecording(recording.video, 10, recording.duration_ms, signal,
      value => progress((index * 100 + value) / cameraDetectorModels.length), hasUsablePose, detector.id, 3000);
    const times = [...result.inference_times_ms].sort((a,b) => a-b), total = times.reduce((sum, value) => sum+value, 0);
    results.push({ detector: detector.label, frames: times.length, detected_frames: result.frames.length,
      mean_processing_ms: times.length ? total / times.length : 0,
      p95_processing_ms: times[Math.max(0, Math.ceil(times.length*.95)-1)] ?? 0,
      worker_fps: total > 0 ? times.length * 1000 / total : 0 });
  }
  return results;
}
