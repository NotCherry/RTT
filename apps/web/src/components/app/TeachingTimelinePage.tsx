import { Button, Panel, PanelHeader, PanelLabel, StatusPill } from "@/components/ui";
import { RobotViewport } from "@/components/workbench/RobotViewport";
import { TimelinePanel } from "@/components/workbench/TimelinePanel";
import type { DemonstrationFrame, Joint, Robot, SimulationState } from "@/types";

type TeachingTimelinePageProps = {
  robot: Robot | null;
  state: SimulationState | null;
  timelineFrames: DemonstrationFrame[];
  controllableJoints: Joint[];
  recording: boolean;
  selectedFrameIndex: number;
  timelineDirty: boolean;
  hasSelection: boolean;
  onReset: () => void;
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

export function TeachingTimelinePage({
  robot,
  state,
  timelineFrames,
  controllableJoints,
  recording,
  selectedFrameIndex,
  timelineDirty,
  hasSelection,
  onReset,
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
}: TeachingTimelinePageProps) {
  return (
    <div className="route-page">
      <div className="route-heading">
        <div>
          <p className="kicker">TEACH / KEYFRAME ANIMATION</p>
          <h2>Author the robot motion.</h2>
          <p className="intro-copy">
            Insert full-pose keyframes on a Blender-style timeline, then preview the interpolated gesture.
          </p>
        </div>
        <StatusPill online={recording}>{recording ? "Keyframe capture" : "Timeline ready"}</StatusPill>
      </div>
      <div className="route-two-column">
        <RobotViewport robot={robot} state={state} onReset={onReset} />
        <Panel className="route-content-panel">
          <PanelHeader>
            <div>
              <PanelLabel>ANIMATION EDITOR</PanelLabel>
              <h3>Gesture keyframes</h3>
            </div>
            <span className="count-badge">{timelineFrames.length} keys</span>
          </PanelHeader>
          <TimelinePanel
            frames={timelineFrames}
            joints={controllableJoints}
            recording={recording}
            selectedFrameIndex={selectedFrameIndex}
            dirty={timelineDirty}
            hasSelection={hasSelection}
            onCapture={onCapture}
            onSelectFrame={onSelectFrame}
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
