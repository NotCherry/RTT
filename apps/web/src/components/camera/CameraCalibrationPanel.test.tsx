// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CameraCalibrationPanel } from "./CameraCalibrationPanel";
import type { CameraRig } from "./CameraRigControls";
const api = vi.hoisted(() => ({ request: vi.fn(), capture: vi.fn() }));
vi.mock("@/api", () => ({ cameraCalibrationRequest: api.request }));
vi.mock("@/domain/cameraCalibrationCapture", () => ({ defaultBoard: { columns: 10, rows: 7, square_m: .025, marker_m: .018 }, captureCalibrationImages: api.capture }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const inputs = [1, 2].map(i => ({ id: `view-${i}`, kind: "local", deviceId: `camera-${i}`, address: "" }));
const observed = inputs.map(input => ({ id: input.id, width: 640, height: 480, ids: Array.from({ length: 14 }, (_, i) => i), points: Array.from({ length: 14 }, (_, i) => [50+i*5, 100]) }));
function rig() { return { inputs, setCalibration: vi.fn() } as unknown as CameraRig; }
it("captures shared board corners and requires fourteen poses before solving", async () => {
  const r = rig();
  api.capture.mockReturnValue(inputs.map(input => ({ id: input.id, jpeg: "snapshot" })));
  api.request.mockResolvedValue({ views: observed });
  render(<CameraCalibrationPanel rig={r} connected blocked={false} />);
  for (let i = 1; i <= 14; i++) {
    fireEvent.click(screen.getByRole("button", { name: "Capture board pose" }));
    await screen.findByText(new RegExp(`Captured ${i} board poses`));
    expect(screen.getByRole("button", { name: new RegExp("Solve calibration") })).toHaveProperty("disabled", i < 14);
  }
  expect(screen.getByRole("img", { name: "view-1 detected board corners" })).toBeVisible();
});
it("does not keep a partial detection or allow calibration during robot ownership", async () => {
  api.capture.mockReturnValue([]);
  api.request.mockResolvedValue({ views: [observed[0], { ...observed[1], ids: [], points: [] }] });
  const r = rig();
  const page = render(<CameraCalibrationPanel rig={r} connected blocked={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Capture board pose" }));
  await screen.findByText(/Board needs at least 12 matching corners/);
  expect(screen.getByRole("button", { name: /Solve calibration/ })).toHaveTextContent("0/14");
  page.rerender(<CameraCalibrationPanel rig={r} connected blocked />);
  expect(screen.getByRole("button", { name: "Capture board pose" })).toBeDisabled();
});
it("invalidates an in-flight detection when the physical source binding changes", async () => {
  let finish!: (value: unknown) => void;
  api.capture.mockReturnValue([]);
  api.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const r = rig();
  const page = render(<CameraCalibrationPanel rig={r} connected blocked={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Capture board pose" }));
  page.rerender(<CameraCalibrationPanel rig={{ ...r, inputs: [{ ...r.inputs[0], deviceId: "replacement" }, r.inputs[1]] }} connected blocked={false} />);
  finish({ views: observed });
  await waitFor(() => expect(screen.getByRole("button", { name: /Solve calibration/ })).toHaveTextContent("0/14"));
  expect(r.setCalibration).not.toHaveBeenCalled();
});
