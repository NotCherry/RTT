import type { BrowserArchive } from "./browserArchive";

/** Demonstration.dataset_id is canonical; dataset member lists are derived. */
export function normalizeArchive(archive: BrowserArchive): BrowserArchive {
  const ids = new Set(archive.datasets.map((dataset) => dataset.id));
  const demonstrations = archive.demonstrations.map((demo) => ({
    ...demo,
    dataset_id: demo.dataset_id && ids.has(demo.dataset_id)
      ? demo.dataset_id
      : undefined,
  }));
  return {
    demonstrations,
    datasets: archive.datasets.map((dataset) => ({
      ...dataset,
      demonstration_ids: demonstrations
        .filter((demo) => demo.dataset_id === dataset.id)
        .map((demo) => demo.id),
    })),
    activeDatasetId: archive.activeDatasetId && ids.has(archive.activeDatasetId)
      ? archive.activeDatasetId
      : null,
  };
}

/** Preserve request order across edits as well as within each archive write. */
export function createArchiveSync(
  saveDemonstrations: (sessionId: string, demonstrations: BrowserArchive["demonstrations"]) => Promise<unknown>,
  saveDatasets: (sessionId: string, datasets: BrowserArchive["datasets"]) => Promise<unknown>,
) {
  let pending: Promise<unknown> = Promise.resolve();
  return (sessionId: string, archive: BrowserArchive) => {
    const next = pending.catch(() => {}).then(async () => {
      await saveDemonstrations(sessionId, archive.demonstrations);
      await saveDatasets(sessionId, archive.datasets);
    });
    pending = next;
    return next;
  };
}
