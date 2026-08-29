import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { PanelLabel } from "@/components/ui";
import { Empty, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import type { DemonstrationFrame, Joint } from "@/types";

type TimelinePanelProps = {
  frames: DemonstrationFrame[];
  joints: Joint[];
  recording: boolean;
  selectedFrameIndex: number;
  dirty: boolean;
  hasSelection: boolean;
  onCapture: () => void;
  onSelectFrame: (index: number) => void;
  onUpdateFrame: (frameIndex: number, jointIndex: number, value: number) => void;
  onUpdateTimestamp: (frameIndex: number, value: number) => void;
  onDeleteFrame: (index: number) => void;
  onDuplicateFrame: (index: number) => void;
  onPreviewFrame: (index: number) => void;
  onSave: () => void;
  onDiscard: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
};

export function TimelinePanel({
  frames,
  joints,
  recording,
  selectedFrameIndex,
  dirty,
  hasSelection,
  onCapture,
  onSelectFrame,
  onUpdateFrame,
  onUpdateTimestamp,
  onDeleteFrame,
  onDuplicateFrame,
  onPreviewFrame,
  onSave,
  onDiscard,
  onStartRecording,
  onStopRecording,
}: TimelinePanelProps) {
  const fps = 30;
  const lastFrame = frames[frames.length - 1]?.timestamp ?? 0;
  const durationFrames = Math.max(60, Math.ceil((lastFrame / 1000) * fps) + 12);
  const selected = frames[selectedFrameIndex];
  const markerPosition = (timestamp: number) =>
    `${Math.min(100, Math.max(0, (timestamp / Math.max(lastFrame, 1)) * 100))}%`;
  const [playing, setPlaying] = useState(false);
  const playRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing || !frames.length) return;
    let idx = selectedFrameIndex;
    const tick = () => {
      idx = (idx + 1) % frames.length;
      onSelectFrame(idx);
      onPreviewFrame(idx);
      playRef.current = window.setTimeout(tick, 240);
    };
    playRef.current = window.setTimeout(tick, 240);
    return () => {
      if (playRef.current !== null) window.clearTimeout(playRef.current);
    };
  }, [playing, frames, selectedFrameIndex, onSelectFrame, onPreviewFrame]);

  if (!hasSelection && !recording) {
    return (
      <div className="animation-editor">
        <Empty>
          <EmptyTitle>No gesture selected</EmptyTitle>
          <EmptyDescription>Select a gesture in Archive or start a new capture.</EmptyDescription>
          <Button variant="secondary" size="small" onClick={onStartRecording} disabled={!joints.length}>
            Start capture
          </Button>
        </Empty>
      </div>
    );
  }

  return (
    <div className="animation-editor">
      <div className="animation-toolbar">
        <div>
          <PanelLabel>KEYFRAME EDITOR · {fps} FPS</PanelLabel>
          <strong>
            {frames.length} authored keyframe{frames.length === 1 ? "" : "s"}
            {dirty && <em className="draft-badge"> · unsaved</em>}
          </strong>
        </div>
        <div className="demo-card-actions">
          {recording ? (
            <Button variant="recording" size="small" onClick={onStopRecording}>
              Stop capture
            </Button>
          ) : (
            <Button variant="secondary" size="small" onClick={onStartRecording}>
              Start capture
            </Button>
          )}
          <Button variant="primary" size="small" onClick={onCapture} disabled={!joints.length}>
            Insert full-pose key
          </Button>
        </div>
      </div>
      <p className="helper-text">
        Isolated draft: pose sliders stay independent. Save publishes to archive for training. Diamonds are authored
        keys — playback is derived.
      </p>
      {dirty && !recording && (
        <div className="edit-banner">
          <span>Unsaved timeline edits — training uses last saved version.</span>
          <div>
            <Button variant="ghost" size="small" onClick={onDiscard}>
              Discard
            </Button>
            <Button variant="primary" size="small" onClick={onSave}>
              Save keyframes
            </Button>
          </div>
        </div>
      )}
      {frames.length ? (
        <>
          <div className="timeline-scrub">
            <input
              type="range"
              min={0}
              max={Math.max(0, frames.length - 1)}
              value={selectedFrameIndex}
              aria-label="Scrub keyframes"
              onChange={(e) => {
                const idx = Number(e.target.value);
                onSelectFrame(idx);
                onPreviewFrame(idx);
              }}
            />
            <Button variant="secondary" size="small" onClick={() => setPlaying((v) => !v)} disabled={frames.length < 2}>
              {playing ? "Pause" : "Play"}
            </Button>
            <span className="scrub-label">
              {selectedFrameIndex + 1} / {frames.length}
            </span>
          </div>
          <div
            className="animation-ruler"
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              const targetTime = pct * Math.max(lastFrame, 1);
              let nearest = 0;
              let best = Infinity;
              frames.forEach((f, i) => {
                const d = Math.abs(f.timestamp - targetTime);
                if (d < best) {
                  best = d;
                  nearest = i;
                }
              });
              onSelectFrame(nearest);
              onPreviewFrame(nearest);
            }}
          >
            {Array.from({ length: Math.ceil(durationFrames / 12) + 1 }, (_, index) => (
              <span key={index} style={{ left: `${((index * 12) / durationFrames) * 100}%` }}>
                {index * 12}
              </span>
            ))}
            <i className="animation-playhead" style={{ left: markerPosition(selected?.timestamp ?? 0) }} />
          </div>
          <div className="animation-channels" role="list" aria-label="Robot animation channels">
            <div className="channel-row channel-header">
              <span>CHANNELS</span>
              <span>AUTHORED KEYFRAMES (click diamond to select)</span>
            </div>
            {joints.map((joint) => (
              <div className="channel-row" key={joint.name}>
                <span className="channel-name">
                  {joint.name}
                  <small>{joint.type}</small>
                </span>
                <div className="channel-track">
                  {frames.map((frame, frameIndex) => (
                    <button
                      className={`keyframe-diamond ${selectedFrameIndex === frameIndex ? "selected" : ""}`}
                      style={{ left: markerPosition(frame.timestamp) }}
                      aria-label={`Keyframe ${frameIndex + 1} for ${joint.name}`}
                      key={`${frameIndex}-${frame.timestamp}`}
                      onClick={() => {
                        onSelectFrame(frameIndex);
                        onPreviewFrame(frameIndex);
                      }}
                      type="button"
                    >
                      ◆
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Separator className="my-2" />
          {selected ? (
            <div className="keyframe-inspector">
              <div className="timeline-frame-header">
                <div>
                  <PanelLabel>SELECTED KEYFRAME</PanelLabel>
                  <strong>
                    Frame {Math.round((selected.timestamp / 1000) * fps)} · {Math.round(selected.timestamp)} ms
                  </strong>
                </div>
                <label>
                  <span>Frame time (ms)</span>
                  <input
                    aria-label="Selected keyframe time"
                    type="number"
                    min="0"
                    step="10"
                    value={Math.round(selected.timestamp)}
                    onChange={(event) => onUpdateTimestamp(selectedFrameIndex, Number(event.target.value))}
                  />
                </label>
                <Button variant="ghost" size="small" onClick={() => onDuplicateFrame(selectedFrameIndex)}>
                  Duplicate
                </Button>
                <Button variant="ghost" size="small" onClick={() => onDeleteFrame(selectedFrameIndex)} disabled={frames.length <= 1}>
                  Delete key
                </Button>
              </div>
              <div className="timeline-joint-grid">
                {joints.map((joint, jointIndex) => {
                  const value = selected.positions[jointIndex] ?? 0;
                  const updateValue = (nextValue: string) =>
                    onUpdateFrame(selectedFrameIndex, jointIndex, Number(nextValue));

                  return (
                    <label className="timeline-joint-control" key={joint.name}>
                      <span>{joint.name}</span>
                      <div className="timeline-joint-inputs">
                        <input
                          aria-label={`${joint.name} slider at selected keyframe`}
                          type="range"
                          min={joint.lower}
                          max={joint.upper}
                          step="0.001"
                          value={value}
                          onChange={(event) => updateValue(event.target.value)}
                        />
                        <input
                          aria-label={`${joint.name} at selected keyframe`}
                          type="number"
                          min={joint.lower}
                          max={joint.upper}
                          step="0.001"
                          value={value}
                          onChange={(event) => updateValue(event.target.value)}
                        />
                      </div>
                    </label>
                  );
                })}
              </div>
              <p className="helper-text" style={{ paddingLeft: 0 }}>
                Slider + number per joint — edits this keyframe only. Use Play/scrub to preview.
              </p>
            </div>
          ) : (
            <Empty>
              <EmptyTitle>No keyframes yet</EmptyTitle>
              <EmptyDescription>Insert a full-pose keyframe to start the animation.</EmptyDescription>
            </Empty>
          )}
        </>
      ) : (
        <Empty>
          <EmptyTitle>No authored keyframes yet</EmptyTitle>
          <EmptyDescription>
            Start capture, then insert full-pose keys at meaningful moments. Each key stores the full pose, not a delta.
          </EmptyDescription>
        </Empty>
      )}
    </div>
  );
}
