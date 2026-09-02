import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { PanelLabel } from "@/components/ui";
import { Empty, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import {
  frameToTimestamp,
  parseJointInput,
  timestampToFrame,
} from "@/domain/timeline";
import type { DemonstrationFrame, Joint } from "@/types";

type TimelinePanelProps = {
  frames: DemonstrationFrame[];
  joints: Joint[];
  recording: boolean;
  fps: number;
  selectedFrameIndex: number;
  playheadFrame: number;
  editorPositions: number[];
  dirty: boolean;
  hasSelection: boolean;
  onCapture: (targetFrame?: number) => void;
  onTargetFrame: (frame: number) => void;
  onSelectFrame: (index: number) => void;
  onScrubFrame: (frame: number) => void;
  onUpdateFrame: (
    frameIndex: number,
    jointIndex: number,
    value: number,
  ) => void;
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
  fps,
  selectedFrameIndex,
  playheadFrame,
  editorPositions,
  dirty,
  hasSelection,
  onCapture,
  onTargetFrame,
  onSelectFrame,
  onScrubFrame,
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
  const msPerFrame = 1000 / fps;
  const lastFrameInt = frames.length
    ? timestampToFrame(frames[frames.length - 1].timestamp, fps)
    : 0;
  const durationFrames = Math.max(60, lastFrameInt + 12);
  const selected = frames[selectedFrameIndex];
  const selectedFrameInt = selected
    ? timestampToFrame(selected.timestamp, fps)
    : 0;
  const displayedPositions = editorPositions.length
    ? editorPositions
    : (selected?.positions ?? []);
  const markerPosition = (timestamp: number) => {
    const frame = timestampToFrame(timestamp, fps);
    return `${Math.min(100, Math.max(0, (frame / Math.max(durationFrames, 1)) * 100))}%`;
  };
  const [playing, setPlaying] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [frameInput, setFrameInput] = useState(String(selectedFrameInt));
  const playRef = useRef<number | null>(null);

  useEffect(() => {
    setFrameInput(String(selectedFrameInt));
    setValidationError(null);
  }, [selectedFrameIndex, selectedFrameInt]);

  const updateJointValue = (jointIndex: number, rawValue: string) => {
    const joint = joints[jointIndex];
    const value = parseJointInput(rawValue, joint);
    if (value === null) {
      setValidationError(
        `Enter a value between ${joint.lower} and ${joint.upper} for ${joint.name}.`,
      );
      return;
    }
    setValidationError(null);
    onUpdateFrame(selectedFrameIndex, jointIndex, value);
  };

  const updateFrameNumber = (rawValue: string) => {
    setFrameInput(rawValue);
    const value = Number(rawValue);
    if (!rawValue.trim() || !Number.isInteger(value) || value < 0) {
      setValidationError("Enter a non-negative whole-number frame.");
      return;
    }
    setValidationError(null);
    onTargetFrame(value);
  };

  const insertAtFrame = () => {
    const value = Number(frameInput);
    if (!frameInput.trim() || !Number.isInteger(value) || value < 0) {
      setValidationError("Enter a non-negative whole-number frame.");
      return;
    }
    setValidationError(null);
    onCapture(Math.round(value));
  };

  const updateTimestamp = (rawValue: string) => {
    const value = Number(rawValue);
    if (!rawValue.trim() || !Number.isFinite(value) || value < 0) {
      setValidationError("Enter a non-negative timestamp in milliseconds.");
      return;
    }
    setValidationError(null);
    onUpdateTimestamp(selectedFrameIndex, value);
  };

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
          <EmptyDescription>
            Select a gesture in Archive or start a new capture.
          </EmptyDescription>
          <Button
            variant="secondary"
            size="small"
            onClick={onStartRecording}
            disabled={!joints.length}
          >
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
          <Button
            variant="primary"
            size="small"
            onClick={insertAtFrame}
            disabled={!joints.length || Boolean(validationError)}
          >
            Insert full-pose key
          </Button>
        </div>
      </div>
      <p className="helper-text">
        Isolated draft: pose sliders stay independent. Save publishes to archive
        for training. Diamonds are authored keys — playback is derived. Insert
        writes the full pose at the entered frame ({fps} fps); recording uses
        elapsed capture time.
      </p>
      {dirty && !recording && (
        <div className="edit-banner">
          <span>
            Unsaved timeline edits — training uses last saved version.
          </span>
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
              max={durationFrames}
              value={Math.min(playheadFrame, durationFrames)}
              aria-label="Scrub keyframes"
              onChange={(e) => onScrubFrame(Number(e.target.value))}
            />
            <Button
              variant="secondary"
              size="small"
              onClick={() => setPlaying((v) => !v)}
              disabled={frames.length < 2}
            >
              {playing ? "Pause" : "Play"}
            </Button>
            <span className="scrub-label">
              Frame {playheadFrame} / {durationFrames} · Key{" "}
              {selectedFrameIndex + 1} / {frames.length} ·{" "}
              {Math.round(frameToTimestamp(playheadFrame, fps))} ms
            </span>
          </div>
          <div
            className="animation-ruler animation-scrubber"
            onClick={(e) => {
              const rect = (
                e.currentTarget as HTMLDivElement
              ).getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              const targetFrame = Math.round(pct * durationFrames);
              onScrubFrame(targetFrame);
            }}
          >
            {Array.from(
              { length: Math.ceil(durationFrames / 12) + 1 },
              (_, index) => (
                <span
                  key={index}
                  style={{ left: `${((index * 12) / durationFrames) * 100}%` }}
                >
                  {index * 12}
                </span>
              ),
            )}
            <i
              className="animation-playhead"
              style={{
                left: markerPosition(frameToTimestamp(playheadFrame, fps)),
              }}
            />
          </div>
          <div
            className="animation-channels"
            role="list"
            aria-label="Robot animation channels"
          >
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
                      aria-label={`Keyframe ${frameIndex + 1} at frame ${timestampToFrame(frame.timestamp, fps)} for ${joint.name}`}
                      key={`${frameIndex}-${timestampToFrame(frame.timestamp, fps)}`}
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
                  <PanelLabel>
                    {playheadFrame === selectedFrameInt
                      ? "SELECTED KEYFRAME"
                      : "PLAYHEAD POSE"}
                  </PanelLabel>
                  <strong>
                    Frame {playheadFrame} ·{" "}
                    {Math.round(frameToTimestamp(playheadFrame, fps))} ms ·{" "}
                    {msPerFrame.toFixed(1)} ms/frame
                  </strong>
                </div>
                <label>
                  <span>Frame</span>
                  <input
                    aria-label="Selected keyframe frame"
                    type="number"
                    min="0"
                    step="1"
                    value={frameInput}
                    onChange={(event) => updateFrameNumber(event.target.value)}
                  />
                </label>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => onDuplicateFrame(selectedFrameIndex)}
                >
                  Duplicate
                </Button>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => onDeleteFrame(selectedFrameIndex)}
                  disabled={frames.length <= 1}
                >
                  Delete key
                </Button>
              </div>
              <div className="timeline-joint-grid">
                {joints.map((joint, jointIndex) => {
                  const value = displayedPositions[jointIndex] ?? 0;
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
                          onChange={(event) =>
                            updateJointValue(jointIndex, event.target.value)
                          }
                        />
                        <input
                          aria-label={`${joint.name} at selected keyframe`}
                          type="number"
                          min={joint.lower}
                          max={joint.upper}
                          step="0.001"
                          value={value}
                          onChange={(event) =>
                            updateJointValue(jointIndex, event.target.value)
                          }
                        />
                      </div>
                    </label>
                  );
                })}
              </div>
              {validationError && (
                <p className="helper-text" role="alert">
                  {validationError}
                </p>
              )}
              <p className="helper-text" style={{ paddingLeft: 0 }}>
                Slider + number per joint — edits apply to the selected
                keyframe, or to the staged pose when the frame field above
                targets a new frame. Insert commits the staged pose at that
                frame.
              </p>
            </div>
          ) : (
            <Empty>
              <EmptyTitle>No keyframes yet</EmptyTitle>
              <EmptyDescription>
                Insert a full-pose keyframe to start the animation.
              </EmptyDescription>
            </Empty>
          )}
        </>
      ) : (
        <Empty>
          <EmptyTitle>No authored keyframes yet</EmptyTitle>
          <EmptyDescription>
            Start capture, then insert full-pose keys at meaningful moments.
            Each key stores the full pose, not a delta.
          </EmptyDescription>
        </Empty>
      )}
    </div>
  );
}
