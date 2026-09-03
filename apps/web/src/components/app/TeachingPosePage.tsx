import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { H2, H3, IntroCopy, Kicker } from "@/components/ui/typography";
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
  onCapture: (name?: string) => void;
  savedPoseName?: string | null;
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
  savedPoseName,
}: TeachingPosePageProps) {
  const [poseName, setPoseName] = useState("");
  return (
    <div className="route-page">
      <div className="route-heading">
        <div>
          <Kicker>TEACH / POSE EDITOR</Kicker>
          <H2>Shape the robot pose.</H2>
          <IntroCopy>
            Edit every controllable joint together, then capture a full-pose
            keyframe or continue in the animation timeline.
          </IntroCopy>
        </div>
        <div className="route-heading-actions">
          <Button variant="ghost" size="small" asChild>
            <label className="route-upload cursor-pointer">
              <input
                type="file"
                accept=".urdf,application/xml,text/xml"
                onChange={onUpload}
                className="hidden"
              />
              Upload URDF
            </label>
          </Button>
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
              <H3>Joint editor</H3>
            </div>
            <span className="count-badge">
              {controllableJoints.length} active
            </span>
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
                  onChange={(event) =>
                    onUpdateJoint(index, Number(event.target.value))
                  }
                />
                <input
                  type="number"
                  min={joint.lower}
                  max={joint.upper}
                  step="0.001"
                  value={positions[index] ?? 0}
                  aria-label={`${joint.name} route position`}
                  onChange={(event) =>
                    onUpdateJoint(index, Number(event.target.value))
                  }
                />
              </label>
            ))}
          </div>
          <div className="route-form-grid">
            <label>
              Pose name
              <input
                aria-label="Pose name"
                type="text"
                value={poseName}
                onChange={(event) => setPoseName(event.target.value)}
                placeholder="e.g. Home pose"
              />
            </label>
          </div>
          <div className="route-actions">
            <Button
              variant="primary"
              onClick={() => onCapture(poseName.trim() || undefined)}
              disabled={!robot || !controllableJoints.length}
            >
              Capture pose
            </Button>
            <Button variant="secondary" size="small" asChild>
              <Link to="/teach/timeline">Open keyframe editor</Link>
            </Button>
          </div>
          {savedPoseName && (
            <p className="helper-text" role="status">
              Saved &ldquo;{savedPoseName}&rdquo; to the archive.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
