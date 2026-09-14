import { describe, expect, it } from "vitest";
import type { Dataset, Demonstration, ExperimentRecord } from "@/types";
import { loadBrowserArchive, saveBrowserArchive } from "./browserArchive";

const demonstration: Demonstration = {
  id: "gesture-1",
  name: "Wave",
  kind: "gesture",
  current: [0],
  target: [1],
  frames: [
    { timestamp: 0, positions: [0] },
    { timestamp: 120, positions: [1] },
  ],
};

const dataset: Dataset = {
  id: "dataset-1",
  name: "Greeting gestures",
  demonstration_ids: [demonstration.id],
  created_at: "2026-09-12T00:00:00.000Z",
  updated_at: "2026-09-12T00:00:00.000Z",
};

const experiment: ExperimentRecord = {
  id: "experiment-1",
  version: 1,
  demonstration_id: demonstration.id,
  demonstration_name: demonstration.name,
  created_at: "2026-09-14T09:00:00.000Z",
  experiment: {
    version: 1,
    strategy: "quick",
    trials: 2,
    trial_epochs: 5,
    score_name: "checkpoint_fidelity",
    score_version: 1,
  },
  best_trial: 1,
  results: [{
    trial: 1,
    score: 0.01,
    score_name: "checkpoint_fidelity",
    score_version: 1,
    score_basis: "training_loss",
    reproduction_error: 0.01,
    simultaneity_penalty: 0,
    loss: 0.01,
    simultaneity: 1,
    config: {
      hidden_layers: [64], activation: "relu", learning_rate: 0.003,
      epochs: 5, batch_size: 16, timestep_ms: 120, random_starts: 0,
      random_seed: 7, rollout_steps: 160,
    },
  }],
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("browser archive", () => {
  it("handles storage operations rejected by browser policy", () => {
    const blocked = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("SecurityError"); },
    };
    expect(loadBrowserArchive(blocked, "robot")).toBeNull();
    expect(saveBrowserArchive(blocked, "robot", { demonstrations: [], datasets: [], activeDatasetId: null, experiments: [] })).toBe(false);
  });
  it("preserves demonstrations, datasets, and the active dataset by robot", () => {
    const storage = memoryStorage();
    const archive = {
      demonstrations: [demonstration],
      datasets: [dataset],
      activeDatasetId: dataset.id,
      experiments: [experiment],
    };

    expect(saveBrowserArchive(storage, "sample-arm", archive)).toBe(true);
    expect(loadBrowserArchive(storage, "sample-arm")).toEqual(archive);
    expect(loadBrowserArchive(storage, "other-robot")).toBeNull();
  });

  it("migrates an older archive to an empty experiment history", () => {
    const storage = memoryStorage();
    storage.setItem("robot-learning-workbench:archive:v1:sample-arm", JSON.stringify({
      demonstrations: [demonstration],
      datasets: [dataset],
      activeDatasetId: dataset.id,
    }));

    expect(loadBrowserArchive(storage, "sample-arm")?.experiments).toEqual([]);
  });

  it("ignores corrupt or incompatible saved data", () => {
    const broken = {
      getItem: () => "not json",
    };
    const incompatible = {
      getItem: () => JSON.stringify({ demonstrations: "invalid" }),
    };

    expect(loadBrowserArchive(broken, "sample-arm")).toBeNull();
    expect(loadBrowserArchive(incompatible, "sample-arm")).toBeNull();
  });

  it("drops unsupported or incomplete experiment records without losing the archive", () => {
    const storage = memoryStorage();
    const invalid = {
      demonstrations: [demonstration], datasets: [dataset],
      activeDatasetId: dataset.id,
      experiments: [{ ...experiment, experiment: { ...experiment.experiment, version: 2 } }],
    };
    storage.setItem("robot-learning-workbench:archive:v1:sample-arm", JSON.stringify(invalid));
    expect(loadBrowserArchive(storage, "sample-arm")?.experiments).toEqual([]);

    invalid.experiments = [{
      ...experiment,
      results: experiment.results.map(({ config: _config, ...result }) => result),
    }] as unknown as ExperimentRecord[];
    storage.setItem("robot-learning-workbench:archive:v1:sample-arm", JSON.stringify(invalid));
    expect(loadBrowserArchive(storage, "sample-arm")?.experiments).toEqual([]);
  });
});
