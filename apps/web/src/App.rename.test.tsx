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
  closeSession: vi.fn(() => Promise.resolve()),
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
  window.localStorage.clear();
  vi.stubGlobal("WebSocket", MockWebSocket);
  vi.mocked(api.loadDemoRobot).mockResolvedValue(robot);
  vi.mocked(api.createSession).mockResolvedValue({
    session_id: "session-1",
    robot,
    state: { positions: [0], training: false },
  });
  window.history.replaceState({}, "", "/teach/pose");
});

describe("pose/gesture naming with spaces", () => {
  it("keeps spaces while renaming a gesture in the timeline editor", async () => {
    render(<App />);
    const openBtn = screen.queryByRole("button", {
      name: "Open sample robot",
    });
    if (openBtn) fireEvent.click(openBtn);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Capture pose" }),
      ).toBeEnabled(),
    );

    // Capture with a spaced name, then author a gesture from it.
    fireEvent.change(screen.getByLabelText("Pose name"), {
      target: { value: "Home base" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Capture pose" }));
    await waitFor(() => expect(api.saveDemonstrations).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("link", { name: "Timeline" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Insert full-pose key" }),
    );
    const nameInput = await screen.findByLabelText("Gesture name");

    // Trailing space must survive while typing, not snap back.
    fireEvent.change(nameInput, { target: { value: "Wave " } });
    expect(nameInput).toHaveValue("Wave ");
    fireEvent.change(nameInput, { target: { value: "Wave hello" } });
    expect(nameInput).toHaveValue("Wave hello");
  });
});
