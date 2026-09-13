import { describe, expect, it } from "vitest";
import type { Dataset, Demonstration } from "@/types";
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
    expect(saveBrowserArchive(blocked, "robot", { demonstrations: [], datasets: [], activeDatasetId: null })).toBe(false);
  });
  it("preserves demonstrations, datasets, and the active dataset by robot", () => {
    const storage = memoryStorage();
    const archive = {
      demonstrations: [demonstration],
      datasets: [dataset],
      activeDatasetId: dataset.id,
    };

    expect(saveBrowserArchive(storage, "sample-arm", archive)).toBe(true);
    expect(loadBrowserArchive(storage, "sample-arm")).toEqual(archive);
    expect(loadBrowserArchive(storage, "other-robot")).toBeNull();
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
});
