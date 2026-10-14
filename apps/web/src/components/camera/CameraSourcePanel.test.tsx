// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { LandmarkFrame } from "@/types";
import { CameraSourcePanel } from "./CameraSourcePanel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("expands the complete live frame and labels anatomical sides in native source coordinates", () => {
  vi.spyOn(HTMLVideoElement.prototype, "videoWidth", "get").mockReturnValue(1280);
  vi.spyOn(HTMLVideoElement.prototype, "videoHeight", "get").mockReturnValue(720);
  const camera = { videoRef: createRef<HTMLVideoElement>(), imageRef: createRef<HTMLImageElement>(),
    connected: true, opening: false, recording: false, finalizing: false, elapsed: 0, status: "Ready", metrics: { processed_fps: 30, latency_ms: 10, p95_latency_ms: 12, dropped_frames: 0, detector: "worker", timing: "browser-observation" as const },
    open: vi.fn(), close: vi.fn(), startRecording: vi.fn(), stopRecording: vi.fn() };
  const pose = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 0 }));
  pose[11] = { x: .75, y: .2, z: 0, visibility: 1 };
  pose[12] = { x: .25, y: .2, z: 0, visibility: 1 };
  const latest: LandmarkFrame = { pose, timestamp: 0, confidence: .2, left_hand: [], right_hand: [] };
  const props = { source: "local" as const, setSource: vi.fn(), address: "", setAddress: vi.fn(),
    processing: "live" as const, setProcessing: vi.fn(), setMode: vi.fn(), camera, latest,
    joints: [], profile: "g1-full-body" as const, locked: false, disabled: false, onToggle: vi.fn() };
  const { container, rerender } = render(<CameraSourcePanel {...props} />);
  rerender(<CameraSourcePanel {...props} />);
  expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 1280 720");
  expect(screen.getByText("L")).toHaveAttribute("x", "960");
  expect(screen.getByText("R")).toHaveAttribute("x", "320");
  fireEvent.click(screen.getByRole("button", { name: "Expand camera" }));
  expect(screen.getByRole("button", { name: "Reduce camera" })).toHaveAttribute("aria-pressed", "true");
  expect(container.querySelector(".camera-source-panel")).toHaveClass("camera-source-expanded");
  fireEvent.click(screen.getByRole("button", { name: "Reduce camera" }));
  expect(container.querySelector(".camera-source-panel")).not.toHaveClass("camera-source-expanded");
  expect(screen.getByText(/1280 × 720 · entire camera frame/)).toBeInTheDocument();
});
