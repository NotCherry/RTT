import { describe, expect, it, vi } from "vitest";
import { createArchiveSync, normalizeArchive } from "./archive";
import type { BrowserArchive } from "./browserArchive";

const archive: BrowserArchive = {
  demonstrations: [{ id: "pose", name: "Pose", kind: "pose", current: [0], target: [1], frames: [], dataset_id: "a" }],
  datasets: ["a", "b"].map((id) => ({ id, name: id, demonstration_ids: ["pose"], created_at: "", updated_at: "" })),
  activeDatasetId: "b",
  experiments: [],
};

describe("archive invariants", () => {
  it("derives membership from demonstrations and removes deleted dataset links", () => {
    const normalized = normalizeArchive(archive);
    expect(normalized.datasets.map((dataset) => dataset.demonstration_ids)).toEqual([["pose"], []]);
    const deleted = normalizeArchive({ ...archive, datasets: [archive.datasets[1]] });
    expect(deleted.demonstrations[0].dataset_id).toBeUndefined();
    expect(deleted.datasets[0].demonstration_ids).toEqual([]);
    expect(normalizeArchive({ ...archive, activeDatasetId: null }).activeDatasetId).toBeNull();
  });

  it("serializes demonstrations before membership and before subsequent edits", async () => {
    const calls: string[] = [];
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const saveDemos = vi.fn(async () => { calls.push("demonstrations"); await gate; });
    const sync = createArchiveSync(saveDemos, async () => { calls.push("datasets"); });
    const first = sync("session", archive);
    const second = sync("session", archive);
    await vi.waitFor(() => expect(calls).toEqual(["demonstrations"]));
    finish();
    await Promise.all([first, second]);
    expect(calls).toEqual(["demonstrations", "datasets", "demonstrations", "datasets"]);
  });

  it("recovers after a failed save without sending dependent membership", async () => {
    const saveDemos = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const saveDatasets = vi.fn().mockResolvedValue(undefined);
    const sync = createArchiveSync(saveDemos, saveDatasets);
    await expect(sync("session", archive)).rejects.toThrow("offline");
    expect(saveDatasets).not.toHaveBeenCalled();
    await sync("session", archive);
    expect(saveDatasets).toHaveBeenCalledOnce();
  });
});
