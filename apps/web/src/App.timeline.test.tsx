// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { Robot } from "./types";
import * as api from "./api";

vi.mock("./RobotScene", () => ({
  RobotScene: () => <div data-testid="robot-scene" />,
}));
vi.mock("./components/workbench/RobotViewport", () => ({
  RobotViewport: () => <div data-testid="robot-viewport" />,
}));
vi.mock("./api", () => ({
  createSession: vi.fn(),
  exportUrl: vi.fn(() => "#export"),
  loadDemoRobot: vi.fn(),
  predictPose: vi.fn(),
  rolloutSession: vi.fn(),
  saveDatasets: vi.fn(() => Promise.resolve()),
  saveDemonstrations: vi.fn(() => Promise.resolve()),
  trainSession: vi.fn(),
  uploadRobot: vi.fn(),
  websocketUrl: vi.fn(() => "ws://test"),
}));

const robot: Robot = {
  id: "sample-arm",
  name: "Sample arm",
  filename: "sample.urdf",
  root: "base",
  links: [],
  joints: [
    {
      name: "shoulder",
      type: "revolute",
      parent: "base",
      child: "arm",
      origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
      axis: [0, 0, 1],
      lower: -1,
      upper: 1,
      controllable: true,
    },
  ],
};

class MockWebSocket {
  static readonly OPEN = 1;
  readyState = MockWebSocket.OPEN;
  close() {}
  send() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.mocked(api.loadDemoRobot).mockResolvedValue(robot);
  vi.mocked(api.createSession).mockResolvedValue({
    session_id: "session-1",
    robot,
    state: { positions: [0], training: false },
  });
  window.history.replaceState({}, "", "/teach/pose");
});

describe("production timeline keypose flow", () => {
  it("inserts at the scrubbed playhead and typed targets without touching frame 0", async () => {
    render(<App />);
    // Sample robot now auto-loads; still allow manual open if button present
    const openBtn = screen.queryByRole("button", { name: "Open sample robot" });
    if (openBtn) fireEvent.click(openBtn);
    fireEvent.click(screen.getByRole("link", { name: "Timeline" }));
    // Wait for timeline editor to appear (FPS controls are always present now)
    await waitFor(() =>
      expect(screen.getByLabelText("FPS")).toBeInTheDocument(),
    );

    // Create initial gesture if none: insert first key at frame 0 (default pose)
    const insertBtn = screen.getByRole("button", {
      name: "Insert full-pose key",
    });
    fireEvent.click(insertBtn);
    await waitFor(() =>
      expect(screen.getByText(/authored keyframe/)).toBeInTheDocument(),
    );

    // User-reported path: scrub to an empty frame, pose it, insert. The key
    // must land at the playhead frame — never at frame 0.
    fireEvent.change(screen.getByLabelText("Scrub keyframes"), {
      target: { value: "12" },
    });
    const frameInput = screen.getByRole("spinbutton", {
      name: "Insert frame",
    });
    expect(frameInput).toHaveValue(12);

    const poseInput = screen.getByRole("spinbutton", {
      name: "shoulder at selected keyframe",
    });
    fireEvent.change(poseInput, { target: { value: "0.5" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Insert full-pose key" }),
    );

    await waitFor(() => {
      // Duration is now declarative (default 120); label shows effective duration
      expect(screen.getByText(/Frame 12 \//)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /at frame 12 for shoulder/ }),
      ).toBeInTheDocument();
    });
    expect(frameInput).toHaveValue(12);
    expect(
      screen.getByRole("spinbutton", { name: "shoulder at selected keyframe" }),
    ).toHaveValue(0.5);

    // Frame 0 keeps its original pose.
    fireEvent.click(
      screen.getByRole("button", { name: /at frame 0 for shoulder/ }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("spinbutton", {
          name: "shoulder at selected keyframe",
        }),
      ).toHaveValue(0),
    );

    // Typing a frame stages the insert target and moves the playhead.
    fireEvent.change(frameInput, { target: { value: "30" } });
    expect(frameInput).toHaveValue(30);
    fireEvent.click(
      screen.getByRole("button", { name: "Insert full-pose key" }),
    );
    await waitFor(() => {
      expect(screen.getByText(/Frame 30 \//)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /at frame 30 for shoulder/ }),
      ).toBeInTheDocument();
    });

    const savesBeforeTimeline = vi.mocked(api.saveDemonstrations).mock.calls
      .length;
    fireEvent.click(screen.getByRole("button", { name: "Save keyframes" }));
    await waitFor(() =>
      expect(vi.mocked(api.saveDemonstrations).mock.calls.length).toBe(
        savesBeforeTimeline + 1,
      ),
    );
    const latestSave = vi.mocked(api.saveDemonstrations).mock.calls.at(-1);
    const savedGesture = latestSave?.[1].find(
      (item) => item.kind === "gesture",
    );
    expect(
      savedGesture?.keyframes?.some(
        (keyframe) => keyframe.frame === 12 && keyframe.positions[0] === 0.5,
      ),
    ).toBe(true);
    expect(
      savedGesture?.keyframes?.some((keyframe) => keyframe.frame === 30),
    ).toBe(true);
    expect(
      savedGesture?.keyframes?.some(
        (keyframe) => keyframe.frame === 0 && keyframe.positions[0] === 0,
      ),
    ).toBe(true);

    fireEvent.change(
      screen.getByRole("spinbutton", { name: "shoulder at selected keyframe" }),
      { target: { value: "" } },
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a value between -1 and 1 for shoulder.",
    );
    expect(
      screen.getByRole("button", { name: "Insert full-pose key" }),
    ).toBeDisabled();
  });
});
