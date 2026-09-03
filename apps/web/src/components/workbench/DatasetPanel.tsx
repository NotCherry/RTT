import { Button } from "@/components/ui";
import { Separator } from "@/components/ui/separator";
import type { Dataset, Demonstration } from "@/types";

type DatasetPanelProps = {
  datasets: Dataset[];
  activeDatasetId: string | null;
  demonstrations: Demonstration[];
  onSelect: (datasetId: string) => void;
  onCreate: () => void;
  onRename: (datasetId: string, name: string) => void;
  onMoveDemonstration: (demonstrationId: string, datasetId: string) => void;
};

export function DatasetPanel({
  datasets,
  activeDatasetId,
  demonstrations,
  onSelect,
  onCreate,
  onRename,
  onMoveDemonstration,
}: DatasetPanelProps) {
  return (
    <div className="datasets-panel">
      <div className="demo-toolbar">
        <div>
          <p className="panel-label">ROBOT DATASETS</p>
          <strong>
            {datasets.length} saved dataset{datasets.length === 1 ? "" : "s"}
          </strong>
        </div>
        <Button variant="primary" size="small" onClick={onCreate}>
          New dataset
        </Button>
      </div>
      <p className="helper-text">
        Datasets organize the current robot&apos;s captured poses and gestures. The active dataset receives new
        demonstrations.
      </p>
      <Separator className="my-3" />
      {datasets.length ? (
        <div className="dataset-list">
          {datasets.map((dataset) => (
            <article className={`dataset-card ${dataset.id === activeDatasetId ? "selected" : ""}`} key={dataset.id}>
              <button className="dataset-select" onClick={() => onSelect(dataset.id)}>
                <span className="panel-label">{dataset.id === activeDatasetId ? "ACTIVE DATASET" : "DATASET"}</span>
                <strong>{dataset.name}</strong>
                <small>{dataset.demonstration_ids.length} demonstrations</small>
              </button>
              <input
                aria-label={`Rename ${dataset.name}`}
                value={dataset.name}
                onChange={(event) => onRename(dataset.id, event.target.value)}
              />
            </article>
          ))}
        </div>
      ) : (
        <div className="demo-empty">
          <strong>No datasets yet</strong>
          <span>Create one before capturing a demonstration.</span>
        </div>
      )}
      {demonstrations.length > 0 && datasets.length > 0 && (
        <div className="dataset-members">
          <p className="panel-label">DEMONSTRATION MEMBERSHIP</p>
          {demonstrations.map((demonstration) => {
            const memberDataset = datasets.find((dataset) => dataset.demonstration_ids.includes(demonstration.id));
            return (
              <label key={demonstration.id}>
                <span>{demonstration.name}</span>
                <select
                  aria-label={`Dataset for ${demonstration.name}`}
                  value={memberDataset?.id ?? ""}
                  onChange={(event) => onMoveDemonstration(demonstration.id, event.target.value)}
                >
                  <option value="" disabled>
                    Select dataset
                  </option>
                  {datasets.map((dataset) => (
                    <option value={dataset.id} key={dataset.id}>
                      {dataset.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      )}
      <Separator className="my-3" />
      <div className="training-summary">
        <div>
          <span>Current archive</span>
          <strong>{demonstrations.length}</strong>
        </div>
        <div>
          <span>Robot scope</span>
          <strong>1</strong>
        </div>
      </div>
    </div>
  );
}
