import { describe, expect, it } from "vitest";
import { cameraErrorMessage } from "./cameraErrors";

describe("cameraErrorMessage", () => {
  it("explains why a browser cannot ask permission when no camera device exists", () => {
    expect(cameraErrorMessage(new DOMException("", "NotFoundError"), 0)).toContain("No enabled camera was found");
    expect(cameraErrorMessage(new DOMException("", "NotFoundError"), 0)).toContain("Lenovo privacy shutter");
  });

  it("keeps a blocked permission distinct from a missing device", () => {
    expect(cameraErrorMessage(new DOMException("", "NotAllowedError"))).toContain("permission was blocked");
  });
});
