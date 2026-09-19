// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecordingPlayer } from "./RecordingPlayer";
import { StickFigure } from "./StickFigure";
vi.mock("@/components/workbench/RobotViewport", () => ({ RobotViewport: () => <div>Robot preview</div> }));
let tick: FrameRequestCallback;
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockReturnValue(false);
  URL.createObjectURL = vi.fn(() => "blob:recording");
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    tick = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("finishes the timeline when encoded video ends early and restarts on Play", () => {
  const { container } = render(
    <RecordingPlayer
      recording={{
        id: "clip",
        name: "Clip",
        created_at: "",
        sample_rate: 15,
        source: { kind: "local-media-stream", stream_count: 1 },
        duration_ms: 2000,
        frames: [],
        video: new Blob(),
      }}
      robot={null}
      state={null}
      joints={[]}
      neutral={[]}
      profile="g1-upper-body"
      onPreview={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  vi.spyOn(HTMLMediaElement.prototype, "ended", "get").mockReturnValue(true);
  container.querySelector("video")!.currentTime = 1;
  act(() => tick(1000));
  expect(screen.getByLabelText("Playback time")).toHaveTextContent("2.00");
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(container.querySelector("video")!.currentTime).toBe(0);
  expect(screen.getByRole("button", { name: "Pause" })).toBeEnabled();
});
it("discovers the duration of a recovered raw video before extraction", () => {
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(1.5);
  const { container } = render(
    <RecordingPlayer
      recording={{
        id: "legacy",
        name: "Recovered recording",
        created_at: "",
        sample_rate: 15,
        source: { kind: "local-media-stream", stream_count: 1 },
        duration_ms: 0,
        frames: [],
        video: new Blob(),
      }}
      robot={null}
      state={null}
      joints={[]}
      neutral={[]}
      profile="g1-upper-body"
      onPreview={vi.fn()}
    />,
  );
  fireEvent.loadedMetadata(container.querySelector("video")!);
  expect(screen.getByText("0 extracted frames · 1.5 seconds")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
});
it("restores the shared cursor after probing a durationless WebM", () => {
  let duration = Number.POSITIVE_INFINITY;
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockImplementation(() => duration);
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(HTMLMediaElement.HAVE_METADATA);
  const { container } = render(
    <RecordingPlayer
      recording={{
        id: "durationless",
        name: "Durationless WebM",
        created_at: "",
        sample_rate: 15,
        source: { kind: "local-media-stream", stream_count: 1 },
        duration_ms: 0,
        frames: [],
        video: new Blob(),
      }}
      robot={null}
      state={null}
      joints={[]}
      neutral={[]}
      profile="g1-upper-body"
      onPreview={vi.fn()}
    />,
  );
  const video = container.querySelector("video")!;
  fireEvent.loadedMetadata(video);
  expect(video.currentTime).toBe(1e10);
  duration = 1.5;
  video.currentTime = duration;
  fireEvent.durationChange(video);
  expect(video.currentTime).toBe(0);
  expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
});
it("projects landscape and portrait overlays in source coordinates", () => {
  const frame = { timestamp: 0, pose: [{ x: 0.25, y: 0.75, z: 0 }], left_hand: [], right_hand: [], confidence: 1 };
  const { container, rerender } = render(<StickFigure frame={frame} overlay width={1920} height={1080} />);
  expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 1920 1080");
  expect(container.querySelector("circle")).toHaveAttribute("cy", "810");
  rerender(<StickFigure frame={frame} overlay width={1080} height={1920} />);
  expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 1080 1920");
  expect(container.querySelector("circle")).toHaveAttribute("cy", "1440");
});
