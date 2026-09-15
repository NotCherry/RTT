import { describe, expect, it } from "vitest";
import { directIpCameraStreamUrl } from "./ipCamera";

describe("directIpCameraStreamUrl", () => {
  it("uses Android IP Camera's MJPEG endpoint when given its control-page address", () => {
    expect(directIpCameraStreamUrl("http://10.189.224.16:4444")).toBe("http://10.189.224.16:4444/video/mjpeg");
  });
});
