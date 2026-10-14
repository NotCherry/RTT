import { useState } from "react";
import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { H3 } from "@/components/ui/typography";
import { validateCameraTiming } from "@/domain/cameraTimingValidation";
import type { CameraRig } from "./CameraRigControls";
export function CameraTimingPanel({ rig, disabled }: { rig: CameraRig; disabled: boolean }) {
  const [evidence, setEvidence] = useState("");
  const [offsets, setOffsets] = useState(["0,0,0,0,0", "", ""]);
  const [uncertainty, setUncertainty] = useState("");
  const [error, setError] = useState("");
  return <Panel className="route-content-panel pb-4"><PanelHeader><div><PanelLabel>TIMING VALIDATION</PanelLabel><H3>Check shared movement across every view</H3></div></PanelHeader>
    <p className="helper-text">Record at least five sharp shared visible events across the movement volume, then inspect every retained video on its timeline. Enter each view's observed event delay relative to camera 1. Positive means that view arrives later. Repeat over the session to reveal variable buffering. Include camera frame sampling and measurement uncertainty. Geometry alone does not verify timing.</p>
    <div className="route-form-grid"><label>Evidence recording and procedure<input aria-label="Timing evidence" value={evidence} disabled={disabled} onChange={e => setEvidence(e.target.value)} /></label>
      <label>Measurement uncertainty · ms<input aria-label="Timing uncertainty" type="number" min="0" max="33.3" value={uncertainty} disabled={disabled} onChange={e => setUncertainty(e.target.value)} /></label>
      {rig.inputs.map((input, i) => <label key={input.id}>{input.id} event delays · ms<input aria-label={`${input.id} event delays`} placeholder="12, 14, 13, 15, 12" value={offsets[i]} disabled={disabled || i === 0} onChange={e => setOffsets(previous => previous.map((value,j) => i === j ? e.target.value : value))} /></label>)}</div>
    <div className="route-actions"><Button variant="secondary" disabled={disabled || rig.inputs.length < 2 || !rig.calibration} onClick={() => {
      try { const report = validateCameraTiming({ version: 1, method: "shared-visible-events", verified_at: new Date().toISOString(), evidence,
        bindings: rig.inputs, views: rig.inputs.map((input,i) => ({ id: input.id, offsets_ms: offsets[i].split(",").map(value => value.trim() ? Number(value) : NaN), uncertainty_ms: uncertainty.trim() ? Number(uncertainty) : NaN })) }, rig.inputs);
        rig.setTiming(report); setError("");
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Timing validation failed"); }
    }}>Apply measured timing</Button>
      {rig.timing && <Button variant="secondary" disabled={disabled} onClick={() => rig.setTiming(undefined)}>Clear timing validation</Button>}
    </div><p className="helper-text">{rig.timing ? `Operator timing evidence recorded ${rig.timing.verified_at}. Save setup to retain it. Revalidate after source, optics, buffering or placement changes.` : "Timing unverified · calibrated multi-camera physical control is blocked. Preview and recording remain available."}</p>
    {error && <p role="alert" className="helper-text">{error}</p>}
  </Panel>;
}
