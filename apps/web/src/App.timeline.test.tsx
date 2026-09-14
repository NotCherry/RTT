// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

afterEach(cleanup);

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

describe("production timeline keypose flow", () => {
  it("creates empty datasets and lets training show all archived demonstrations", async () => {
    render(<App />);
    const capture = await screen.findByRole("button", { name: "Capture pose" });
    await waitFor(() => expect(capture).toBeEnabled());
    fireEvent.click(capture);
    fireEvent.click(screen.getByRole("link", { name: "Archive" }));
    fireEvent.click(screen.getByRole("button", { name: "New dataset" }));
    fireEvent.click(screen.getByRole("link", { name: "Train" }));
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Dataset"), { target: { value: "" } });
    expect(await screen.findByRole("radio")).toBeInTheDocument();
    expect(screen.getByLabelText("Dataset")).toHaveValue("");
  });

  it("keeps a demonstration when deletion is cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);
    const capture = await screen.findByRole("button", { name: "Capture pose" });
    await waitFor(() => expect(capture).toBeEnabled());
    fireEvent.click(capture);
    fireEvent.click(screen.getByRole("link", { name: "Archive" }));
    const deleteButton = screen.getByRole("button", { name: "Delete Pose 01" });
    fireEvent.click(deleteButton);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Pose 01"));
    expect(deleteButton).toBeInTheDocument();
    confirm.mockReturnValue(true);
    fireEvent.click(deleteButton);
    expect(screen.queryByRole("button", { name: "Delete Pose 01" })).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it("restores an authored gesture from browser storage after remounting", async () => {
    const firstView = render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Capture pose" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("link", { name: "Timeline" }));
    await waitFor(() =>
      expect(screen.getByLabelText("FPS")).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText("Gesture name"), {
      target: { value: "Persistent wave" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Insert full-pose key" }),
    );
    await waitFor(() =>
      expect(screen.getByText(/authored keyframe/)).toBeInTheDocument(),
    );

    firstView.unmount();
    window.history.replaceState({}, "", "/archive");
    render(<App />);

    expect(await screen.findAllByText("Persistent wave")).toHaveLength(2);
    expect(
      screen.getByText(/saved automatically in this browser/i),
    ).toBeInTheDocument();
  });

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

  it("loops playback over the full duration instead of sticking", async () => {
    render(<App />);
    const openBtn = screen.queryByRole("button", { name: "Open sample robot" });
    if (openBtn) fireEvent.click(openBtn);
    fireEvent.click(screen.getByRole("link", { name: "Timeline" }));
    await waitFor(() =>
      expect(screen.getByLabelText("FPS")).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Insert full-pose key",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/authored keyframe/)).toBeInTheDocument(),
    );

    // Duration below the 60-frame floor with a key at frame 30.
    fireEvent.change(screen.getByLabelText("Duration frames"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Insert frame" }), {
      target: { value: "30" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Insert full-pose key",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/Frame 30 \/ 60/)).toBeInTheDocument(),
    );

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
      const step = 1000 / 60;
      // One act() per tick so the interval closure sees each new playhead.
      const advance = (ticks: number) => {
        for (let i = 0; i < ticks; i += 1) {
          act(() => {
            vi.advanceTimersByTime(step);
          });
        }
      };
      advance(35);
      // (30 + 35) % 61 === 4 — playback moved past frame 30 and wrapped.
      expect(screen.getByText(/Frame 4 \/ 60/)).toBeInTheDocument();
      advance(61);
      // A full 61-frame cycle later it is back at frame 4, not stuck at 30.
      expect(screen.getByText(/Frame 4 \/ 60/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("loops playback past keys authored beyond the duration", async () => {
    render(<App />);
    const openBtn = screen.queryByRole("button", { name: "Open sample robot" });
    if (openBtn) fireEvent.click(openBtn);
    fireEvent.click(screen.getByRole("link", { name: "Timeline" }));
    await waitFor(() =>
      expect(screen.getByLabelText("FPS")).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Insert full-pose key",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/authored keyframe/)).toBeInTheDocument(),
    );

    // Duration 30 with a key at frame 100: the timeline spans 0..101.
    fireEvent.change(screen.getByLabelText("Duration frames"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Insert frame" }), {
      target: { value: "100" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Insert full-pose key",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/Frame 100 \/ 101/)).toBeInTheDocument(),
    );

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
      const step = 1000 / 60;
      const advance = (ticks: number) => {
        for (let i = 0; i < ticks; i += 1) {
          act(() => {
            vi.advanceTimersByTime(step);
          });
        }
      };
      // (100 + 5) % 102 === 3 — playback crosses the duration boundary.
      advance(5);
      expect(screen.getByText(/Frame 3 \/ 101/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves the current gesture and starts a new one", async () => {
    render(<App />);
    const openBtn = screen.queryByRole("button", { name: "Open sample robot" });
    if (openBtn) fireEvent.click(openBtn);
    fireEvent.click(screen.getByRole("link", { name: "Timeline" }));
    await waitFor(() =>
      expect(screen.getByLabelText("FPS")).toBeInTheDocument(),
    );

    // Author a first gesture.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Insert full-pose key",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/authored keyframe/)).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByLabelText("Gesture name"), {
      target: { value: "My Wave" },
    });

    // Save & New leaves the renamed gesture behind and starts fresh.
    fireEvent.click(screen.getByRole("button", { name: "Save & New" }));
    await waitFor(() =>
      expect(screen.getByText("No gesture yet")).toBeInTheDocument(),
    );

    // The next insert creates a second, independent gesture.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Insert full-pose key",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/authored keyframe/)).toBeInTheDocument(),
    );
    const latestSave = vi.mocked(api.saveDemonstrations).mock.calls.at(-1);
    const gestures = (latestSave?.[1] ?? []).filter(
      (item) => item.kind === "gesture",
    );
    expect(gestures).toHaveLength(2);
    expect(gestures.map((item) => item.name)).toEqual([
      "My Wave",
      expect.stringMatching(/^Gesture/),
    ]);
  });

  it("names the next gesture before its first keyframe", async () => {
    render(<App />);
    const openBtn = screen.queryByRole("button", { name: "Open sample robot" });
    if (openBtn) fireEvent.click(openBtn);
    fireEvent.click(screen.getByRole("link", { name: "Timeline" }));
    await waitFor(() =>
      expect(screen.getByLabelText("FPS")).toBeInTheDocument(),
    );

    // No selection yet — the name field stages the next gesture's name.
    const nameInput = screen.getByLabelText("Gesture name");
    expect(nameInput).toBeEnabled();
    fireEvent.change(nameInput, { target: { value: "First Idea" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Insert full-pose key",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/authored keyframe/)).toBeInTheDocument(),
    );
    let latestSave = vi.mocked(api.saveDemonstrations).mock.calls.at(-1);
    let gestures = (latestSave?.[1] ?? []).filter(
      (item) => item.kind === "gesture",
    );
    expect(gestures.map((item) => item.name)).toEqual(["First Idea"]);

    // Save & New clears the staged name; staging another one applies to it.
    fireEvent.click(screen.getByRole("button", { name: "Save & New" }));
    await waitFor(() =>
      expect(screen.getByText("No gesture yet")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Gesture name")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Gesture name"), {
      target: { value: "Second Idea" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Insert full-pose key",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText(/authored keyframe/)).toBeInTheDocument(),
    );
    latestSave = vi.mocked(api.saveDemonstrations).mock.calls.at(-1);
    gestures = (latestSave?.[1] ?? []).filter(
      (item) => item.kind === "gesture",
    );
    expect(gestures.map((item) => item.name)).toEqual([
      "First Idea",
      "Second Idea",
    ]);
  });
});

describe("training draft guard", () => {
  it("warns when timeline has unsaved changes", async () => {
    const { TrainingPage } = await import("./components/app/TrainingPage");
    const { MemoryRouter } = await import("react-router-dom");
    const { render: r2 } = await import("@testing-library/react");
    const { container } = r2(
      <MemoryRouter>
        <TrainingPage
          demonstrations={[
            {
              id: "d1",
              name: "demo",
              kind: "gesture",
              current: [0],
              target: [0],
              frames: [{ timestamp: 0, positions: [0] }],
              timeline_fps: 30,
              duration_frames: 60,
              start_frame_index: 0,
            } as unknown as import("./types").Demonstration,
          ]}
          datasets={[]}
          activeDatasetId={null}
          selectedDemoId="d1"
          controllableJoints={[robot.joints[0]]}
          config={
            {
              epochs: "100",
              timestep_ms: "120",
              physics: true,
              hidden_layers: "64,64",
              learning_rate: "0.003",
              batch_size: "16",
              rollout_steps: "160",
              random_starts: "0",
            } as unknown as import("./types").TrainingConfig
          }
          hiddenLayerText="64,64"
          metric={null}
          busy={false}
          training={false}
          trained={false}
          optimizing={false}
          optimizationResults={[]}
          sessionId="s1"
          hasUnsavedTimelineChanges={true}
          onDatasetChange={() => {}}
          onDemoChange={() => {}}
          onConfigChange={() => {}}
          onModelSpecChange={() => {}}
          onTrain={() => {}}
          onOptimize={() => {}}
        />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain("Timeline has unsaved changes");
  });
  it("shows budget warning pill when rollout is trimmed", async () => {
    const { EvaluatePage } = await import("./components/app/EvaluatePage");
    const { MemoryRouter } = await import("react-router-dom");
    const { render: r3 } = await import("@testing-library/react");
    const { container } = r3(
      <MemoryRouter>
        <EvaluatePage
          robot={robot}
          state={
            { positions: [0] } as unknown as import("./types").SimulationState
          }
          trained={true}
          busy={false}
          demonstrationsLength={1}
          demonstrationName="demo"
          demonstrationKind="gesture"
          checkpointCount={2}
          rolloutFrames={[
            {
              timestamp: 0,
              positions: [0],
              expected: [0],
            } as unknown as import("./types").RolloutFrame,
            {
              timestamp: 120,
              positions: [0.1],
              expected: [0.1],
            } as unknown as import("./types").RolloutFrame,
          ]}
          rolloutDiagnostics={{
            density_ratio: 2,
            warnings: [
              {
                type: "warning",
                message:
                  "Gesture trimmed: approach consumed max_steps budget (2), 0 gesture steps emitted",
              },
            ],
          }}
          evaluation={{ target: [0], positions: [0], error: 0 }}
          evaluationStepBudget={160}
          replaying={false}
          onReplay={() => {}}
          onEvaluate={() => {}}
          onEvaluationStepBudgetChange={() => {}}
        />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain("Gesture trimmed");
  });
});
