import { Link } from "react-router-dom";
import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { H2, H3, IntroCopy, Kicker } from "@/components/ui/typography";
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
          <Kicker>ARCHIVE / DATASETS</Kicker>
          <H2>Organize expected behavior.</H2>
          <IntroCopy>
            Keep poses and authored gestures grouped by robot and training
            purpose.
          </IntroCopy>
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
              <H3>{demonstrations.length} captured items</H3>
            </div>
            <Button variant="secondary" size="small" asChild>
              <Link to="/teach/pose">New pose</Link>
            </Button>
          </PanelHeader>
          <div className="archive-route-list">
            {demonstrations.length ? (
              demonstrations.map((demonstration) => (
                <article className="archive-route-card" key={demonstration.id}>
                  <div>
                    <strong>{demonstration.name}</strong>
                    <span>
                      {demonstration.kind} ·{" "}
                      {demonstration.keyframes?.length ??
                        demonstration.frames.length}{" "}
                      authored keyframes
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
                      <Button variant="secondary" size="small" asChild>
                        <Link
                          to="/teach/timeline"
                          onClick={() => onSelectDemo(demonstration.id)}
                        >
                          Edit timeline
                        </Link>
                      </Button>
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
