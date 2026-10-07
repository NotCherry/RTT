import { useState } from "react";
import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { H3 } from "@/components/ui/typography";
import type { useRobotTransport } from "./useRobotTransport";

export function RobotConnectionPanel({ connection, live }: { connection: ReturnType<typeof useRobotTransport>; live: boolean }) {
  const [transport, setTransport] = useState<"mock" | "unitree-sdk2">("mock");
  const [model, setModel] = useState<"g1-29" | "g1-23">("g1-29");
  const [network, setNetwork] = useState("eth0");
  const [speed, setSpeed] = useState(1);
  const status = connection.status;
  return <Panel className="route-content-panel" aria-label="Robot connection controls">
    <PanelHeader><div><PanelLabel>ROBOT CONNECTION</PanelLabel><H3>Send live arm motion</H3></div></PanelHeader>
    {!status?.connected && <div className="route-form-grid">
      <label>Connection<select aria-label="Robot connection" value={transport} onChange={e => setTransport(e.target.value as typeof transport)} disabled={connection.busy}>
        <option value="mock">Mock robot · no hardware</option><option value="unitree-sdk2">Unitree DDS · physical robot</option>
      </select></label>
      <label>Robot model<select aria-label="Physical robot model" value={model} onChange={e => setModel(e.target.value as typeof model)} disabled={connection.busy}>
        <option value="g1-29">G1 EDU · 29 DOF</option><option value="g1-23">G1 · 23 DOF</option>
      </select></label>
      <label>Robot speed<select aria-label="Robot speed" value={speed} onChange={e => setSpeed(Number(e.target.value))} disabled={connection.busy}>
        {[0.5, 1, 1.5, 2, 3].map(value => <option key={value} value={value}>{value} rad/s</option>)}
      </select></label>
      {transport === "unitree-sdk2" && <>
        <label>Network interface<input aria-label="Robot network interface" value={network} onChange={e => setNetwork(e.target.value)} disabled={connection.busy} /></label>
      </>}
    </div>}
    <p className="helper-text" aria-live="polite">{status?.reason ?? "Connect a mock robot or select Unitree DDS for your G1."}
      {status?.connected && ` · ${status.transport === "mock" ? "Mock" : "Physical"} · ${status.packets_sent} packets · state ${status.state_fresh ? "fresh" : "waiting"}`}
    </p>
    <div className="route-actions">
      {!status?.connected ? <Button disabled={connection.busy || (transport === "unitree-sdk2" && !network)}
        onClick={() => void connection.connect({ transport, robot_model: model, network_interface: network, domain_id: 0, max_joint_speed: speed, max_joint_acceleration: 3 })}>
        {transport === "mock" ? "Connect mock robot" : "Connect physical robot"}
      </Button> : <>
        {status.armed ? <Button variant="recording" disabled={connection.busy || !connection.owned} onClick={() => void connection.action("disarm")}>Stop / disarm</Button>
          : <Button disabled={connection.busy || !connection.owned || !status.state_fresh || !live} onClick={() => void connection.action("arm")}>Arm live control</Button>}
        <Button variant="secondary" disabled={connection.busy || !connection.owned} onClick={() => void connection.action("disconnect")}>Disconnect robot</Button>
      </>}
    </div>
    {status?.connected && !live && <p className="helper-text">Open the camera with Live preview processing to arm.</p>}
    {status?.connected && <details className="camera-mapping-inspector">
      <summary>Measured and commanded arm positions</summary>
      <div className="overflow-x-auto rounded border border-line-650"><table className="w-full border-collapse text-left font-mono text-xs"><thead><tr><th className="px-3 py-2">Joint</th><th className="px-3 py-2">Measured · rad</th><th className="px-3 py-2">Commanded · rad</th></tr></thead>
        <tbody>{Object.entries(status.measured).map(([name, measured]) => <tr key={name}><td className="px-3 py-2">{name}</td><td className="px-3 py-2">{measured.toFixed(3)}</td><td className="px-3 py-2">{status.commanded[name]?.toFixed(3) ?? "—"}</td></tr>)}</tbody>
      </table></div>
    </details>}
    <p className="helper-text">Only live, visible arm joints are sent. Preview speed is separate from robot speed. Arming takes control of the arms; use the robot’s local stop for an emergency.</p>
    {connection.error && <p role="alert" className="helper-text">{connection.error}</p>}
  </Panel>;
}
