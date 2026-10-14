import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { getRobotMotionDiagnostics, type RobotMotionSample, type RobotTransportStatus } from "@/domain/robotTransport";
const number = (value: number | null | undefined, digits = 3) => value == null ? "—" : value.toFixed(digits);
export function RobotMotionDiagnostics({ status }: { status: RobotTransportStatus }) {
  const [error, setError] = useState("");
  const [joint, setJoint] = useState("");
  const [history, setHistory] = useState<RobotMotionSample[]>([]);
  useEffect(() => { if (status.motion && status.state_fresh) setHistory(previous => [...previous, status.motion!].slice(-120)); }, [status.motion, status.state_fresh]);
  const names = Object.keys(status.measured), selected = joint || names[0];
  const samples = history.filter(sample => sample.joints[selected]);
  const span = Math.max(1, (samples.at(-1)?.server_time_ms ?? 0) - (samples[0]?.server_time_ms ?? 0));
  const path = (field: "reference" | "commanded" | "measured") => samples.flatMap(sample => {
    const value = sample.joints[selected][field];
    return value == null ? [] : [`${(sample.server_time_ms-samples[0].server_time_ms)/span*600},${100-value*25}`];
  }).join(" ");
  async function download() {
    try {
      const data = await getRobotMotionDiagnostics();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "robot-motion-diagnostics.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Diagnostics unavailable"); }
  }
  return <details className="camera-mapping-inspector"><summary>Measured and commanded upper-body positions</summary>
    <p className="helper-text">URDF reference stays visible. Only shared, observed joints are compared; a different preview geometry can produce a different camera target. Startup engagement {Math.round(status.engagement*100)}%. Waist remains capped at 0.5 rad/s and 1 rad/s².</p>
    {status.motion && <p className="helper-text">Sequence {status.motion.packet.sequence ?? "—"} · target receipt age {number(status.motion.target_age_ms, 0)} ms · feedback receipt age {number(status.motion.feedback_age_ms, 0)} ms · inference {number(status.motion.packet.processing_ms, 0)} ms. Exposure latency and physical parity are unverified.</p>}
    <div className="overflow-x-auto rounded border border-line-650"><table className="w-full border-collapse text-left font-mono text-xs"><thead><tr>{["Joint", "Measured · rad", "Camera target · rad", status.armed ? "Commanded · rad" : "Last command · rad", "URDF reference · rad", "Measured − reference", "Command − reference", "Measured − command", "Limits"].map(label => <th className="px-3 py-2" key={label}>{label}</th>)}</tr></thead>
      <tbody>{Object.entries(status.measured).map(([name, measured]) => { const value = status.motion?.joints[name]; return <tr key={name}>
        {[name, number(measured), number(status.camera_target?.[name]), number(status.commanded[name]), number(value?.reference), number(value?.reference_error), number(value?.command_error), number(value?.tracking_error), value ? `${value.speed_limit} rad/s · ${value.acceleration_limit} rad/s²${value.range_limited ? " · range clipping" : ""}${value.speed_limited ? " · speed clipping" : ""}${value.acceleration_limited ? " · acceleration clipping" : ""}` : "—"].map((cell,i) => <td className="px-3 py-2" key={i}>{cell}</td>)}
      </tr>; })}</tbody></table></div>
    {samples.length > 1 && <><label className="helper-text">Trace joint<select aria-label="Motion trace joint" value={selected} onChange={e => setJoint(e.target.value)}>{names.map(name => <option key={name}>{name}</option>)}</select></label>
      <svg className="camera-motion-trace" viewBox="0 0 600 200" role="img" aria-label="URDF reference, commanded and measured motion"><polyline className="camera-motion-reference" points={path("reference")} /><polyline className="camera-motion-command" points={path("commanded")} /><polyline className="camera-motion-measured" points={path("measured")} /></svg>
      <p className="helper-text">Blue: URDF reference · amber: commanded · green: measured. Display sampled at 2 Hz; export retains the last 1,500 controller ticks (about 30 seconds at 50 Hz). Use exported timestamps for lag analysis.</p></>}
    <div className="route-actions"><Button variant="secondary" onClick={() => void download()}>Export motion diagnostics</Button></div>
    {error && <p role="alert" className="helper-text">{error}</p>}
  </details>;
}
