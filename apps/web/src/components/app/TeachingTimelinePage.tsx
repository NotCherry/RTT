import { Panel, PanelHeader, PanelLabel, StatusPill } from "@/components/ui";
import { H2, H3, IntroCopy, Kicker } from "@/components/ui/typography";
import { RobotViewport } from "@/components/workbench/RobotViewport";
import { TimelinePanel } from "@/components/workbench/TimelinePanel";
import type {
  DemonstrationFrame,
  Joint,
  Robot,
  SimulationState,
} from "@/types";

type TeachingTimelinePageProps = {
  robot: Robot | null;
  state: SimulationState | null;
  timelineFrames: DemonstrationFrame[];
  controllableJoints: Joint[];
  timelineFps: number;
  selectedFrameIndex: number;
  playheadFrame: number;
  durationFrames: number;
  editorPositions: number[];
  timelineDirty: boolean;
  hasSelection: boolean;
  onReset: () => void;
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
  gestureName: string;
  onRenameGesture: (name: string) => void;
  saveConfirmation: string | null;
  onSave: () => void;
  onDiscard: () => void;
  onSaveAndNew?: () => void;
  onFpsChange: (fps: number) => void;
  onDurationChange: (durationFrames: number) => void;
};

export function TeachingTimelinePage({
  robot,
  state,
  timelineFrames,
  controllableJoints,
  timelineFps,
  selectedFrameIndex,
  playheadFrame,
  durationFrames,
  editorPositions,
  timelineDirty,
  hasSelection,
  onReset,
  onCapture,
  onTargetFrame,
  onSelectFrame,
  onScrubFrame,
  onUpdateFrame,
  onDeleteFrame,
  onDuplicateFrame,
  onPreviewFrame,
  gestureName,
  onRenameGesture,
  saveConfirmation,
  onSave,
  onDiscard,
  onSaveAndNew,
  onFpsChange,
  onDurationChange,
}: TeachingTimelinePageProps) {
  return (
    <div className="route-page">
      <div className="route-heading">
        <div>
          <Kicker>TEACH / KEYFRAME ANIMATION</Kicker>
          <H2>Author the robot motion.</H2>
          <IntroCopy>
            Insert full-pose keyframes on a Blender-style timeline, then preview
            the interpolated gesture. Saved timelines stay in this browser until
            you delete them from the Archive.
          </IntroCopy>
        </div>
        <StatusPill online={hasSelection || timelineFrames.length > 0}>
          Timeline ready
        </StatusPill>
      </div>
      <div className="route-two-column">
        <RobotViewport robot={robot} state={state} onReset={onReset} />
        <Panel className="route-content-panel">
          <PanelHeader>
            <div>
              <PanelLabel>ANIMATION EDITOR</PanelLabel>
              <H3>Gesture keyframes</H3>
            </div>
            <span className="count-badge">{timelineFrames.length} keys</span>
          </PanelHeader>
          <div className="route-form-grid">
            <label>
              Gesture name
              <input
                aria-label="Gesture name"
                type="text"
                value={gestureName}
                onChange={(event) => onRenameGesture(event.target.value)}
                placeholder="e.g. Wave hello"
                disabled={!hasSelection && controllableJoints.length === 0}
                title={
                  hasSelection
                    ? undefined
                    : "Name the next gesture before its first keyframe"
                }
              />
            </label>
          </div>
          {saveConfirmation && (
            <p className="helper-text" role="status">
              {saveConfirmation}
            </p>
          )}
          <TimelinePanel
            frames={timelineFrames}
            joints={controllableJoints}
            fps={timelineFps}
            selectedFrameIndex={selectedFrameIndex}
            playheadFrame={playheadFrame}
            durationFrames={durationFrames}
            editorPositions={editorPositions}
            dirty={timelineDirty}
            hasSelection={hasSelection}
            onCapture={onCapture}
            onTargetFrame={onTargetFrame}
            onSelectFrame={onSelectFrame}
            onScrubFrame={onScrubFrame}
            onUpdateFrame={onUpdateFrame}
            onDeleteFrame={onDeleteFrame}
            onDuplicateFrame={onDuplicateFrame}
            onPreviewFrame={onPreviewFrame}
            onSave={onSave}
            onDiscard={onDiscard}
            onSaveAndNew={onSaveAndNew}
            onFpsChange={onFpsChange}
            onDurationChange={onDurationChange}
          />
        </Panel>
      </div>
    </div>
  );
}
