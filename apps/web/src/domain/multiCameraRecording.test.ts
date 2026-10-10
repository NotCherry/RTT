import { expect, it, vi } from "vitest";
import { extractMultiCameraRecording } from "./multiCameraRecording";
import type { CameraRecording } from "./cameraArchive";
const extract = vi.hoisted(() => vi.fn());
vi.mock("./cameraProcessing", () => ({ extractCameraRecording: extract }));
const clip: CameraRecording = {
  id: "clip",
  name: "Clip",
  created_at: "2026-10-10",
  sample_rate: 15,
  duration_ms: 1000,
  frames: [],
  video: new Blob(["one"]),
  source: { kind: "multi-camera", stream_count: 2, model: "body-aligned" },
  views: [1, 2].map((i) => ({
    id: `view-${i}`,
    source: { kind: "local-media-stream", stream_count: 1 },
    offset_ms: i - 1,
    duration_ms: 1000,
    frames: [],
    video: new Blob([`${i}`]),
  })),
};
it("re-extracts every retained view and preserves the original input on cancellation/failure", async () => {
  extract.mockReset();
  extract.mockImplementation(
    async (_video, _rate, _duration, signal, progress) => {
      signal.throwIfAborted();
      progress(100);
      return { frames: [], width: 640, height: 480, duration_ms: 1000 };
    },
  );
  const progress = vi.fn(),
    result = await extractMultiCameraRecording(
      clip,
      15,
      new AbortController().signal,
      progress,
    );
  expect(extract).toHaveBeenCalledTimes(2);
  expect("views" in result && result.views).toHaveLength(2);
  expect(progress.mock.calls.map((c) => c[0])).toEqual([50, 100]);
  expect(clip.views![0].frames).toEqual([]);
  const controller = new AbortController();
  controller.abort();
  await expect(
    extractMultiCameraRecording(clip, 15, controller.signal, progress),
  ).rejects.toThrow();
});
it("refuses to silently degrade a multi-camera clip when a view video is missing", async () => {
  await expect(
    extractMultiCameraRecording(
      { ...clip, views: clip.views!.map((v) => ({ ...v, video: undefined })) },
      15,
      new AbortController().signal,
      vi.fn(),
    ),
  ).rejects.toThrow(/missing/);
});
