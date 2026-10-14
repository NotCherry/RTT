import { useState } from "react";
import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { H3 } from "@/components/ui/typography";
import { parseCameraCalibration } from "@/domain/multiCameraContract";
import type { CameraRig } from "./CameraRigControls";

export function CameraSetupPanel({ rig, disabled, calibrationOnly = false, onTest, connected = false, testDisabled = false }: {
  rig: CameraRig; disabled: boolean; calibrationOnly?: boolean; onTest?: () => void; connected?: boolean; testDisabled?: boolean;
}) {
  const [error, setError] = useState("");
  return <Panel className="route-content-panel pb-4">
    <PanelHeader><div><PanelLabel>{calibrationOnly ? "CALIBRATION" : "CAMERA SETUP"}</PanelLabel><H3>{calibrationOnly ? "Reconstruct movement in 3D" : "See every camera together"}</H3></div></PanelHeader>
    {!calibrationOnly && <><div className="route-form-grid">
      <label>Camera arrangement<select aria-label="Camera count" value={rig.inputs.length} disabled={disabled} onChange={e => rig.setCount(Number(e.target.value))}>
        <option value="1">1 camera</option><option value="2">2 cameras</option><option value="3">3 cameras</option>
      </select></label>
      <label>Setup name<input aria-label="Camera setup name" value={rig.setupName} disabled={disabled} onChange={e => rig.setSetupName(e.target.value)} /></label>
      <label>Landmark detector<select aria-label="Landmark detector" value="holistic" disabled><option value="holistic">MediaPipe Holistic · body and hands</option></select></label>
      <label>3D reconstruction<select aria-label="3D reconstruction" value={rig.inputs.length === 1 ? "single" : rig.model} disabled={disabled || rig.inputs.length === 1} onChange={e => rig.setModel(e.target.value as typeof rig.model)}>
        {rig.inputs.length === 1 && <option value="single">Single-view estimate</option>}
        <option value="body-aligned">Body-aligned fusion · inferred depth</option><option value="triangulated">Calibrated triangulation</option>
      </select></label>
    </div><div className="route-actions"><Button variant="secondary" disabled={disabled} onClick={() => void rig.refreshDevices()}>Detect cameras</Button><Button variant="secondary" disabled={disabled} onClick={rig.saveSetup}>Save setup</Button>
      {onTest && !connected && <Button variant="secondary" disabled={testDisabled} onClick={onTest}>Test all cameras</Button>}
    </div></>}
    {calibrationOnly && <><p className="helper-text">Keep cameras fixed with overlapping views. Record a checkerboard in every camera, export the videos from Recordings, and solve the calibration with the local OpenCV tool.</p>
      <a className="helper-text" href="/camera-checkerboard-9x6-25mm.svg" target="_blank" rel="noreferrer">Print the 9 × 6 inner-corner checkerboard · 25 mm squares</a>
      <div className="route-form-grid"><label>Camera calibration<input aria-label="Camera calibration JSON" type="file" accept="application/json,.json" disabled={disabled || rig.inputs.length === 1} onChange={async e => {
        const file = e.target.files?.[0]; if (!file) return;
        try { if (file.size > 65536) throw new Error("Calibration file is too large.");
          const calibration = parseCameraCalibration(JSON.parse(await file.text()));
          if (calibration.cameras.length !== rig.inputs.length) throw new Error("Calibration camera count does not match this setup.");
          rig.setCalibration(calibration); setError("");
        } catch (failure) { setError(failure instanceof Error ? failure.message : "Invalid calibration"); }
      }} /></label></div>
      <div className="route-actions"><Button variant="secondary" disabled={!rig.calibration} onClick={() => {
        if (!rig.calibration) return;
        const url = URL.createObjectURL(new Blob([JSON.stringify(rig.calibration, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "rtt-camera-calibration.json"; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Export calibration</Button><Button variant="secondary" disabled={disabled || !rig.calibration} onClick={() => rig.setCalibration(undefined)}>Camera moved / recalibrate</Button></div></>}
    <p className="helper-text">{rig.calibration ? `${rig.calibration.cameras.length} calibrated views · reprojection RMS ${rig.calibration.rms_px?.toFixed(2) ?? "unknown"} px.` : "No calibration loaded. Single-view and body-aligned depth are estimates."} USB and MJPEG exposure timing is unverified.</p>
    {rig.calibration?.validation_rms_px && <p className="helper-text">Held-out validation: {rig.calibration.validation_rms_px.map((error, i) => `view-${i+1}: ${error.toFixed(2)} px`).join(" · ")}.</p>}
    {error && <p role="alert" className="helper-text">{error}</p>}
  </Panel>;
}
