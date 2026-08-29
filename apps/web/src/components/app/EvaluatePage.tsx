import { Button, Panel, PanelHeader, PanelLabel, StatusPill } from "@/components/ui";
import { RobotViewport } from "@/components/workbench/RobotViewport";
import { Progress } from "@/components/ui/progress";
import type { Robot, SimulationState, RolloutFrame } from "@/types";
import { meanAbsoluteError as meanError } from "@/domain/metrics";

type EvaluationResult = {
  target: number[];
  positions: number[];
  error: number;
};

type EvaluatePageProps = {
  robot: Robot | null;
  state: SimulationState | null;
  trained: boolean;
  busy: boolean;
  demonstrationsLength: number;
  rolloutFrames: RolloutFrame[];
  evaluation: EvaluationResult | null;
  replaying: boolean;
  onReplay: () => void;
  onEvaluate: () => void;
};

export function EvaluatePage({
  robot,
  state,
  trained,
  busy,
  demonstrationsLength,
  rolloutFrames,
  evaluation,
  replaying,
  onReplay,
  onEvaluate,
}: EvaluatePageProps) {
  return (
    <div className="route-page">
      <div className="route-heading">
        <div>
          <p className="kicker">EVALUATE / TRAJECTORY</p>
          <h2>Inspect the learned motion.</h2>
          <p className="intro-copy">
            Compare the predicted rollout against every authored keyframe instead of only checking the final pose.
          </p>
        </div>
        <StatusPill online={trained}>{trained ? "Evaluation ready" : "Train a model first"}</StatusPill>
      </div>
      <div className="route-two-column">
        <RobotViewport
          robot={robot}
          state={state}
          label="PREDICTED VIEWPORT"
          title={robot?.name ?? "Awaiting robot"}
          action={
            <Button size="small" variant="secondary" onClick={onReplay} disabled={rolloutFrames.length < 2}>
              {replaying ? "Replaying" : "Play rollout"}
            </Button>
          }
        />
        <Panel className="route-content-panel">
          <PanelHeader>
            <div>
              <PanelLabel>CHECKPOINT COMPARISON</PanelLabel>
              <h3>{rolloutFrames.length ? `${rolloutFrames.length} predicted frames` : "No rollout yet"}</h3>
            </div>
          </PanelHeader>
          <div className="evaluation-route-content">
            <Button variant="primary" full onClick={onEvaluate} disabled={!trained || !demonstrationsLength || busy}>
              Evaluate selected demonstration
            </Button>
            {evaluation ? (
              <>
                <div className="route-metric-grid">
                  <div>
                    <PanelLabel>MEAN ERROR</PanelLabel>
                    <strong>{meanError(evaluation.target, evaluation.positions).toFixed(4)}</strong>
                  </div>
                  <div>
                    <PanelLabel>MAX ERROR</PanelLabel>
                    <strong>{evaluation.error.toFixed(4)}</strong>
                  </div>
                </div>
                <div className="keyframe-results">
                  {rolloutFrames.map((frame, index) => (
                    <div className="keyframe-result" key={`${frame.timestamp}-${index}`}>
                      <span>Frame {index + 1}</span>
                      <Progress
                        value={Math.min(100, meanError(frame.expected, frame.positions) * 40)}
                        className="mx-3 h-1 flex-1"
                      />
                      <span>{meanError(frame.expected, frame.positions).toFixed(4)} error</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="test-empty">Select a demonstration and run evaluation to inspect the complete trajectory.</div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
