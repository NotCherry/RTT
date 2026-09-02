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
  recording: boolean;
  timelineFps: number;
  selectedFrameIndex: number;
  playheadFrame: number;
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
  onUpdateTimestamp: (frameIndex: number, value: number) => void;
  onDeleteFrame: (index: number) => void;
  onDuplicateFrame: (index: number) => void;
  onPreviewFrame: (index: number) => void;
  onSave: () => void;
  onDiscard: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
};

export function TeachingTimelinePage({
  robot,
  state,
  timelineFrames,
  controllableJoints,
  recording,
  timelineFps,
  selectedFrameIndex,
  playheadFrame,
  editorPositions,
  timelineDirty,
  hasSelection,
  onReset,
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
}: TeachingTimelinePageProps) {
  return (
    <div className="route-page">
      <div className="route-heading">
        <div>
          <Kicker>TEACH / KEYFRAME ANIMATION</Kicker>
          <H2>Author the robot motion.</H2>
          <IntroCopy>
            Insert full-pose keyframes on a Blender-style timeline, then preview
            the interpolated gesture.
          </IntroCopy>
        </div>
        <StatusPill online={recording}>
          {recording ? "Keyframe capture" : "Timeline ready"}
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
          <TimelinePanel
            frames={timelineFrames}
            joints={controllableJoints}
            recording={recording}
            fps={timelineFps}
            selectedFrameIndex={selectedFrameIndex}
            playheadFrame={playheadFrame}
            editorPositions={editorPositions}
            dirty={timelineDirty}
            hasSelection={hasSelection}
            onCapture={onCapture}
            onTargetFrame={onTargetFrame}
            onSelectFrame={onSelectFrame}
            onScrubFrame={onScrubFrame}
            onUpdateFrame={onUpdateFrame}
            onUpdateTimestamp={onUpdateTimestamp}
            onDeleteFrame={onDeleteFrame}
            onDuplicateFrame={onDuplicateFrame}
            onPreviewFrame={onPreviewFrame}
            onSave={onSave}
            onDiscard={onDiscard}
            onStartRecording={onStartRecording}
            onStopRecording={onStopRecording}
          />
        </Panel>
      </div>
    </div>
  );
}
