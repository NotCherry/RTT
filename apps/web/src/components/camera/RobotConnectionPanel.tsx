import { useState } from "react";
import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { H3 } from "@/components/ui/typography";
import type { useRobotTransport } from "./useRobotTransport";
import type { RobotConnectionConfig } from "@/domain/robotTransport";
import type { RetargetingProfile } from "@/domain/retargeting";
import { controlForProfile } from "@/domain/robotControlMapping";
import type { useLiveCameraSession } from "./useLiveCameraSession";
import { loadRobotConnectionSettings, saveRobotConnectionSettings } from "@/domain/robotConnectionSettings";
import { RobotMotionDiagnostics } from "./RobotMotionDiagnostics";

export function RobotConnectionPanel({ connection, live, profile = "g1-upper-body", session, preview, canStart = true, previewConnected = live, runBlocked = false, previewSpeed = 3 }: {
  connection: ReturnType<typeof useRobotTransport>; live: boolean; profile?: RetargetingProfile;
  session?: ReturnType<typeof useLiveCameraSession>; preview?: () => void; canStart?: boolean; previewConnected?: boolean; runBlocked?: boolean;
  previewSpeed?: number;
}) {
  const [saved] = useState(loadRobotConnectionSettings);
  const [transport, setTransport] = useState<RobotConnectionConfig["transport"]>(saved.transport);
  const [model, setModel] = useState<"g1-29" | "g1-23">(saved.robot_model);
  const [network, setNetwork] = useState(saved.network_interface);
  const [domain, setDomain] = useState(String(saved.domain_id));
  const [peers, setPeers] = useState(saved.discovery_peers?.join(", ") ?? "");
  const [multicast, setMulticast] = useState(saved.allow_multicast ?? true);
  const peerList = peers.split(/[\s,]+/).filter(Boolean);
  const ddsValid = !!network.trim() && !!domain.trim() && Number.isInteger(Number(domain)) && Number(domain) >= 0 && Number(domain) <= 232
    && (multicast || peerList.length > 0) && peerList.length <= 16 && peerList.every(peer => {
      const parts = peer.split(".");
      return parts.length === 4 && parts.every(part => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
    });
  const [speed, setSpeed] = useState(saved.max_joint_speed);
  const [matchPreview, setMatchPreview] = useState(saved.motion_profile === "match-preview");
  const [armStrength, setArmStrength] = useState(saved.kp ?? 60);
  const [waistDof, setWaistDof] = useState<1 | 3>(saved.waist_dof ?? 3);
  const control = controlForProfile(profile);
  const [bridgeUrl, setBridgeUrl] = useState(saved.rosbridge_url ?? "ws://192.168.123.164:9090");
  const bridgeValid = /^wss?:\/\/[^\s/]+/.test(bridgeUrl.trim());
  const status = connection.status;
  const settings = (): RobotConnectionConfig => {
    const config: RobotConnectionConfig = { transport, robot_model: model, ...control, waist_dof: waistDof, kp: armStrength, kd: 1.5,
    network_interface: transport === "unitree-rosbridge" ? "lo" : network.trim(), domain_id: transport === "unitree-sdk2" ? Number(domain) : 0,
    max_joint_speed: matchPreview ? Math.min(previewSpeed, 3) : speed, max_joint_acceleration: matchPreview ? 10 : 3,
    ...(transport === "unitree-sdk2" ? { discovery_peers: peerList, allow_multicast: multicast } : {}),
    ...(transport === "unitree-rosbridge" ? { rosbridge_url: bridgeUrl.trim() } : {}) };
    saveRobotConnectionSettings({ ...config, allow_multicast: multicast, discovery_peers: peerList, motion_profile: matchPreview ? "match-preview" : "custom" });
    return config;
  };
  const armBlock = !connection.owned ? "This browser does not own the connection. Return to the browser that connected the robot and disconnect there first."
    : !live ? "Open the camera with Live preview processing to arm."
    : !connection.streamReady ? "Waiting for the camera target stream to connect."
    : !status?.state_fresh ? "Waiting for fresh measured robot state before arming."
    : session ? "Choose Run on physical robot to start publishing motor commands." : "Choose Arm live control to start publishing motor commands.";
  return <Panel className="route-content-panel pb-4" aria-label="Robot connection controls">
    <PanelHeader><div><PanelLabel>{session ? "LIVE SESSION" : "ROBOT CONNECTION"}</PanelLabel><H3>{session ? "Preview movement or run your robot" : "Send live upper-body motion"}</H3></div></PanelHeader>
    {session && <><p className="helper-text">{transport === "mock" ? "Mock robot" : "Physical robot"} · {transport === "unitree-sdk2" ? `Unitree DDS · ${network} · domain ${domain}` : transport} · {model === "g1-29" ? "G1 EDU 29 DOF" : "G1 23 DOF"}</p>
      <div className="route-actions">
        {session.busy ? <Button variant="secondary" onClick={session.cancel}>Cancel startup</Button> : <>
          {!status?.armed && <Button variant="secondary" disabled={!canStart || connection.busy} onClick={preview}>{previewConnected ? "Close cameras" : "Start live preview"}</Button>}
          {status?.armed ? <Button className="camera-session-stop" variant="recording" disabled={!connection.owned || connection.busy} onClick={() => void connection.action("disarm")}>Stop robot</Button>
            : <Button disabled={runBlocked || !canStart || connection.busy || (status?.connected && !connection.owned) || (transport === "unitree-sdk2" && !ddsValid) || (transport === "unitree-rosbridge" && !bridgeValid)} onClick={() => void session.start(settings())}>{transport === "mock" ? "Run on mock robot" : "Run on physical robot"}</Button>}
          {status?.connected && <Button variant="secondary" disabled={!connection.owned || connection.busy} onClick={() => void connection.action("disconnect")}>Disconnect robot</Button>}
        </>}
      </div><p aria-live="polite" className="helper-text">{session.stage}</p>{session.error && <p role="alert" className="helper-text">{session.error}</p>}</>}
    <details className="camera-mapping-inspector" open={session ? undefined : true}><summary>Robot settings and diagnostics</summary>
    {!status?.connected && <div className="route-form-grid"><fieldset className="camera-settings-fields" disabled={Boolean(session?.busy)}>
      <label>Connection<select aria-label="Robot connection" value={transport} onChange={e => setTransport(e.target.value as typeof transport)} disabled={connection.busy}>
        <option value="mock">Mock robot · no hardware</option><option value="unitree-sdk2">Unitree DDS · physical robot</option>
        <option value="unitree-rosbridge">Unitree ROS bridge · physical robot</option>
      </select></label>
      <label>Robot model<select aria-label="Physical robot model" value={model} onChange={e => { setModel(e.target.value as typeof model); if (e.target.value === "g1-23") setWaistDof(1); }} disabled={connection.busy}>
        <option value="g1-29">G1 EDU · 29 DOF</option><option value="g1-23">G1 · 23 DOF</option>
      </select></label>
      <label>Motion profile<select aria-label="Robot motion profile" value={matchPreview ? "match-preview" : "custom"} onChange={e => setMatchPreview(e.target.value === "match-preview")} disabled={connection.busy}>
        <option value="custom">Conservative / custom speed</option><option value="match-preview">Match preview · validation candidate</option>
      </select></label>
      <label>Robot speed<select aria-label="Robot speed" value={speed} onChange={e => setSpeed(Number(e.target.value))} disabled={connection.busy || matchPreview}>
        {[0.5, 1, 1.5, 2, 3].map(value => <option key={value} value={value}>{value} rad/s</option>)}
      </select></label>
      <label>Movable waist axes<select aria-label="Movable waist axes" value={waistDof} onChange={e => setWaistDof(Number(e.target.value) as 1 | 3)} disabled={connection.busy || model === "g1-23"}>
        <option value="3">Yaw, roll and pitch</option><option value="1">Yaw only · roll/pitch locked</option>
      </select></label>
      <label>Arm strength<select aria-label="Arm strength" value={armStrength} onChange={e => setArmStrength(Number(e.target.value))} disabled={connection.busy}>
        <option value="20">Gentle · kp 20</option><option value="40">Firm · kp 40</option><option value="60">Strong · kp 60</option>
      </select></label>
      {transport === "unitree-sdk2" && <>
        <label>Network interface<input aria-label="Robot network interface" value={network} onChange={e => setNetwork(e.target.value)} disabled={connection.busy} /></label>
        <label>DDS domain<input aria-label="Robot DDS domain" type="number" min="0" max="232" value={domain} onChange={e => setDomain(e.target.value)} disabled={connection.busy} /></label>
        <label>Discovery peers<input aria-label="Robot DDS discovery peers" placeholder="IPv4 addresses, separated by commas" value={peers} onChange={e => setPeers(e.target.value)} disabled={connection.busy} /></label>
        <label>Multicast<select aria-label="Robot DDS multicast" value={String(multicast)} onChange={e => setMulticast(e.target.value === "true")} disabled={connection.busy}>
          <option value="true">Enabled</option><option value="false">Disabled · peers only</option>
        </select></label>
      </>}
      {transport === "unitree-rosbridge" && <label>ROS bridge URL<input aria-label="Robot ROS bridge URL" value={bridgeUrl} onChange={e => setBridgeUrl(e.target.value)} disabled={connection.busy} /></label>}
    </fieldset></div>}
    <p className="helper-text">{(status?.control_mode ?? control.control_mode) === "single-arm"
      ? `${status?.active_arm ?? control.active_arm} arm follows the camera. The other arm and torso hold their measured pose from arming.`
      : "Both arms and the movable waist axes follow the camera. Missing landmarks hold the last command."}
      {status?.connected ? " Disconnect to change the mapping scope or waist axes." : " Choose the mapping scope above before connecting."}
    </p>
    <p className="helper-text">Arm strength uses kp {status?.arm_kp ?? armStrength} with damping 1.5. Strong matches the SDK example’s arm stiffness for raised poses; robot speed stays separate.</p>
    {transport === "unitree-rosbridge" && !status?.connected && <p className="helper-text">Connect through the robot’s Linux ROS bridge. Measured state and arm commands use the bridge; connecting leaves control disarmed.</p>}
    {transport === "unitree-sdk2" && !status?.connected && <p className="helper-text">Use the backend’s interface name. Direct robot Ethernet uses domain 0 with multicast enabled; a DDS relay uses its client domain and peer address. Disconnect before changing network settings; each connection starts a fresh DDS process.</p>}
    <p className="helper-text" aria-live="polite">{status?.reason ?? "Connect a mock robot or select a Unitree connection for your G1."}
      {status?.connected && ` · ${status.transport === "mock" ? "Mock" : "Physical"} · ${status.packets_sent} packets · state ${status.state_fresh ? "fresh" : "waiting"} · ${status.targets_received ?? 0} camera frames received`}
    </p>
    {!session && <div className="route-actions">
      {!status?.connected ? <Button disabled={connection.busy || (transport === "unitree-sdk2" && !ddsValid) || (transport === "unitree-rosbridge" && !bridgeValid)}
        onClick={() => void connection.connect(settings())}>
        {transport === "mock" ? "Connect mock robot" : "Connect physical robot"}
      </Button> : <>
        {status.armed ? <Button variant="recording" disabled={connection.busy || !connection.owned} onClick={() => void connection.action("disarm")}>Stop / disarm</Button>
          : <Button disabled={connection.busy || !connection.owned || !connection.streamReady || !status.state_fresh || !live} onClick={() => void connection.action("arm")}>Arm live control</Button>}
        <Button variant="secondary" disabled={connection.busy || !connection.owned} onClick={() => void connection.action("disconnect")}>Disconnect robot</Button>
      </>}
    </div>}
    {status?.connected && !status.armed && <p className="helper-text">Disarmed · motor commands are not being published. The visualization previews camera motion. {armBlock}</p>}
    {status?.connected && connection.streamReady && <p className="helper-text">
      {Object.keys(status.camera_target ?? {}).length ? "Live upper-body targets are reaching the backend."
        : "No fresh visible upper-body targets. Keep your selected arm or shoulders and hips in view."}
    </p>}
    {status?.connected && <RobotMotionDiagnostics status={status} />}
    <p className="helper-text">{matchPreview ? `Match preview candidate: arms up to ${Math.min(previewSpeed, 3)} rad/s and 10 rad/s², fixed at connect. Physical parity requires measured G1 validation.` : "Conservative motion uses the selected arm speed and 3 rad/s². Choose Match preview to evaluate the faster candidate."} Waist remains independently limited. URDF limits, two-second engagement, watchdogs and tracking-error release still apply. Use the robot’s local stop for an emergency.</p>
    </details>
    {connection.error && <p role="alert" className="helper-text">{connection.error}</p>}
    {status?.last_stream_error && !connection.error && <p role="alert" className="helper-text">{status.last_stream_error}</p>}
  </Panel>;
}
