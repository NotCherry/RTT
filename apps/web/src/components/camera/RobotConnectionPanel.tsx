import { useState } from "react";
import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { H3 } from "@/components/ui/typography";
import type { useRobotTransport } from "./useRobotTransport";
import type { RobotConnectionConfig } from "@/domain/robotTransport";

export function RobotConnectionPanel({ connection, live }: { connection: ReturnType<typeof useRobotTransport>; live: boolean }) {
  const [transport, setTransport] = useState<RobotConnectionConfig["transport"]>("mock");
  const [model, setModel] = useState<"g1-29" | "g1-23">("g1-29");
  const [network, setNetwork] = useState("eth0");
  const [speed, setSpeed] = useState(1);
  const [bridgeUrl, setBridgeUrl] = useState("ws://192.168.123.164:9090");
  const bridgeValid = /^wss?:\/\/[^\s/]+/.test(bridgeUrl.trim());
  const status = connection.status;
  const armBlock = !connection.owned ? "This browser does not own the connection. Return to the browser that connected the robot and disconnect there first."
    : !live ? "Open the camera with Live preview processing to arm."
    : !connection.streamReady ? "Waiting for the camera target stream to connect."
    : !status?.state_fresh ? "Waiting for fresh measured robot state before arming."
    : "Choose Arm live control to start publishing motor commands.";
  return <Panel className="route-content-panel pb-4" aria-label="Robot connection controls">
    <PanelHeader><div><PanelLabel>ROBOT CONNECTION</PanelLabel><H3>Send live arm motion</H3></div></PanelHeader>
    {!status?.connected && <div className="route-form-grid">
      <label>Connection<select aria-label="Robot connection" value={transport} onChange={e => setTransport(e.target.value as typeof transport)} disabled={connection.busy}>
        <option value="mock">Mock robot · no hardware</option><option value="unitree-sdk2">Unitree DDS · physical robot</option>
        <option value="unitree-rosbridge">Unitree ROS bridge · physical robot</option>
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
      {transport === "unitree-rosbridge" && <label>ROS bridge URL<input aria-label="Robot ROS bridge URL" value={bridgeUrl} onChange={e => setBridgeUrl(e.target.value)} disabled={connection.busy} /></label>}
    </div>}
    {transport === "unitree-rosbridge" && !status?.connected && <p className="helper-text">Connect through the robot’s Linux ROS bridge. Measured state and arm commands use the bridge; connecting leaves control disarmed.</p>}
    <p className="helper-text" aria-live="polite">{status?.reason ?? "Connect a mock robot or select a Unitree connection for your G1."}
      {status?.connected && ` · ${status.transport === "mock" ? "Mock" : "Physical"} · ${status.packets_sent} packets · state ${status.state_fresh ? "fresh" : "waiting"} · ${status.targets_received ?? 0} camera frames received`}
    </p>
    <div className="route-actions">
      {!status?.connected ? <Button disabled={connection.busy || (transport === "unitree-sdk2" && !network) || (transport === "unitree-rosbridge" && !bridgeValid)}
        onClick={() => void connection.connect({ transport, robot_model: model, network_interface: transport === "unitree-rosbridge" ? "lo" : network, domain_id: 0, max_joint_speed: speed, max_joint_acceleration: 3,
          ...(transport === "unitree-rosbridge" ? { rosbridge_url: bridgeUrl.trim() } : {}) })}>
        {transport === "mock" ? "Connect mock robot" : "Connect physical robot"}
      </Button> : <>
        {status.armed ? <Button variant="recording" disabled={connection.busy || !connection.owned} onClick={() => void connection.action("disarm")}>Stop / disarm</Button>
          : <Button disabled={connection.busy || !connection.owned || !connection.streamReady || !status.state_fresh || !live} onClick={() => void connection.action("arm")}>Arm live control</Button>}
        <Button variant="secondary" disabled={connection.busy || !connection.owned} onClick={() => void connection.action("disconnect")}>Disconnect robot</Button>
      </>}
    </div>
    {status?.connected && !status.armed && <p className="helper-text">Disarmed · motor commands are not being published. The visualization previews camera motion. {armBlock}</p>}
    {status?.connected && connection.streamReady && <p className="helper-text">
      {Object.keys(status.camera_target ?? {}).length ? "Live arm targets are reaching the backend."
        : "No fresh visible arm targets. Keep your arms in the camera view; the visualization can hold its last pose."}
    </p>}
    {status?.connected && <details className="camera-mapping-inspector">
      <summary>Measured and commanded arm positions</summary>
      <div className="overflow-x-auto rounded border border-line-650"><table className="w-full border-collapse text-left font-mono text-xs"><thead><tr><th className="px-3 py-2">Joint</th><th className="px-3 py-2">Measured · rad</th><th className="px-3 py-2">Camera target · rad</th><th className="px-3 py-2">{status.armed ? "Commanded · rad" : "Last command · rad"}</th></tr></thead>
        <tbody>{Object.entries(status.measured).map(([name, measured]) => <tr key={name}><td className="px-3 py-2">{name}</td><td className="px-3 py-2">{measured.toFixed(3)}</td><td className="px-3 py-2">{status.camera_target?.[name]?.toFixed(3) ?? "—"}</td><td className="px-3 py-2">{status.commanded[name]?.toFixed(3) ?? "—"}</td></tr>)}</tbody>
      </table></div>
    </details>}
    <p className="helper-text">Only live, visible arm joints are sent. Preview speed is separate from robot speed. Arming takes control of the arms; use the robot’s local stop for an emergency.</p>
    {connection.error && <p role="alert" className="helper-text">{connection.error}</p>}
  </Panel>;
}
