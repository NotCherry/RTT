// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CameraTimingPanel } from "./CameraTimingPanel";
import { defaultCameraInputs } from "@/domain/cameraSetup";
import type { CameraRig } from "./CameraRigControls";
afterEach(cleanup);
it("stores measured evidence and refuses a report with excessive uncertainty", () => {
  const setTiming = vi.fn(), inputs = defaultCameraInputs().slice(0,2);
  const rig = { inputs, calibration: {}, setTiming } as unknown as CameraRig;
  render(<CameraTimingPanel rig={rig} disabled={false} />);
  fireEvent.change(screen.getByLabelText("Timing evidence"), { target: { value: "Flash recording, five shared events" } });
  fireEvent.change(screen.getByLabelText("Timing uncertainty"), { target: { value: "8" } });
  fireEvent.change(screen.getByLabelText("view-2 event delays"), { target: { value: "12,14,13,12,14" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply measured timing" }));
  expect(setTiming).toHaveBeenCalledOnce();
  expect(setTiming).toHaveBeenCalledWith(expect.objectContaining({ method: "shared-visible-events", bindings: inputs }));
  fireEvent.change(screen.getByLabelText("Timing uncertainty"), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply measured timing" }));
  expect(screen.getByRole("alert")).toHaveTextContent("variability exceeds");
  expect(setTiming).toHaveBeenCalledOnce();
});
