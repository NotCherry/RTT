import { expect, it } from "vitest";
import { observeImageSignature } from "./cameraImageFreshness";
it("does not let indefinitely repeated IP pixels refresh control and recovers on change", () => {
  const state = { signature: "", changedAt: -Infinity };
  expect(observeImageSignature(state, "frame-one", 0)).toBe(true);
  expect(observeImageSignature(state, "frame-one", 251)).toBe(false);
  expect(observeImageSignature(state, "frame-two", 260)).toBe(true);
});
