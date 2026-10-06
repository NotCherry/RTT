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
  storageFailed?: boolean;
  canSave?: boolean;
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
  storageFailed = false,
  canSave = true,
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
                variant="secondary"
                aria-pressed={selected?.id === row.id}
                className={`h-auto w-full flex-col items-start gap-1 whitespace-normal text-left ${selected?.id === row.id ? "bg-accent-deep ring-1 ring-accent-500" : ""}`}
                disabled={locked}
                onClick={() => onSelect(row.id)}
              >
                <span className="camera-recording-title">{row.name}</span>
                <span className="camera-recording-meta">{(row.duration_ms / 1000).toFixed(1)} s · {row.source.kind === "ip-image-stream" ? "IP" : "Local"} camera</span>
                <span className="camera-recording-meta">{row.created_at ? new Date(row.created_at).toLocaleString() : "Recovered"}</span>
                <span className="camera-recording-quality">{row.processed ? row.frame_count ? `${row.frame_count} extracted frames` : "No confident pose" : "Ready to extract"}</span>
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
            key={selected.id}
            recording={selected}
            robot={robot}
            state={state}
            joints={joints}
            neutral={neutral}
            profile={profile}
            onPreview={onPreview}
            locked={locked}
          />
        )}
        {selected && <div className="camera-recording-summary">
          <p className="helper-text">{storageFailed ? "Available in this session. Saving on this device failed." : "Local recording · saved on this device"}</p>
          {selected.processed && <p className="helper-text">{selected.frames.length} accepted frames · {selected.rejected_frames ?? 0} rejected frames</p>}
        </div>}
        {selected?.frames.length && !canSave ? <p className="helper-text">No joints can be mapped. Choose a compatible robot or re-extract with your shoulders and hips visible.</p> : null}
        <div className="route-actions">
          <Button disabled={!selected?.video || locked} onClick={() => onExtract()}>
            {selected?.processed ? "Re-extract stick figure" : "Extract stick figure"}
          </Button>
          {extracting && <Button onClick={() => onCancel()}>Cancel extraction</Button>}
          <Button disabled={!selected?.frames.length || !canSave || locked} onClick={() => onSave()}>
            Save robot gesture
          </Button>
          {storageFailed && <Button variant="secondary" disabled={!selected || locked} onClick={() => onRetry()}>
            Retry saving recording
          </Button>}
          <Button variant="secondary" disabled={!selected || locked} onClick={() => onDelete()}>
            Delete local recording
          </Button>
        </div>
        {extracting && <div className="camera-processing-progress"><label>Extracting stick figure · {Math.round(progress)}%<progress aria-label="Extraction progress" value={progress} max={100} /></label></div>}
        {!selected?.video && (
          <p className="helper-text">
            Select a video recording to enable extraction. Saved landmarks can be replayed without video.
          </p>
        )}
      </Panel>
    </div>
  );
}
