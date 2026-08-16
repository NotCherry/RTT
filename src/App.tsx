import { useEffect, useMemo, useRef, useState } from "react";
import {
  createSession,
  exportUrl,
  loadDemoRobot,
  predictPose,
  trainSession,
  uploadRobot,
  websocketUrl,
} from "./api";
import { RobotScene } from "./RobotScene";
import type {
  Demonstration,
  Robot,
  SimulationState,
  TrainingConfig,
} from "./types";

const initialConfig: TrainingConfig = {
  hidden_layers: [64, 64],
  activation: "relu",
  learning_rate: 0.003,
  epochs: 300,
  batch_size: 16,
};

type TrainingMetric = { epoch: number; epochs: number; loss: number };

export default function App() {
  const [robot, setRobot] = useState<Robot | null>(null);
  const [state, setState] = useState<SimulationState | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [demonstrations, setDemonstrations] = useState<Demonstration[]>([]);
  const [config, setConfig] = useState<TrainingConfig>(initialConfig);
  const [metric, setMetric] = useState<TrainingMetric | null>(null);
  const [trained, setTrained] = useState(false);
  const [message, setMessage] = useState(
    "Load the sample robot or upload a primitive URDF.",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  const controllableJoints = useMemo(
    () => robot?.joints.filter((joint) => joint.controllable) ?? [],
    [robot],
  );
  const positions = state?.positions ?? controllableJoints.map(() => 0);
  const hiddenLayerText = config.hidden_layers.join(", ");

  useEffect(() => {
    if (!sessionId) return;
    const socket = new WebSocket(websocketUrl(sessionId));
    socketRef.current = socket;
    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data) as {
        type: string;
        positions?: number[];
        training?: boolean;
        epoch?: number;
        epochs?: number;
        loss?: number;
        message?: string;
      };
      if (payload.type === "state" && payload.positions) {
        setState({
          positions: payload.positions,
          training: payload.training ?? false,
        });
      } else if (
        payload.type === "training" &&
        payload.epoch &&
        payload.epochs &&
        payload.loss !== undefined
      ) {
        setMetric({
          epoch: payload.epoch,
          epochs: payload.epochs,
          loss: payload.loss,
        });
      } else if (payload.type === "training_complete") {
        setTrained(true);
        setMessage("Model trained. Generate a test pose to evaluate it.");
      } else if (payload.type === "warning") {
        setMessage(
          payload.message ??
            "The physics preview is running in kinematic mode.",
        );
      } else if (payload.type === "error") {
        setError(payload.message ?? "The backend reported an error.");
      }
    };
    socket.onerror = () =>
      setError(
        "Could not connect to the simulation stream. Is the backend running?",
      );
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [sessionId]);

  function send(payload: object) {
    if (socketRef.current?.readyState === WebSocket.OPEN)
      socketRef.current.send(JSON.stringify(payload));
  }

  async function openRobot(nextRobot: Robot) {
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(nextRobot.id);
      setRobot(nextRobot);
      setSessionId(session.session_id);
      setState(session.state);
      setDemonstrations([]);
      setMetric(null);
      setTrained(false);
      setMessage(
        `${nextRobot.name} is ready. Move the joints to create a demonstration.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to create a simulation session.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDemo() {
    setBusy(true);
    setError(null);
    try {
      await openRobot(await loadDemoRobot());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load the sample robot.",
      );
      setBusy(false);
    }
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await openRobot(await uploadRobot(file));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to parse that URDF.",
      );
      setBusy(false);
    }
    event.target.value = "";
  }

  function updateJoint(index: number, value: number) {
    const next = positions.map((position, positionIndex) =>
      positionIndex === index ? value : position,
    );
    setState((current) => ({
      positions: next,
      training: current?.training ?? false,
    }));
    send({ type: "set_positions", positions: next });
  }

  function resetPose() {
    const next = controllableJoints.map(() => 0);
    setState((current) => ({
      positions: next,
      training: current?.training ?? false,
    }));
    send({ type: "reset" });
  }

  function captureDemonstration() {
    if (!controllableJoints.length) return;
    const target = [...positions];
    setDemonstrations((current) => [
      ...current,
      { current: target.map(() => 0), target },
    ]);
    setMessage(
      `Captured target pose ${demonstrations.length + 1}. Capture a few different poses before training.`,
    );
  }

  async function startTraining() {
    if (!sessionId || demonstrations.length === 0) return;
    setBusy(true);
    setError(null);
    setMetric(null);
    try {
      await trainSession(sessionId, demonstrations, config);
      setMessage("Training started in the backend worker.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to start training.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function testModel() {
    if (!sessionId || !trained) return;
    setBusy(true);
    setError(null);
    try {
      const target = controllableJoints.map(
        (joint) => joint.lower + Math.random() * (joint.upper - joint.lower),
      );
      const result = await predictPose(
        sessionId,
        target,
        controllableJoints.map(() => 0),
      );
      setState((current) => ({
        positions: result.positions,
        training: current?.training ?? false,
      }));
      send({ type: "set_positions", positions: result.positions });
      setMessage(
        `Held-out pose predicted. Maximum joint error: ${result.error.toFixed(4)} rad/m.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to evaluate the model.",
      );
    } finally {
      setBusy(false);
    }
  }

  function updateConfig(key: keyof TrainingConfig, value: string) {
    if (key === "hidden_layers") {
      const layers = value
        .split(",")
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item) && item > 0);
      setConfig((current) => ({
        ...current,
        hidden_layers: layers.length ? layers : [32],
      }));
    } else if (key === "activation") {
      setConfig((current) => ({ ...current, activation: value }));
    } else {
      setConfig((current) => ({ ...current, [key]: Number(value) }));
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">⌁</div>
          <div>
            <div className="eyebrow">ROBOTICS LAB / 01</div>
            <h1>Learning Workbench</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <span className={`connection-pill ${sessionId ? "online" : ""}`}>
            <span className="status-dot" />
            {sessionId ? "Session live" : "No session"}
          </span>
          {sessionId && (
            <a className="button ghost small" href={exportUrl(sessionId)}>
              Export session
            </a>
          )}
        </div>
      </header>

      <section className="intro-row">
        <div>
          <p className="kicker">SIMULATION / BEHAVIOR CLONING</p>
          <h2>Teach a robot by showing it the pose.</h2>
          <p className="intro-copy">
            Upload a primitive URDF, tune its joints, and train a small policy
            in a transparent physics loop.
          </p>
        </div>
        <div className="workflow">
          <span className="workflow-step active">01 Load</span>
          <span>→</span>
          <span className={robot ? "workflow-step active" : "workflow-step"}>
            02 Demonstrate
          </span>
          <span>→</span>
          <span className={trained ? "workflow-step active" : "workflow-step"}>
            03 Evaluate
          </span>
        </div>
      </section>

      {error && (
        <div className="alert error">
          <strong>Attention</strong>
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}
      <section className="workbench-grid">
        <div className="viewer-column panel">
          <div className="panel-header">
            <div>
              <p className="panel-label">LIVE VIEWPORT</p>
              <h3>{robot?.name ?? "Awaiting robot"}</h3>
            </div>
            <div className="viewer-actions">
              <button
                className="button ghost small"
                onClick={resetPose}
                disabled={!robot}
              >
                Reset pose
              </button>
              <button
                className="button primary small"
                onClick={handleDemo}
                disabled={busy}
              >
                Open sample
              </button>
            </div>
          </div>
          <RobotScene robot={robot} state={state} />
          <div className="viewer-footer">
            <span>
              <i className="legend-swatch blue" /> Trainable joint
            </span>
            <span>
              <i className="legend-swatch gray" /> Fixed link
            </span>
            <span className="viewer-hint">Drag to orbit · Scroll to zoom</span>
          </div>
        </div>

        <aside className="controls-column panel">
          <div className="panel-header compact">
            <div>
              <p className="panel-label">ROBOT INPUT</p>
              <h3>Load a model</h3>
            </div>
            <span className="step-badge">01</span>
          </div>
          <label className="upload-zone">
            <input
              type="file"
              accept=".urdf,application/xml,text/xml"
              onChange={handleUpload}
            />
            <span className="upload-icon">↑</span>
            <strong>Drop a URDF file</strong>
            <span>Primitive geometry only · 5 MB max</span>
          </label>
          <div className="or-divider">
            <span>or</span>
          </div>
          <button
            className="button secondary full"
            onClick={handleDemo}
            disabled={busy}
          >
            Load the 2-joint sample arm
          </button>
          <div className="section-divider" />
          <div className="panel-header compact">
            <div>
              <p className="panel-label">JOINT CONTROLS</p>
              <h3>Pose editor</h3>
            </div>
            <span className="count-badge">
              {controllableJoints.length} active
            </span>
          </div>
          {controllableJoints.length === 0 && (
            <div className="empty-note">
              Joint sliders will appear after a valid robot is loaded.
            </div>
          )}
          <div className="joint-list">
            {controllableJoints.map((joint, index) => (
              <div className="joint-control" key={joint.name}>
                <div className="joint-meta">
                  <span>{joint.name}</span>
                  <code>{joint.type}</code>
                  <output>
                    {formatJoint(joint.type, positions[index] ?? 0)}
                  </output>
                </div>
                <input
                  aria-label={`${joint.name} position`}
                  type="range"
                  min={joint.lower}
                  max={joint.upper}
                  step="0.001"
                  value={positions[index] ?? 0}
                  onChange={(event) =>
                    updateJoint(index, Number(event.target.value))
                  }
                />
                <div className="range-labels">
                  <span>{formatJoint(joint.type, joint.lower)}</span>
                  <span>{formatJoint(joint.type, joint.upper)}</span>
                </div>
              </div>
            ))}
          </div>
          <button
            className="button primary full capture-button"
            onClick={captureDemonstration}
            disabled={!robot || !controllableJoints.length}
          >
            <span>＋</span> Capture target pose <b>{demonstrations.length}</b>
          </button>
          <p className="helper-text">
            Move the sliders, then capture a pose. Each example teaches the
            model a target within the joint limits.
          </p>
        </aside>

        <aside className="training-column panel">
          <div className="panel-header compact">
            <div>
              <p className="panel-label">MODEL TRAINING</p>
              <h3>Behavior cloning</h3>
            </div>
            <span
              className={`training-indicator ${state?.training ? "running" : ""}`}
            >
              <span className="status-dot" />
              {state?.training ? "Training" : "Idle"}
            </span>
          </div>
          <div className="metric-card">
            <div>
              <span className="metric-label">LATEST LOSS</span>
              <strong>{metric ? metric.loss.toFixed(5) : "—"}</strong>
            </div>
            <div>
              <span className="metric-label">PROGRESS</span>
              <strong>
                {metric ? `${metric.epoch}/${metric.epochs}` : "—"}
              </strong>
            </div>
          </div>
          <div className="field-grid">
            <label>
              <span>Hidden layers</span>
              <input
                value={hiddenLayerText}
                onChange={(event) =>
                  updateConfig("hidden_layers", event.target.value)
                }
              />
            </label>
            <label>
              <span>Activation</span>
              <select
                value={config.activation}
                onChange={(event) =>
                  updateConfig("activation", event.target.value)
                }
              >
                <option value="relu">ReLU</option>
                <option value="tanh">Tanh</option>
                <option value="gelu">GELU</option>
              </select>
            </label>
            <label>
              <span>Learning rate</span>
              <input
                type="number"
                min="0.000001"
                max="1"
                step="0.0001"
                value={config.learning_rate}
                onChange={(event) =>
                  updateConfig("learning_rate", event.target.value)
                }
              />
            </label>
            <label>
              <span>Epochs</span>
              <input
                type="number"
                min="1"
                max="5000"
                value={config.epochs}
                onChange={(event) => updateConfig("epochs", event.target.value)}
              />
            </label>
          </div>
          <div className="training-actions">
            <button
              className="button primary full"
              onClick={startTraining}
              disabled={
                !sessionId || !demonstrations.length || busy || state?.training
              }
            >
              Train network <span>↗</span>
            </button>
            <button
              className="button secondary full"
              onClick={testModel}
              disabled={!trained || busy}
            >
              Generate held-out test pose
            </button>
          </div>
          <div className="training-summary">
            <div>
              <span>Demonstrations</span>
              <strong>{demonstrations.length}</strong>
            </div>
            <div>
              <span>Inputs</span>
              <strong>{controllableJoints.length * 2}</strong>
            </div>
            <div>
              <span>Outputs</span>
              <strong>{controllableJoints.length}</strong>
            </div>
          </div>
          <div className="log-box">
            <span className="panel-label">SYSTEM LOG</span>
            <p>{message}</p>
            {metric && (
              <div className="progress-track">
                <span
                  style={{
                    width: `${Math.min(100, (metric.epoch / metric.epochs) * 100)}%`,
                  }}
                />
              </div>
            )}
          </div>
        </aside>
      </section>
      <footer className="footer">
        <span>FastAPI · PyBullet · PyTorch · Three.js</span>
        <span>Primitive URDF workbench / local session</span>
      </footer>
    </main>
  );
}

function formatJoint(type: string, value: number) {
  return type === "prismatic"
    ? `${value.toFixed(3)} m`
    : `${((value * 180) / Math.PI).toFixed(1)}°`;
}
