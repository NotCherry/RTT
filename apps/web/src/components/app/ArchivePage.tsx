import { Link } from "react-router-dom";
import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { DatasetPanel } from "@/components/workbench/DatasetPanel";
import type { Dataset, Demonstration } from "@/types";

type ArchivePageProps = {
  demonstrations: Demonstration[];
  datasets: Dataset[];
  activeDatasetId: string | null;
  onSelectDataset: (id: string) => void;
  onCreateDataset: () => void;
  onRenameDataset: (id: string, name: string) => void;
  onMoveDemonstration: (demoId: string, datasetId: string) => void;
  onPreview: (demo: Demonstration) => void;
  onSelectDemo: (id: string) => void;
};

export function ArchivePage({
  demonstrations,
  datasets,
  activeDatasetId,
  onSelectDataset,
  onCreateDataset,
  onRenameDataset,
  onMoveDemonstration,
  onPreview,
  onSelectDemo,
}: ArchivePageProps) {
  return (
    <div className="route-page">
      <div className="route-heading">
        <div>
          <p className="kicker">ARCHIVE / DATASETS</p>
          <h2>Organize expected behavior.</h2>
          <p className="intro-copy">Keep poses and authored gestures grouped by robot and training purpose.</p>
        </div>
      </div>
      <div className="route-archive-grid">
        <Panel className="route-content-panel">
          <DatasetPanel
            datasets={datasets}
            activeDatasetId={activeDatasetId}
            demonstrations={demonstrations}
            onSelect={onSelectDataset}
            onCreate={onCreateDataset}
            onRename={onRenameDataset}
            onMoveDemonstration={onMoveDemonstration}
          />
        </Panel>
        <Panel className="route-content-panel archive-demo-panel">
          <PanelHeader>
            <div>
              <PanelLabel>DEMONSTRATIONS</PanelLabel>
              <h3>{demonstrations.length} captured items</h3>
            </div>
            <Link className="button secondary small" to="/teach/pose">
              New pose
            </Link>
          </PanelHeader>
          <div className="archive-route-list">
            {demonstrations.length ? (
              demonstrations.map((demonstration) => (
                <article className="archive-route-card" key={demonstration.id}>
                  <div>
                    <strong>{demonstration.name}</strong>
                    <span>
                      {demonstration.kind} · {demonstration.keyframes?.length ?? demonstration.frames.length} authored
                      keyframes
                    </span>
                  </div>
                  <div className="demo-card-actions">
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={() => {
                        onSelectDemo(demonstration.id);
                        onPreview(demonstration);
                      }}
                    >
                      Preview
                    </Button>
                    {demonstration.kind === "gesture" && (
                      <Link
                        className="button secondary small"
                        to="/teach/timeline"
                        onClick={() => onSelectDemo(demonstration.id)}
                      >
                        Edit timeline
                      </Link>
                    )}
                  </div>
                </article>
              ))
            ) : (
              <div className="demo-empty">
                <strong>No demonstrations yet</strong>
                <span>Capture a pose or author a gesture timeline.</span>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
