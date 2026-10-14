export type CameraFrameMetrics = { processed_fps: number; latency_ms: number; p95_latency_ms: number; dropped_frames: number; detector: string; timing: "browser-observation" };
export function cameraFrameMetrics(times: number[], durations: number[], dropped: number, detector: string): CameraFrameMetrics {
  const sorted = [...durations].sort((a, b) => a - b);
  const span = (times.at(-1) ?? 0) - (times[0] ?? 0);
  return { processed_fps: span > 0 ? (times.length - 1) * 1000 / span : 0, latency_ms: durations.at(-1) ?? 0,
    p95_latency_ms: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0, dropped_frames: dropped, detector, timing: "browser-observation" };
}
