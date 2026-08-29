import { Link } from "react-router-dom";
import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { RobotViewport } from "@/components/workbench/RobotViewport";
import type { Joint, Robot, SimulationState } from "@/types";

type TeachingPosePageProps = {
  robot: Robot | null;
  state: SimulationState | null;
  controllableJoints: Joint[];
  positions: number[];
  busy: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDemo: () => void;
  onReset: () => void;
  onUpdateJoint: (index: number, value: number) => void;
  onCapture: () => void;
};

export function TeachingPosePage({
  robot,
  state,
  controllableJoints,
  positions,
  busy,
  onUpload,
  onDemo,
  onReset,
  onUpdateJoint,
  onCapture,
}: TeachingPosePageProps) {
  return (
    <div className="route-page">
      <div className="route-heading">
        <div>
          <p className="kicker">TEACH / POSE EDITOR</p>
          <h2>Shape the robot pose.</h2>
          <p className="intro-copy">
            Edit every controllable joint together, then capture a full-pose keyframe or continue in the animation
            timeline.
          </p>
        </div>
        <div className="route-heading-actions">
          <label className="button ghost route-upload">
            <input type="file" accept=".urdf,application/xml,text/xml" onChange={onUpload} />
            Upload URDF
          </label>
          <Button variant="primary" onClick={onDemo} disabled={busy}>
            Open sample robot
          </Button>
        </div>
      </div>
      <div className="route-two-column">
        <RobotViewport robot={robot} state={state} onReset={onReset} />
        <Panel className="route-content-panel">
          <PanelHeader>
            <div>
              <PanelLabel>FULL-ROBOT POSE</PanelLabel>
              <h3>Joint editor</h3>
            </div>
            <span className="count-badge">{controllableJoints.length} active</span>
          </PanelHeader>
          <div className="route-joint-list">
            {controllableJoints.map((joint, index) => (
              <label className="route-joint-row" key={joint.name}>
                <span>
                  {joint.name}
                  <small>{joint.type}</small>
                </span>
                <input
                  type="range"
                  min={joint.lower}
                  max={joint.upper}
                  step="0.001"
                  value={positions[index] ?? 0}
                  onChange={(event) => onUpdateJoint(index, Number(event.target.value))}
                />
                <input
                  type="number"
                  min={joint.lower}
                  max={joint.upper}
                  step="0.001"
                  value={positions[index] ?? 0}
                  aria-label={`${joint.name} route position`}
                  onChange={(event) => onUpdateJoint(index, Number(event.target.value))}
                />
              </label>
            ))}
          </div>
          <div className="route-actions">
            <Button variant="primary" onClick={onCapture} disabled={!robot || !controllableJoints.length}>
              Capture pose
            </Button>
            <Link className="button secondary" to="/teach/timeline">
              Open keyframe editor
            </Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}
