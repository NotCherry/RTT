import type { Dataset, Demonstration, ExperimentRecord } from "@/types";

const ARCHIVE_STORAGE_PREFIX = "robot-learning-workbench:archive:v1";

export type BrowserArchive = {
  demonstrations: Demonstration[];
  datasets: Dataset[];
  activeDatasetId: string | null;
  experiments: ExperimentRecord[];
};

// Access to the localStorage property itself can throw under browser policy.
export const browserStorage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
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

function isExperimentRecord(value: unknown): value is ExperimentRecord {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ExperimentRecord>;
  return (
    item.version === 1 &&
    typeof item.id === "string" &&
    typeof item.demonstration_id === "string" &&
    typeof item.demonstration_name === "string" &&
    typeof item.created_at === "string" &&
    typeof item.best_trial === "number" &&
    item.experiment?.version === 1 &&
    item.experiment.strategy === "quick" &&
    typeof item.experiment.trials === "number" &&
    typeof item.experiment.trial_epochs === "number" &&
    item.experiment.score_name === "checkpoint_fidelity" &&
    item.experiment.score_version === 1 &&
    Array.isArray(item.results) &&
    item.results.every(
      (result) =>
        result.score_name === "checkpoint_fidelity" &&
        result.score_version === 1 &&
        typeof result.trial === "number" &&
        typeof result.score === "number" &&
        (result.score_basis === "checkpoint_mae" || result.score_basis === "training_loss") &&
        typeof result.reproduction_error === "number" &&
        typeof result.simultaneity_penalty === "number" &&
        typeof result.loss === "number" &&
        typeof result.simultaneity === "number" &&
        Boolean(result.config) &&
        Array.isArray(result.config.hidden_layers) &&
        typeof result.config.activation === "string" &&
        typeof result.config.learning_rate === "number" &&
        typeof result.config.epochs === "number" &&
        typeof result.config.batch_size === "number" &&
        typeof result.config.timestep_ms === "number" &&
        typeof result.config.random_starts === "number" &&
        typeof result.config.random_seed === "number" &&
        typeof result.config.rollout_steps === "number",
    )
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
    (candidate.experiments === undefined || Array.isArray(candidate.experiments)) &&
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
    return isBrowserArchive(parsed)
      ? {
          ...parsed,
          experiments: (parsed.experiments ?? []).filter(isExperimentRecord),
        }
      : null;
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
