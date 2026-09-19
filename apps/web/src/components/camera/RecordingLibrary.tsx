import type { ComponentProps } from "react";
import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { H3 } from "@/components/ui/typography";
import type { CameraRecording, CameraRecordingSummary } from "@/domain/cameraArchive";
import { RecordingPlayer } from "./RecordingPlayer";
type Props = Omit<ComponentProps<typeof RecordingPlayer>, "recording"> & {
  recordings: CameraRecordingSummary[];
  selected: CameraRecording | null;
  locked: boolean;
  extracting: boolean;
  progress: number;
  onSelect: (id: string) => void;
  onExtract: () => void;
  onCancel: () => void;
  onSave: () => void;
  onRetry: () => void;
  onDelete: () => void;
};
export function RecordingLibrary({
  recordings,
  selected,
  locked,
  extracting,
  progress,
  robot,
  state,
  joints,
  neutral,
  profile,
  onPreview,
  onSelect,
  onExtract,
  onCancel,
  onSave,
  onRetry,
  onDelete,
}: Props) {
  return (
    <div className="camera-library">
      <Panel className="route-content-panel camera-library-panel">
        <PanelHeader>
          <div>
            <PanelLabel>ON THIS DEVICE</PanelLabel>
            <H3>Recordings</H3>
          </div>
        </PanelHeader>
        <div className="camera-recordings">
          {recordings.length ? (
            recordings.map((row) => (
              <Button
                key={row.id}
                variant={selected?.id === row.id ? "primary" : "secondary"}
                disabled={locked}
                onClick={() => onSelect(row.id)}
              >
                {row.name} · {row.created_at ? new Date(row.created_at).toLocaleString() : "Recovered"} ·{" "}
                {row.source.kind === "ip-image-stream" ? "IP" : "Local"} · {(row.duration_ms / 1000).toFixed(1)} s ·{" "}
                {row.processed ? `${row.frame_count} frames` : "Not processed"}
              </Button>
            ))
          ) : (
            <p className="helper-text">No saved recordings for this robot. Record a gesture in Live camera.</p>
          )}
        </div>
      </Panel>
      <Panel className="route-content-panel camera-library-panel">
        <PanelHeader>
          <div>
            <PanelLabel>INSPECT RECORDING</PanelLabel>
            <H3>{selected?.name ?? "Select a recording"}</H3>
          </div>
        </PanelHeader>
        {selected && (
          <RecordingPlayer
            key={`${selected.id}:${selected.frames.length}:${selected.sample_rate}`}
            recording={selected}
            robot={robot}
            state={state}
            joints={joints}
            neutral={neutral}
            profile={profile}
            onPreview={onPreview}
          />
        )}
        <div className="route-actions">
          <Button disabled={!selected?.video || locked} onClick={() => onExtract()}>
            {selected?.processed ? "Re-extract stick figure" : "Extract stick figure"}
          </Button>
          {extracting && <Button onClick={() => onCancel()}>Cancel extraction</Button>}
          <Button disabled={!selected?.frames.length || locked} onClick={() => onSave()}>
            Save robot gesture
          </Button>
          <Button variant="secondary" disabled={!selected || locked} onClick={() => onRetry()}>
            Retry saving recording
          </Button>
          <Button variant="secondary" disabled={!selected || locked} onClick={() => onDelete()}>
            Delete local recording
          </Button>
        </div>
        {extracting && <progress aria-label="Extraction progress" value={progress} max={100} />}
        {!selected?.video && (
          <p className="helper-text">
            Select a video recording to enable extraction. Saved landmarks can be replayed without video.
          </p>
        )}
      </Panel>
    </div>
  );
}
