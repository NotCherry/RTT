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
  it("inserts at the typed frame and preserves it while scrubbing", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open sample robot" }));
    fireEvent.click(screen.getByRole("link", { name: "Timeline" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Start capture" }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Start capture" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop capture" }));
    await waitFor(() =>
      expect(screen.getByText(/authored keyframe/)).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText("Scrub keyframes"), {
      target: { value: "12" },
    });
    const frameInput = screen.getByRole("spinbutton", {
      name: "Selected keyframe frame",
    });
    fireEvent.change(frameInput, { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Scrub keyframes"), {
      target: { value: "12" },
    });
    const poseInput = screen.getByRole("spinbutton", {
      name: "shoulder at selected keyframe",
    });
    fireEvent.change(poseInput, { target: { value: "0.5" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Insert full-pose key" }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Frame 30 \/ 60/)).toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: /at frame 30 for shoulder/,
        }),
      ).toBeInTheDocument();
    });
    expect(frameInput).toHaveValue(30);
    expect(
      screen.getByRole("spinbutton", { name: "shoulder at selected keyframe" }),
    ).toHaveValue(0.5);
    expect(screen.getByText(/3 authored keyframes/)).toBeInTheDocument();

    fireEvent.change(frameInput, { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Scrub keyframes"), {
      target: { value: "12" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Insert full-pose key" }),
    );
    await waitFor(() => {
      expect(screen.getByText(/Frame 4 \/ 60/)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /at frame 4 for shoulder/ }),
      ).toBeInTheDocument();
    });
    expect(frameInput).toHaveValue(4);
    expect(screen.getByText(/4 authored keyframes/)).toBeInTheDocument();

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
        (keyframe) => keyframe.frame === 30 && keyframe.positions[0] === 0.5,
      ),
    ).toBe(true);

    fireEvent.change(poseInput, { target: { value: "0.25" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(
      screen.getByRole("button", { name: /at frame 30 for shoulder/ }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("spinbutton", {
          name: "shoulder at selected keyframe",
        }),
      ).toHaveValue(0.5),
    );

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
    expect(screen.getByText(/4 authored keyframes/)).toBeInTheDocument();
  });
});
