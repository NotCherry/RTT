import type { Dispatch, SetStateAction } from "react";
import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { H3 } from "@/components/ui/typography";
import { RobotScene } from "@/RobotScene";
import type { Robot, SimulationState, LandmarkFrame } from "@/types";
import type { useCameraCapture } from "./useCameraCapture";

type Props = {
  mode: "simple" | "continuous";
  setMode: Dispatch<SetStateAction<"simple" | "continuous">>;
  countdown: number;
  setCountdown: Dispatch<SetStateAction<number>>;
  processing: "live" | "offline";
  locked: boolean;
  robot: Robot | null;
  state: SimulationState | null;
  latest: LandmarkFrame | null;
  remaining: number | null;
  camera: ReturnType<typeof useCameraCapture>;
  cancelCountdown: () => void;
  start: () => void;
  savePose: () => void;
};
export function CameraCapturePanel({
  mode, setMode, countdown, setCountdown, processing, locked,
  robot, state, latest, remaining, camera, cancelCountdown, start, savePose,
}: Props) {
  const status = camera.recording
    ? `Recording · ${(camera.elapsed / 1000).toFixed(1)} s`
    : camera.finalizing ? "Finalizing video…"
    : remaining !== null ? `Get ready · ${remaining}`
    : "Stand in view with the selected limbs visible.";
  return (
    <Panel className="route-content-panel camera-capture-panel">
      <PanelHeader>
        <div>
          <PanelLabel>RETARGETED ROBOT</PanelLabel>
          <H3>Capture movement</H3>
        </div>
      </PanelHeader>
      <div className="route-form-grid camera-capture-settings">
        <label>
          Capture mode
          <select aria-label="Capture mode" value={mode} disabled={locked || processing === "offline"}
            onChange={(event) => setMode(event.target.value as typeof mode)}>
            <option value="simple">Simple pose</option>
            <option value="continuous">Continuous gesture</option>
          </select>
        </label>
        <label>
          Countdown
          <select aria-label="Countdown" value={countdown} disabled={locked}
            onChange={(event) => setCountdown(Number(event.target.value))}>
            {[1, 3, 5, 10].map((seconds) => <option key={seconds} value={seconds}>{seconds} seconds</option>)}
          </select>
        </label>
      </div>
      <div className="camera-live-robot"><RobotScene robot={robot} state={state} /></div>
      <p className="camera-capture-status" aria-live="polite">{status}</p>
      <div className="route-actions">
        {remaining !== null ? (
          <Button onClick={cancelCountdown}>Cancel countdown ({remaining})</Button>
        ) : camera.recording ? (
          <Button variant="recording" onClick={camera.stopRecording}>Stop recording</Button>
        ) : mode === "continuous" ? (
          <Button disabled={!camera.connected || locked} onClick={start}>Start recording</Button>
        ) : (
          <Button disabled={!latest || locked} onClick={savePose}>Save pose</Button>
        )}
      </div>
    </Panel>
  );
}
