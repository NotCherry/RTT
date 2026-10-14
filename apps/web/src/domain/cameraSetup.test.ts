// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { defaultCameraInputs, loadCameraSetup, saveCameraSetup } from "./cameraSetup";
afterEach(() => localStorage.clear());
it("restores exact USB/IP bindings per robot without opening a resource", () => {
  const inputs = defaultCameraInputs(); inputs[0].deviceId = "usb-A";
  inputs[1] = { ...inputs[1], kind: "ip", address: "http://camera.local/video" };
  saveCameraSetup("one", { version: 1, name: "Mixed rig", inputs: inputs.slice(0, 2), model: "body-aligned" });
  expect(loadCameraSetup("one")?.inputs).toEqual(inputs.slice(0, 2));
  expect(loadCameraSetup("two")).toBeNull();
});
it("rejects malformed stored setups instead of assigning cameras by list order", () => {
  localStorage.setItem("rtt-camera-setup-v1:one", JSON.stringify({ version: 1, name: "Invalid", model: "body-aligned", inputs: [{ id: "view-3", kind: "local", deviceId: "a", address: "" }] }));
  expect(loadCameraSetup("one")).toBeNull();
});
