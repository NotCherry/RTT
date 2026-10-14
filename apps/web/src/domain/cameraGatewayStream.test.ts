// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
const getFrame = vi.hoisted(() => vi.fn());
vi.mock("@/api", () => ({ getCameraGatewayFrame: getFrame }));
import { openCameraGatewayStream } from "./cameraGatewayStream";
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
function source() {
  const image = document.createElement("img");
  image.decode = vi.fn().mockResolvedValue(undefined);
  return image;
}
it("decodes configured frames and removes timing metadata on close", async () => {
  getFrame.mockResolvedValue({ epoch: "one", sequence: 1, jpeg: "AA==", source_age_ms: 10 });
  const image = source(), error = vi.fn();
  const stream = openCameraGatewayStream("side", image, error);
  await stream.ready;
  expect(image.dataset.cameraSequence).toBe("one:1");
  expect(Number(image.dataset.cameraSourceAge)).toBeGreaterThanOrEqual(10);
  stream.close();
  expect(image.dataset.cameraSequence).toBeUndefined();
  expect(error).not.toHaveBeenCalled();
});
it("rejects stale frames before exposing pixels", async () => {
  getFrame.mockResolvedValue({ epoch: "one", sequence: 1, jpeg: "AA==", source_age_ms: 251 });
  const image = source(), stream = openCameraGatewayStream("side", image, vi.fn());
  await expect(stream.ready).rejects.toThrow("stale");
  expect(image.decode).not.toHaveBeenCalled();
  stream.close();
});
it("stops a restarted source instead of continuing with old calibration", async () => {
  vi.useFakeTimers();
  getFrame.mockResolvedValueOnce({ epoch: "one", sequence: 1, jpeg: "AA==", source_age_ms: 0 })
    .mockResolvedValue({ epoch: "two", sequence: 2, jpeg: "AA==", source_age_ms: 0 });
  const error = vi.fn(), stream = openCameraGatewayStream("side", source(), error);
  await stream.ready;
  await vi.advanceTimersByTimeAsync(34);
  expect(error).toHaveBeenCalledWith(expect.stringContaining("restarted"));
  stream.close();
});
