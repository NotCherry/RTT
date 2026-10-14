import { expect, it } from "vitest";
import { cameraFrameMetrics } from "./cameraFrameMetrics";
it("reports observed throughput and percentile latency without inventing exposure timestamps", () => {
  expect(cameraFrameMetrics([0,50,100], [10,12,90], 2, "worker")).toEqual({ processed_fps: 20, latency_ms: 90, p95_latency_ms: 90, dropped_frames: 2, detector: "worker", timing: "browser-observation" });
});
