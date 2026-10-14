// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const detector = vi.hoisted(() => ({ detectForVideo: vi.fn(), close: vi.fn() }));
const create = vi.hoisted(() => vi.fn());
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: vi.fn() },
  HolisticLandmarker: { createFromOptions: create },
  PoseLandmarker: { createFromOptions: vi.fn(async () => ({ close: vi.fn(), detectForVideo: () => ({ landmarks: [], worldLandmarks: [] }) })) },
}));
import { extractCameraRecording } from "./cameraProcessing";
let position = 0;
beforeEach(() => {
  vi.clearAllMocks();
  position = 0;
  create.mockResolvedValue(detector);
  detector.detectForVideo.mockReturnValue({
    poseLandmarks: [Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }))],
  });
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function (this: HTMLVideoElement) {
    if (this.hasAttribute("src")) queueMicrotask(() => this.dispatchEvent(new Event("loadeddata")));
  });
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(0.3);
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "get").mockImplementation(() => position);
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "set").mockImplementation(function (
    this: HTMLVideoElement,
    value,
  ) {
    position = value;
    queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
  });
});
afterEach(() => vi.restoreAllMocks());
it("extracts with a fresh detector, monotonic clip timestamps and releases it", async () => {
  const result = await extractCameraRecording(new Blob(), 10, 300, new AbortController().signal, vi.fn());
  expect(create).toHaveBeenCalledTimes(1);
  expect(result.frames.map((frame) => frame.timestamp)).toEqual([0, 100, 200]);
  expect(detector.detectForVideo.mock.calls.map((call) => call[1])).toEqual([0, 100, 200]);
  expect(detector.close).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});
it("cancels extraction and closes the detector without returning partial frames", async () => {
  const abort = new AbortController();
  await expect(extractCameraRecording(new Blob(), 10, 300, abort.signal, () => abort.abort())).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(detector.close).toHaveBeenCalledOnce();
});
it("reports rejected frames instead of inventing a successful gesture", async () => {
  detector.detectForVideo.mockReturnValue({ poseLandmarks: [] });
  const result = await extractCameraRecording(new Blob(), 10, 300, new AbortController().signal, vi.fn());
  expect(result.frames).toEqual([]);
  expect(result.rejected_frames).toBe(3);
});
it("rejects detected multiple people instead of choosing the first person's target", async () => {
  const pose = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
  detector.detectForVideo.mockReturnValue({ poseLandmarks: [pose, pose] });
  const result = await extractCameraRecording(new Blob(), 10, 300, new AbortController().signal, vi.fn());
  expect(result.frames).toEqual([]);
  expect(result.rejected_frames).toBe(3);
});
it("fails on decoder errors instead of waiting indefinitely", async () => {
  vi.mocked(HTMLMediaElement.prototype.load).mockImplementation(function (this: HTMLVideoElement) {
    queueMicrotask(() => this.dispatchEvent(new Event("error")));
  });
  await expect(extractCameraRecording(new Blob(), 10, 300, new AbortController().signal, vi.fn())).rejects.toThrow(
    "could not be decoded",
  );
  expect(create).not.toHaveBeenCalled();
});
it("rejects invalid sample rates before allocating decoder resources", async () => {
  for (const rate of [0, -1, NaN, Infinity, 100]) {
    await expect(extractCameraRecording(new Blob(), rate, 300, new AbortController().signal, vi.fn()))
      .rejects.toThrow("sample rate");
  }
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("does not open media for an already cancelled extraction", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(extractCameraRecording(new Blob(), 10, 300, controller.signal, vi.fn()))
    .rejects.toMatchObject({ name: "AbortError" });
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("uses retained recording duration without seeking beyond a durationless video", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(Infinity);
  const result = await extractCameraRecording(new Blob(), 10, 300, new AbortController().signal, vi.fn());
  expect(result.duration_ms).toBe(300);
  expect(vi.mocked(Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime")!.set!)
    .mock.calls.every(([seconds]) => seconds < 1)).toBe(true);
});
it("retains confident upper-body observations when hidden legs lower the aggregate score", async () => {
  const pose = Array.from({ length: 33 }, (_, i) => ({ x: i % 2 ? .3 : .7, y: .3, z: 0,
    visibility: [11,12,13,14,15,16].includes(i) ? 1 : .05 }));
  detector.detectForVideo.mockReturnValue({ poseLandmarks: [pose], poseWorldLandmarks: [pose] });
  const result = await extractCameraRecording(new Blob(), 10, 300, new AbortController().signal, vi.fn());
  expect(result.frames).toHaveLength(3);
  expect(result.frames[0].confidence).toBeLessThan(.5);
  expect(result.frames[0].pose_world).toHaveLength(33);
  expect(result.rejected_frames).toBe(0);
});
