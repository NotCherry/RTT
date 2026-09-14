// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
        metric={null}
        busy={false}
        training={false}
        trained={false}
        optimizing={false}
        optimizationResults={[]}
        optimizationStatus="idle"
        sessionId="session-1"
        onDatasetChange={() => {}}
        onDemoChange={() => {}}
        onConfigChange={() => {}}
        onModelSpecChange={() => {}}
        onTrain={() => {}}
        onOptimize={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("TrainingPage single-target picker", () => {
  it("allows a numeric setting to be cleared before entering a replacement", async () => {
    const onConfigChange = vi.fn();
    renderPage({ onConfigChange });
    await userEvent.click(screen.getByRole("tab", { name: "3 Optimize" }));

    const input = screen.getByRole("spinbutton", {
      name: "Final training epochs",
    });
    fireEvent.change(input, { target: { value: "" } });

    expect(input).toHaveValue(null);
    expect(onConfigChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "800" } });
    expect(onConfigChange).toHaveBeenCalledWith("epochs", "800");
  });

  it("forwards the exact epoch value entered by the user", async () => {
    const onConfigChange = vi.fn();
    renderPage({ onConfigChange });

    await userEvent.click(screen.getByRole("tab", { name: "3 Optimize" }));

    fireEvent.change(screen.getByRole("spinbutton", { name: "Final training epochs" }), {
      target: { value: "800" },
    });

    expect(onConfigChange).toHaveBeenCalledWith("epochs", "800");
  });

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

  it("edits the MLP as readable blocks", async () => {
    const onModelSpecChange = vi.fn();
    renderPage({ onModelSpecChange });

    await userEvent.click(screen.getByRole("tab", { name: "2 Network" }));
    expect(screen.getByLabelText("Model block stack")).toHaveTextContent(
      "Robot state history",
    );
    expect(screen.getAllByRole("spinbutton", { name: "Dense width" })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "+ Dense block" }));

    expect(onModelSpecChange).toHaveBeenCalledWith(
      expect.objectContaining({
        family: "mlp",
        blocks: expect.arrayContaining([
          expect.objectContaining({ width: 64, activation: "relu" }),
        ]),
      }),
    );
  });

  it("starts a bounded quick search with visible defaults", async () => {
    const onOptimize = vi.fn();
    renderPage({ selectedDemoId: "gesture-1", onOptimize });

    await userEvent.click(screen.getByRole("tab", { name: "3 Optimize" }));
    fireEvent.click(screen.getByRole("button", { name: "Search 6 candidates" }));

    expect(onOptimize).toHaveBeenCalledWith(6, 30);
    expect(screen.getByText("1 worker")).toBeInTheDocument();
  });

  it("does not describe an in-progress candidate as promoted", async () => {
    renderPage({
      optimizing: true,
      optimizationStatus: "running",
      optimizationResults: [{
        trial: 1,
        score: 0.02,
        score_name: "checkpoint_fidelity",
        score_version: 1,
        score_basis: "training_loss",
        reproduction_error: 0.02,
        simultaneity_penalty: 0,
        loss: 0.01,
        simultaneity: 1,
        config: {
          hidden_layers: [64], activation: "relu", learning_rate: 0.003,
          epochs: 5, batch_size: 16, timestep_ms: 120, random_starts: 0,
          random_seed: 7, rollout_steps: 160,
        },
      }],
    });

    await userEvent.click(screen.getByRole("tab", { name: "4 Results" }));

    expect(screen.getByText("Current best loss")).toBeInTheDocument();
    expect(screen.queryByText("Promoted loss")).not.toBeInTheDocument();
  });

  it("labels restored results as historical rather than promoted", async () => {
    renderPage({
      optimizationStatus: "historical",
      optimizationResults: [{
        trial: 1, score: 0.02, score_name: "checkpoint_fidelity", score_version: 1,
        score_basis: "training_loss", reproduction_error: 0.02,
        simultaneity_penalty: 0, loss: 0.01, simultaneity: 1,
        config: {
          hidden_layers: [64], activation: "relu", learning_rate: 0.003,
          epochs: 5, batch_size: 16, timestep_ms: 120, random_starts: 0,
          random_seed: 7, rollout_steps: 160,
        },
      }],
    });

    await userEvent.click(screen.getByRole("tab", { name: "4 Results" }));
    expect(screen.getByText("Previous experiment best")).toBeInTheDocument();
  });

  it("selects exactly one target and labels the train button with it", async () => {
    const onDemoChange = vi.fn();
    renderPage({ onDemoChange, selectedDemoId: "gesture-1" });
    expect(screen.getByRole("radio", { name: "Train Wave" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Train Home pose" }),
    ).not.toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Train Home pose" }));
    expect(onDemoChange).toHaveBeenCalledWith("demo-1");
    await userEvent.click(screen.getByRole("tab", { name: "3 Optimize" }));
    expect(screen.getByRole("button", { name: "Train “Wave”" })).toBeEnabled();
  });

  it("blocks training until a target is selected", async () => {
    renderPage({ sessionId: "session-1" });
    await userEvent.click(screen.getByRole("tab", { name: "3 Optimize" }));
    expect(
      screen.getByRole("button", { name: "Select a training target" }),
    ).toBeDisabled();
  });
});
