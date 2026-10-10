// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCameraCapture } from "./useCameraCapture";
const model = vi.hoisted(() => ({
  create: vi.fn(),
  detect: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/domain/cameraProcessing", () => ({
  createCameraDetector: model.create,
  detectCameraFrame: model.detect,
}));
const callbacks = new Map<number, FrameRequestCallback>();
let id = 0,
  time = 0;
const track = {
  stop: vi.fn(),
  onended: null as ((event: Event) => void) | null,
};
const stream = {
  getTracks: () => [track],
  getVideoTracks: () => [track],
} as unknown as MediaStream;
const getMedia = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  callbacks.clear();
  id = 0;
  time = 0;
  track.onended = null;
  getMedia.mockResolvedValue(stream);
  model.create.mockResolvedValue({ close: model.close });
  model.detect.mockReturnValue({
    timestamp: 0,
    confidence: 1,
    pose: Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.5,
      z: 0,
      visibility: 1,
    })),
    left_hand: [],
    right_hand: [],
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => callbacks.delete(key));
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: getMedia },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup() {
  const onFrame = vi.fn(),
    onRecordingError = vi.fn();
  const hook = renderHook(() =>
    useCameraCapture({
      processing: "live",
      sampleRate: 30,
      onFrame,
      onRecordingError,
      onRecording: vi.fn().mockResolvedValue(undefined),
    }),
  );
  hook.result.current.videoRef.current = document.createElement("video");
  return { ...hook, onFrame, onRecordingError };
}
function tick(timestamp: number) {
  time = timestamp;
  const pending = [...callbacks.values()];
  callbacks.clear();
  act(() => pending.forEach((callback) => callback(timestamp)));
}
it("selects the exact device, ignores repeated media frames, and stops all resources on close", async () => {
  const { result } = setup();
  await act(() => result.current.open("local", "", "chosen-camera"));
  expect(getMedia).toHaveBeenCalledWith(
    expect.objectContaining({
      video: expect.objectContaining({ deviceId: { exact: "chosen-camera" } }),
    }),
  );
  tick(0);
  tick(40);
  tick(80);
  expect(model.detect).toHaveBeenCalledTimes(1);
  result.current.videoRef.current!.currentTime = 0.1;
  tick(120);
  expect(model.detect).toHaveBeenCalledTimes(2);
  act(() => result.current.close());
  expect(track.stop).toHaveBeenCalled();
  expect(model.close).toHaveBeenCalled();
  expect(callbacks.size).toBe(0);
});
it("releases a late media stream when a pending open was cancelled", async () => {
  let resolve!: (value: MediaStream) => void;
  getMedia.mockReturnValue(
    new Promise<MediaStream>((done) => {
      resolve = done;
    }),
  );
  const { result } = setup();
  let operation: Promise<unknown>;
  act(() => {
    operation = result.current.open("local", "");
  });
  act(() => result.current.close());
  await act(async () => {
    resolve(stream);
    await operation;
  });
  expect(track.stop).toHaveBeenCalledOnce();
  expect(model.create).not.toHaveBeenCalled();
  expect(result.current.connected).toBe(false);
});
it("reports device loss and invalidates its observation", async () => {
  const { result, onFrame, onRecordingError } = setup();
  await act(() => result.current.open("local", ""));
  act(() => track.onended!(new Event("ended")));
  expect(result.current.connected).toBe(false);
  expect(onFrame).toHaveBeenLastCalledWith(null);
  expect(onRecordingError).toHaveBeenCalledWith(
    expect.stringContaining("Camera disconnected"),
  );
});
