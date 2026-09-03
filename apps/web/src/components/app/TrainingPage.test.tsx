// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrainingPage } from "./TrainingPage";
import type { Demonstration } from "@/types";

const demos: Demonstration[] = [
  {
    id: "demo-1",
    name: "Home pose",
    kind: "pose",
    current: [0],
    target: [0],
    frames: [{ timestamp: 0, positions: [0] }],
    keyframes: [
      {
        id: "key-1",
        frame: 0,
        timestamp: 0,
        positions: [0],
        interpolation: "linear",
      },
    ],
    dataset_id: "dataset-1",
  },
  {
    id: "gesture-1",
    name: "Wave",
    kind: "gesture",
    current: [0],
    target: [0.5],
    frames: [
      { timestamp: 0, positions: [0] },
      { timestamp: 100, positions: [0.5] },
    ],
    keyframes: [
      {
        id: "key-1",
        frame: 0,
        timestamp: 0,
        positions: [0],
        interpolation: "linear",
      },
      {
        id: "key-2",
        frame: 3,
        timestamp: 100,
        positions: [0.5],
        interpolation: "linear",
      },
    ],
    dataset_id: "dataset-1",
  },
];

const datasets = [
  {
    id: "dataset-1",
    name: "Dataset 1",
    demonstration_ids: ["demo-1", "gesture-1"],
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
  },
];

afterEach(cleanup);

function renderPage(props?: Partial<Parameters<typeof TrainingPage>[0]>) {
  return render(
    <MemoryRouter>
      <TrainingPage
        demonstrations={demos}
        datasets={datasets}
        activeDatasetId={null}
        selectedDemoId={null}
        controllableJoints={[]}
        config={{
          hidden_layers: [32],
          activation: "relu",
          learning_rate: 0.003,
          epochs: 10,
          batch_size: 16,
          timestep_ms: 100,
          random_starts: 0,
          random_seed: 7,
          rollout_steps: 10,
        }}
        hiddenLayerText="32"
        metric={null}
        busy={false}
        training={false}
        trained={false}
        sessionId="session-1"
        onDatasetChange={() => {}}
        onDemoChange={() => {}}
        onConfigChange={() => {}}
        onTrain={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("TrainingPage single-target picker", () => {
  it("lists every archived item as a single-select radio target", () => {
    renderPage();
    const group = screen.getByRole("radiogroup", { name: "Training target" });
    expect(group).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Train Home pose" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Train Wave" }),
    ).toBeInTheDocument();
  });

  it("selects exactly one target and labels the train button with it", () => {
    const onDemoChange = vi.fn();
    renderPage({ onDemoChange, selectedDemoId: "gesture-1" });
    expect(screen.getByRole("radio", { name: "Train Wave" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Train Home pose" }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Train Home pose" }));
    expect(onDemoChange).toHaveBeenCalledWith("demo-1");
    expect(screen.getByRole("button", { name: "Train “Wave”" })).toBeEnabled();
  });

  it("blocks training until a target is selected", () => {
    renderPage({ sessionId: "session-1" });
    expect(
      screen.getByRole("button", { name: "Select a training target" }),
    ).toBeDisabled();
  });
});
