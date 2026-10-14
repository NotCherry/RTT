import { expect, it, vi } from "vitest";
const extract = vi.hoisted(() => vi.fn());
vi.mock("./cameraProcessing", () => ({ extractCameraRecording: extract }));
import { benchmarkCameraDetectors } from "./cameraDetectorBenchmark";
import type { CameraRecording } from "./cameraArchive";
it("uses identical retained pixels and duration for both models and reports measured inference", async () => {
  extract.mockResolvedValue({ frames: [{}], inference_times_ms: [10, 20, 30] });
  const recording = { video: new Blob(), duration_ms: 5000 } as CameraRecording;
  const results = await benchmarkCameraDetectors(recording, new AbortController().signal, vi.fn());
  expect(extract.mock.calls.map(call => call[6])).toEqual(["holistic", "pose"]);
  expect(extract.mock.calls.every(call => call[0] === recording.video && call[1] === 10 && call[7] === 3000)).toBe(true);
  expect(results[0]).toMatchObject({ frames: 3, detected_frames: 1, mean_processing_ms: 20, p95_processing_ms: 30, worker_fps: 50 });
});
