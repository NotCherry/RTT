import { useEffect, useRef, useState } from "react";
import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { H3 } from "@/components/ui/typography";
import { cameraCalibrationRequest } from "@/api";
import { captureCalibrationImages, defaultBoard, type BoardObservation } from "@/domain/cameraCalibrationCapture";
import { parseCameraCalibration } from "@/domain/multiCameraContract";
import type { CameraRig } from "./CameraRigControls";

export function CameraCalibrationPanel({ rig, connected, blocked, onBusyChange }: { rig: CameraRig; connected: boolean; blocked: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [board, setBoard] = useState(defaultBoard);
  const [samples, setSamples] = useState<BoardObservation[][]>([]);
  const [last, setLast] = useState<BoardObservation[]>([]);
  const [snapshots, setSnapshots] = useState<{ id: string; jpeg: string }[]>([]);
  const [status, setStatus] = useState("Hold the printed board still where every selected camera can see it.");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const signature = JSON.stringify({ inputs: rig.inputs, board });
  useEffect(() => { generation.current++; abort.current?.abort(); abort.current = null; setBusy(false); setSamples([]); setLast([]); setSnapshots([]); }, [signature]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { generation.current++; abort.current?.abort(); abort.current = null; }, []);
  async function operate(work: (signal: AbortSignal, valid: () => boolean) => Promise<void>) {
    if (abort.current) return;
    const controller = new AbortController(); abort.current = controller;
    const attempt = generation.current;
    const valid = () => attempt === generation.current && !controller.signal.aborted;
    setBusy(true);
    try { await work(controller.signal, valid); }
    catch (error) { if (attempt === generation.current) setStatus(controller.signal.aborted ? "Calibration operation cancelled." : error instanceof Error ? error.message : "Calibration failed"); }
    finally { if (abort.current === controller) { abort.current = null; setBusy(false); } }
  }
  const invalidBoard = board.marker_m >= board.square_m || board.marker_m < .005 || board.square_m < .01 || board.square_m > .2;
  return <Panel className="route-content-panel pb-4">
    <PanelHeader><div><PanelLabel>GUIDED CALIBRATION</PanelLabel><H3>Capture the geometry of your camera setup</H3></div></PanelHeader>
    <ol className="camera-workflow"><li>1 · Print and measure</li><li>2 · Capture diverse board poses</li><li>3 · Solve and inspect</li></ol>
    <div className="route-form-grid"><label>Measured square size · mm<input aria-label="Calibration square size" type="number" min="10" max="200" value={board.square_m * 1000} disabled={blocked || busy} onChange={e => setBoard({ ...board, square_m: Number(e.target.value) / 1000 })} /></label>
      <label>Measured marker size · mm<input aria-label="Calibration marker size" type="number" min="5" max="150" value={board.marker_m * 1000} disabled={blocked || busy} onChange={e => setBoard({ ...board, marker_m: Number(e.target.value) / 1000 })} /></label></div>
    <p className="helper-text">Use a flat, rigid 10 × 7-square ChArUco board. Print without stretching, then measure a square and marker. Keep focus, zoom and resolution fixed. Hold each pose still before capture; vary tilt, distance and image coverage.</p>
    <div className="route-actions"><Button variant="secondary" disabled={blocked || busy || invalidBoard} onClick={() => void operate(async (signal, valid) => {
      const image = await cameraCalibrationRequest<{ png: string }>("board", board, signal);
      if (!valid()) return;
      const link = document.createElement("a"); link.href = `data:image/png;base64,${image.png}`; link.download = "rtt-charuco-10x7.png"; link.click();
      setStatus("Board downloaded. Mount it flat and verify the printed square and marker sizes.");
    })}>Download ChArUco board</Button>
      <Button disabled={blocked || busy || !connected || rig.inputs.length < 2 || invalidBoard || samples.length >= 60} onClick={() => void operate(async (signal, valid) => {
        const views = captureCalibrationImages(rig);
        const result = await cameraCalibrationRequest<{ views: BoardObservation[] }>("detect", { board, views }, signal);
        if (!valid()) return;
        setLast(result.views); setSnapshots(views);
        const common = result.views.reduce((ids, view) => ids.filter(id => view.ids.includes(id)), result.views[0]?.ids ?? []);
        if (common.length < 12) { setStatus("Board needs at least 12 matching corners in every camera. Improve framing and retry."); return; }
        setSamples(previous => [...previous, result.views]);
        setStatus(`Captured ${samples.length + 1} board poses. Move and tilt the board before the next capture.`);
      })}>Capture board pose</Button>
      <Button disabled={blocked || busy || samples.length < 14} onClick={() => void operate(async (signal, valid) => {
        setStatus("Solving camera geometry in the calibration worker…");
        const result = await cameraCalibrationRequest<unknown>("solve", { board, observations: samples }, signal);
        if (!valid()) return;
        const calibration = parseCameraCalibration(result);
        rig.setCalibration(calibration);
        setStatus(`Calibration solved · ${calibration.rms_px?.toFixed(2)} px RMS. Inspect its validation report, then select Calibrated triangulation in Camera setup and Save setup.`);
      })}>Solve calibration ({samples.length}/14 poses)</Button>
      {busy && <Button variant="secondary" onClick={() => abort.current?.abort()}>Cancel calibration</Button>}
      {!!samples.length && <Button variant="secondary" disabled={busy || blocked} onClick={() => { setSamples([]); setLast([]); setSnapshots([]); }}>Clear board poses</Button>}
    </div><p role="status" className="helper-text">{status}</p>
    {blocked && <p className="helper-text">Stop and disconnect robot control before calibration.</p>}
    {!connected && <p className="helper-text">Open your cameras using Start live preview before capturing board poses.</p>}
    <p className="helper-text">Capture at least 14 poses: 12 for fitting and two for independent geometry checks. Timing is still unverified; geometric calibration does not synchronize exposure.</p>
    {!!last.length && <details className="camera-mapping-inspector" open><summary>Latest board snapshots and detected corners</summary><div className="camera-calibration-snapshots">{last.map((view, i) =>
      <div key={view.id}><p className="helper-text">{view.id} · {view.ids.length} corners · {view.width} × {view.height}</p><svg viewBox={`0 0 ${view.width} ${view.height}`} role="img" aria-label={`${view.id} detected board corners`}><image href={`data:image/jpeg;base64,${snapshots[i]?.jpeg}`} width={view.width} height={view.height} />{view.points.map(([x, y], j) => <circle key={view.ids[j]} cx={x} cy={y} r="5" className="camera-board-corner" />)}</svg></div>)}</div></details>}
  </Panel>;
}
