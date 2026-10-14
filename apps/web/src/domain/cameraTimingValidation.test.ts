import { expect, it } from "vitest";
import { cameraTimingOffset, validateCameraTiming } from "./cameraTimingValidation";
import { defaultCameraInputs } from "./cameraSetup";
const inputs = defaultCameraInputs().slice(0, 2);
function report() { return { version: 1, method: "shared-visible-events", verified_at: "2026-10-14T10:00:00Z", evidence: "Retained flash test, five events over 30 seconds", bindings: inputs,
  views: [{ id: "view-1", offsets_ms: [0,0,0,0,0], uncertainty_ms: 8 }, { id: "view-2", offsets_ms: [20,22,19,21,18], uncertainty_ms: 8 }] }; }
it("accepts bounded measured event variability and derives the delay correction", () => {
  const value = validateCameraTiming(report(), inputs);
  expect(cameraTimingOffset(value, "view-2")).toBe(20);
});
it("rejects uncertain timing and source replacement instead of asserting synchronization", () => {
  const value = report(); value.views[1].offsets_ms[4] = 80;
  expect(() => validateCameraTiming(value, inputs)).toThrow("variability");
  expect(() => validateCameraTiming(report(), [{ ...inputs[0], deviceId: "replacement" }, inputs[1]])).toThrow("exact camera");
});
