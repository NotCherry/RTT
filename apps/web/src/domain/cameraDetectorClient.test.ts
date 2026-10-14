// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createCameraDetectorClient } from "./cameraDetectorClient";
const model = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("./holisticCameraDetector", () => ({ createHolisticCameraDetector: model.create }));
const instances: FakeWorker[] = [];
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn((payload: { id: number; operation: string }) => {
    if (payload.operation === "init") queueMicrotask(() => this.onmessage?.({ data: { id: payload.id, ready: true } }));
  });
  constructor() { instances.push(this); }
}
afterEach(() => { instances.length = 0; vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("permits one inference and releases pending work on close", async () => {
  vi.stubGlobal("Worker", FakeWorker); vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ close: vi.fn() }));
  const detector = await createCameraDetectorClient();
  const pending = detector.detectForVideo(document.createElement("video"), 50);
  const rejected = expect(pending).rejects.toThrow("closed");
  await expect(detector.detectForVideo(document.createElement("video"), 60)).rejects.toThrow("already in progress");
  await Promise.resolve(); detector.close(); await rejected;
  expect(instances[0].terminate).toHaveBeenCalled();
});
it("uses a reported main-thread fallback when workers cannot be constructed", async () => {
  vi.stubGlobal("Worker", class { constructor() { throw new Error("Worker unsupported"); } });
  vi.stubGlobal("createImageBitmap", vi.fn());
  model.create.mockResolvedValue({ close: vi.fn(), detectForVideo: vi.fn().mockReturnValue({ poseLandmarks: [] }) });
  const detector = await createCameraDetectorClient();
  expect(detector.mode).toBe("main-thread"); detector.close();
});
