import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { PanelLabel } from "@/components/ui";
import { Empty, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { DraftNumberInput } from "@/components/ui/draft-number-input";
import {
  effectiveDurationFrames,
  frameToTimestamp,
  parseJointInput,
  timestampToFrame,
} from "@/domain/timeline";
import type { DemonstrationFrame, Joint } from "@/types";

type TimelinePanelProps = {
  frames: DemonstrationFrame[];
  joints: Joint[];
  fps: number;
  selectedFrameIndex: number;
  playheadFrame: number;
  durationFrames: number;
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
  onDeleteFrame: (index: number) => void;
  onDuplicateFrame: (index: number) => void;
  onPreviewFrame: (index: number) => void;
  onSave: () => void;
  onDiscard: () => void;
  onSaveAndNew?: () => void;
  onFpsChange: (fps: number) => void;
  onDurationChange: (durationFrames: number) => void;
};

export function TimelinePanel({
  frames,
  joints,
  fps,
  selectedFrameIndex,
  playheadFrame,
  durationFrames,
  editorPositions,
  dirty,
  hasSelection,
  onCapture,
  onTargetFrame,
  onSelectFrame,
  onScrubFrame,
  onUpdateFrame,
  onDeleteFrame,
  onDuplicateFrame,
  onPreviewFrame,
  onSave,
  onDiscard,
  onSaveAndNew,
  onFpsChange,
  onDurationChange,
}: TimelinePanelProps) {
  const msPerFrame = 1000 / fps;
  const effectiveDuration = effectiveDurationFrames(
    frames,
    durationFrames,
    fps,
  );
  const selected = frames[selectedFrameIndex];
  const selectedFrameInt = selected
    ? timestampToFrame(selected.timestamp, fps)
    : 0;
  const displayedPositions = editorPositions.length
    ? editorPositions
    : (selected?.positions ?? []);
  const markerPosition = (timestamp: number) => {
    const frame = timestampToFrame(timestamp, fps);
    return `${Math.min(100, Math.max(0, (frame / Math.max(effectiveDuration, 1)) * 100))}%`;
  };
  const [playing, setPlaying] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [frameInput, setFrameInput] = useState(String(playheadFrame));
  const [fpsInput, setFpsInput] = useState(String(fps));
  const [durationFramesInput, setDurationFramesInput] = useState(
    String(durationFrames),
  );
  const [durationSecondsInput, setDurationSecondsInput] = useState(
    (durationFrames / fps).toFixed(2),
  );

  useEffect(() => {
    setFrameInput(String(playheadFrame));
    setValidationError(null);
  }, [playheadFrame, selectedFrameIndex, selectedFrameInt]);

  useEffect(() => {
    setFpsInput(String(fps));
  }, [fps]);

  useEffect(() => {
    setDurationFramesInput(String(durationFrames));
    setDurationSecondsInput((durationFrames / fps).toFixed(2));
  }, [durationFrames, fps]);

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

  const commitFps = (raw: string) => {
    setFpsInput(raw);
    const v = Number(raw);
    if (!raw.trim() || !Number.isFinite(v) || v < 30 || v > 1000) {
      setValidationError("FPS must be 30–1000.");
      return;
    }
    setValidationError(null);
    onFpsChange(Math.round(v));
  };

  const commitDurationFrames = (raw: string) => {
    setDurationFramesInput(raw);
    const v = Number(raw);
    if (!raw.trim() || !Number.isInteger(v) || v < 1 || v > 10000) {
      setValidationError("Frames must be 1–10000.");
      return;
    }
    setValidationError(null);
    onDurationChange(v);
  };

  const commitDurationSeconds = (raw: string) => {
    setDurationSecondsInput(raw);
    const v = Number(raw);
    if (!raw.trim() || !Number.isFinite(v) || v <= 0 || v > 600) {
      setValidationError("Seconds must be >0 and ≤600.");
      return;
    }
    setValidationError(null);
    const frames = Math.max(1, Math.round(v * fps));
    setDurationFramesInput(String(frames));
    onDurationChange(frames);
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

  // Drive playhead advancement when playing
  useEffect(() => {
    if (!playing) return;
    const interval = Math.max(8, 1000 / fps);
    const id = window.setInterval(() => {
      // advance playhead by 1, wrap at duration
      const next = (playheadFrame + 1) % (effectiveDuration + 1);
      onScrubFrame(next);
      // Also preview interpolated pose: if no keyframe at next, App's scrub now interpolates
    }, interval);
    return () => window.clearInterval(id);
  }, [playing, fps, effectiveDuration, playheadFrame, onScrubFrame]);

  if (!hasSelection && !frames.length) {
    return (
      <div className="animation-editor">
        <Empty>
          <EmptyTitle>No gesture yet</EmptyTitle>
          <EmptyDescription>
            Set a duration and insert your first keyframe, or open a saved
            gesture.
          </EmptyDescription>
          <div className="flex gap-2 justify-center">
            <Button
              variant="primary"
              size="small"
              onClick={insertAtFrame}
              disabled={!joints.length}
            >
              Insert full-pose key
            </Button>
          </div>
        </Empty>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-[10px] text-text-500">
            FPS (30–1000)
            <input
              aria-label="FPS"
              type="number"
              min={30}
              max={1000}
              value={fpsInput}
              onChange={(e) => commitFps(e.target.value)}
              className="rounded border border-line-600 bg-ink-800 p-2 font-mono text-[11px] text-text-100 outline-none focus:border-accent-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-text-500">
            Duration (frames)
            <input
              aria-label="Duration frames"
              type="number"
              min={1}
              value={durationFramesInput}
              onChange={(e) => commitDurationFrames(e.target.value)}
              className="rounded border border-line-600 bg-ink-800 p-2 font-mono text-[11px] text-text-100 outline-none focus:border-accent-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-text-500">
            Duration (seconds)
            <input
              aria-label="Duration seconds"
              type="number"
              step="0.01"
              min={0.01}
              value={durationSecondsInput}
              onChange={(e) => commitDurationSeconds(e.target.value)}
              className="rounded border border-line-600 bg-ink-800 p-2 font-mono text-[11px] text-text-100 outline-none focus:border-accent-500"
            />
          </label>
        </div>
        {validationError && (
          <p className="helper-text" role="alert">
            {validationError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="animation-editor">
      <div className="animation-toolbar">
        <div>
          <PanelLabel>KEYFRAME EDITOR</PanelLabel>
          <strong>
            {frames.length} authored keyframe{frames.length === 1 ? "" : "s"}
            {dirty && <em className="draft-badge"> · unsaved</em>}
          </strong>
        </div>
        <div className="demo-card-actions items-center">
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

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-[10px] text-text-500">
          FPS (30–1000)
          <input
            aria-label="FPS"
            type="number"
            min={30}
            max={1000}
            step="1"
            value={fpsInput}
            onChange={(e) => commitFps(e.target.value)}
            className="rounded border border-line-600 bg-ink-800 p-2 font-mono text-[11px] text-text-100 outline-none focus:border-accent-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-text-500">
          Duration (frames)
          <input
            aria-label="Duration frames"
            type="number"
            min={1}
            max={10000}
            step="1"
            value={durationFramesInput}
            onChange={(e) => commitDurationFrames(e.target.value)}
            className="rounded border border-line-600 bg-ink-800 p-2 font-mono text-[11px] text-text-100 outline-none focus:border-accent-500"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-text-500">
          Duration (seconds)
          <input
            aria-label="Duration seconds"
            type="number"
            step="0.01"
            min={0.01}
            max={600}
            value={durationSecondsInput}
            onChange={(e) => commitDurationSeconds(e.target.value)}
            className="rounded border border-line-600 bg-ink-800 p-2 font-mono text-[11px] text-text-100 outline-none focus:border-accent-500"
          />
        </label>
      </div>

      <p className="helper-text">
        Declare length in seconds or frames (linked via FPS). Diamonds are
        authored keys — transient frames are interpolated for preview and
        training. Insert writes the full pose at the entered frame ({fps} fps).
      </p>
      <div className="edit-banner">
        <span>
          {dirty
            ? "Unsaved timeline edits — training uses last saved version."
            : "Timeline matches the last saved version."}
        </span>
        <div>
          <Button
            variant="ghost"
            size="small"
            onClick={onDiscard}
            disabled={!dirty}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            size="small"
            onClick={onSave}
            disabled={!dirty}
          >
            Save keyframes
          </Button>
          {onSaveAndNew && (
            <Button
              variant="secondary"
              size="small"
              onClick={onSaveAndNew}
              disabled={!hasSelection}
              title="Save this gesture and start a new one"
            >
              Save &amp; New
            </Button>
          )}
        </div>
      </div>
      {frames.length ? (
        <>
          <div className="timeline-scrub">
            <input
              type="range"
              min={0}
              max={effectiveDuration}
              value={Math.min(playheadFrame, effectiveDuration)}
              aria-label="Scrub keyframes"
              onChange={(e) => onScrubFrame(Number(e.target.value))}
            />
            <Button
              variant="secondary"
              size="small"
              onClick={() => setPlaying((v) => !v)}
              disabled={frames.length < 1}
            >
              {playing ? "Pause" : "Play"}
            </Button>
            <span className="scrub-label">
              Frame {playheadFrame} / {effectiveDuration} · Key{" "}
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
              const targetFrame = Math.round(pct * effectiveDuration);
              onScrubFrame(targetFrame);
            }}
          >
            {Array.from(
              { length: Math.ceil(effectiveDuration / 12) + 1 },
              (_, index) => (
                <span
                  key={index}
                  style={{
                    left: `${((index * 12) / effectiveDuration) * 100}%`,
                  }}
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
                    aria-label="Insert frame"
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
                        <DraftNumberInput
                          aria-label={`${joint.name} at selected keyframe`}
                          min={joint.lower}
                          max={joint.upper}
                          step="0.001"
                          value={value}
                          onValueChange={(nextValue) =>
                            updateJointValue(jointIndex, String(nextValue))
                          }
                          onInvalidValue={(rawValue) =>
                            updateJointValue(jointIndex, rawValue)
                          }
                          onDraftRestore={() => setValidationError(null)}
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
                keyframe, or to the staged pose while the playhead is between
                keys. The frame field follows the playhead (the insert target);
                Insert commits the staged pose at that frame.
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
            Insert a full-pose keyframe to start the animation.
          </EmptyDescription>
        </Empty>
      )}
    </div>
  );
}
