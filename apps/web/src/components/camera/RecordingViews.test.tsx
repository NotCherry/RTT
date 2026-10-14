// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RecordingViews } from "./RecordingViews";
import type { CameraViewRecording } from "@/domain/multiCameraContract";
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("seeks all source videos on one timeline using each recording offset", () => {
  URL.createObjectURL = vi.fn(() => "blob:video"); URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const views: CameraViewRecording[] = [0,200].map((offset,i) => ({ id: `view-${i+1}`, source: { kind: "local-media-stream", stream_count: 1 }, offset_ms: offset, duration_ms: 1000, frames: [], video: new Blob(["pixels"]) }));
  const page = render(<RecordingViews views={views} time={500} playing={false} speed={1} />);
  const videos = page.container.querySelectorAll("video");
  expect(videos[0].currentTime).toBe(.5); expect(videos[1].currentTime).toBe(.3);
  page.rerender(<RecordingViews views={views} time={100} playing={false} speed={1} />);
  expect(videos[1].currentTime).toBe(0);
  expect(screen.getByText(/Outside this camera/)).toBeVisible();
});
