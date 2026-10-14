import type { CameraFrameMetrics } from "@/domain/cameraFrameMetrics";
export function CameraMetrics({ metrics }: { metrics?: CameraFrameMetrics }) {
  if (!metrics || metrics.detector === "not started") return null;
  return <p className="camera-framing-status">{metrics.processed_fps.toFixed(1)} processed fps · {metrics.latency_ms.toFixed(0)} ms processing · p95 {metrics.p95_latency_ms.toFixed(0)} ms · {metrics.dropped_frames} skipped samples · {metrics.detector === "worker" ? "Worker processing" : "Main-thread fallback"}. Exposure timing unverified.</p>;
}
