import type { Dataset, Demonstration } from "@/types";

const ARCHIVE_STORAGE_PREFIX = "robot-learning-workbench:archive:v1";

export type BrowserArchive = {
  demonstrations: Demonstration[];
  datasets: Dataset[];
  activeDatasetId: string | null;
};

function storageKey(robotId: string) {
  return `${ARCHIVE_STORAGE_PREFIX}:${robotId}`;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function isDemonstration(value: unknown): value is Demonstration {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Demonstration>;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    (item.kind === "pose" || item.kind === "gesture") &&
    isNumberArray(item.current) &&
    isNumberArray(item.target) &&
    Array.isArray(item.frames) &&
    item.frames.every(
      (frame) =>
        frame &&
        typeof frame === "object" &&
        typeof frame.timestamp === "number" &&
        isNumberArray(frame.positions),
    )
  );
}

function isDataset(value: unknown): value is Dataset {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Dataset>;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    Array.isArray(item.demonstration_ids) &&
    item.demonstration_ids.every((id) => typeof id === "string") &&
    typeof item.created_at === "string" &&
    typeof item.updated_at === "string"
  );
}

function isBrowserArchive(value: unknown): value is BrowserArchive {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BrowserArchive>;
  return (
    Array.isArray(candidate.demonstrations) &&
    candidate.demonstrations.every(isDemonstration) &&
    Array.isArray(candidate.datasets) &&
    candidate.datasets.every(isDataset) &&
    (candidate.activeDatasetId === null ||
      typeof candidate.activeDatasetId === "string")
  );
}

export function loadBrowserArchive(
  storage: Pick<Storage, "getItem">,
  robotId: string,
): BrowserArchive | null {
  try {
    const serialized = storage.getItem(storageKey(robotId));
    if (!serialized) return null;
    const parsed: unknown = JSON.parse(serialized);
    return isBrowserArchive(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveBrowserArchive(
  storage: Pick<Storage, "setItem">,
  robotId: string,
  archive: BrowserArchive,
) {
  try {
    storage.setItem(storageKey(robotId), JSON.stringify(archive));
    return true;
  } catch {
    return false;
  }
}
