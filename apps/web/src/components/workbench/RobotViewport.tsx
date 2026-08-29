import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { RobotScene } from "@/RobotScene";
import type { Robot, SimulationState } from "@/types";

type RobotViewportProps = {
  robot: Robot | null;
  state: SimulationState | null;
  title?: string;
  label?: string;
  onReset?: () => void;
  action?: React.ReactNode;
};

export function RobotViewport({ robot, state, title, label = "LIVE VIEWPORT", onReset, action }: RobotViewportProps) {
  return (
    <Panel className="route-viewport-panel">
      <PanelHeader>
        <div>
          <PanelLabel>{label}</PanelLabel>
          <h3>{title ?? robot?.name ?? "Awaiting robot"}</h3>
        </div>
        {onReset ? (
          <Button size="small" variant="secondary" onClick={onReset} disabled={!robot}>
            Reset pose
          </Button>
        ) : (
          action
        )}
      </PanelHeader>
      <RobotScene robot={robot} state={state} />
    </Panel>
  );
}
