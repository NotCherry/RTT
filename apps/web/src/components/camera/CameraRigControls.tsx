import { useState } from "react";
import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { H3 } from "@/components/ui/typography";
import type { useMultiCameraCapture } from "./useMultiCameraCapture";
import { StickFigure } from "./StickFigure";
import { CameraMetrics } from "./CameraMetrics";
import { IPCameraSourceSelect } from "./IPCameraSourceSelect";

export type CameraRig = ReturnType<typeof useMultiCameraCapture>["rig"];
export function CameraDeviceSelect({ rig, index, disabled }: { rig: CameraRig; index: number; disabled: boolean }) {
  return <label>USB camera {index + 1}<select aria-label={`USB camera ${index + 1}`} value={rig.inputs[index].deviceId} disabled={disabled} onChange={e => rig.update(index, { deviceId: e.target.value })}>
    <option value="">{rig.inputs.length === 1 ? "Default camera" : "Choose a camera"}</option>
    {rig.inputs[index].deviceId && !rig.devices.some(device => device.deviceId === rig.inputs[index].deviceId) &&
      <option value={rig.inputs[index].deviceId}>Saved camera · not currently detected</option>}
    {rig.devices.map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera device ${i + 1}`}</option>)}
  </select></label>;
}
export function CameraRigControls({ rig, disabled, showSettings = true }: { rig: CameraRig; disabled: boolean; showSettings?: boolean }) {
  return <>{rig.inputs.slice(1).map((input, offset) => <CameraRigView key={input.id} rig={rig} index={offset+1} disabled={disabled} showSettings={showSettings} />)}</>;
}
function CameraRigView({ rig, index, disabled, showSettings }: { rig: CameraRig; index: number; disabled: boolean; showSettings: boolean }) {
    const [expanded, setExpanded] = useState(false);
    const input = rig.inputs[index], camera = rig.cameras[index];
    const width = (input.kind === "local" ? camera.videoRef.current?.videoWidth : camera.imageRef.current?.naturalWidth) || 640;
    const height = (input.kind === "local" ? camera.videoRef.current?.videoHeight : camera.imageRef.current?.naturalHeight) || 480;
    return <Panel aria-label={`Camera ${index + 1} view`} className={`route-content-panel camera-source-panel camera-rig-view${expanded ? " camera-source-expanded" : ""}`}>
      <PanelHeader><div><PanelLabel>{input.id.toUpperCase()}</PanelLabel><H3>{input.label || `Camera ${index + 1}`}</H3></div><Button variant="secondary" aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Reduce" : "Expand"} camera {index+1}</Button></PanelHeader>
      {showSettings && <div className="route-form-grid"><label>Camera label<input aria-label={`Camera ${index + 1} label`} value={input.label ?? ""} placeholder={`Camera ${index + 1}`} disabled={disabled} onChange={e => rig.update(index, { label: e.target.value })} /></label><label>Video source<select aria-label={`Camera ${index + 1} source`} value={input.kind} disabled={disabled} onChange={e => rig.update(index, { kind: e.target.value as typeof input.kind })}>
        <option value="local">Laptop / USB camera</option><option value="ip">IP camera · HTTP/MJPEG or configured RTSP</option>
      </select></label>{input.kind === "local" ? <CameraDeviceSelect rig={rig} index={index} disabled={disabled} /> : <IPCameraSourceSelect label={`Camera ${index + 1} IP`} address={input.address} onChange={value => rig.update(index, { address: value })} disabled={disabled} />}</div>}
      <div className="camera-live-preview"><video ref={camera.videoRef} muted playsInline className={input.kind === "local" ? "camera-live-media" : "hidden"} />
        <img ref={camera.imageRef} alt={`Camera ${index + 1} IP stream`} className={input.kind === "ip" ? "camera-live-media" : "hidden"} />
        {camera.connected && <StickFigure frame={rig.latest[index]} overlay showSides width={width} height={height} />}
      </div><p className="camera-framing-status">{camera.status} · {width} × {height} · full frame · unmirrored.</p><CameraMetrics metrics={camera.metrics} />
    </Panel>;
}
