import { useEffect, useMemo, useRef, useState } from "react";
import {
  createSession,
  exportUrl,
  loadDemoRobot,
  predictPose,
  saveDemonstrations,
  trainSession,
  uploadRobot,
  websocketUrl,
} from "./api";
import { RobotScene } from "./RobotScene";
import {
  Button,
  Panel,
  PanelHeader,
  StatusPill,
  TabButton,
} from "./components/ui";
import type {
  Demonstration,
  DemonstrationFrame,
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
type EvaluationResult = {
  target: number[];
  positions: number[];
  error: number;
};
type RecordingDraft = {
  id: string;
  name: string;
  startedAt: number;
  frames: DemonstrationFrame[];
};

export default function App() {
  const [robot, setRobot] = useState<Robot | null>(null);
  const [state, setState] = useState<SimulationState | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [demonstrations, setDemonstrations] = useState<Demonstration[]>([]);
  const [config, setConfig] = useState<TrainingConfig>(initialConfig);
  const [metric, setMetric] = useState<TrainingMetric | null>(null);
  const [metricHistory, setMetricHistory] = useState<TrainingMetric[]>([]);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [trained, setTrained] = useState(false);
  const [message, setMessage] = useState(
    "Load the sample robot or upload a primitive URDF.",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "training" | "demonstrations" | "testing"
  >("training");
  const [selectedDemoId, setSelectedDemoId] = useState<string | null>(null);
  const [editingDemoId, setEditingDemoId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingFrameCount, setRecordingFrameCount] = useState(0);
  const [replayingDemoId, setReplayingDemoId] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const positionsRef = useRef<number[]>([]);
  const recordingRef = useRef<RecordingDraft | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const replayTimerRef = useRef<number | null>(null);

  const controllableJoints = useMemo(
    () => robot?.joints.filter((joint) => joint.controllable) ?? [],
    [robot],
  );
  const positions = state?.positions ?? controllableJoints.map(() => 0);
  const hiddenLayerText = config.hidden_layers.join(", ");

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    if (!recording) return;
    recordingTimerRef.current = window.setInterval(() => {
      const draft = recordingRef.current;
      if (!draft) return;
      draft.frames.push({
        timestamp: performance.now() - draft.startedAt,
        positions: [...positionsRef.current],
      });
      setRecordingFrameCount(draft.frames.length);
    }, 120);
    return () => {
      if (recordingTimerRef.current !== null) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, [recording]);

  useEffect(() => () => stopReplay(), []);

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
        const nextMetric = {
          epoch: payload.epoch,
          epochs: payload.epochs,
          loss: payload.loss,
        };
        setMetric(nextMetric);
        setMetricHistory((current) => [...current, nextMetric].slice(-80));
      } else if (payload.type === "training_complete") {
        setTrained(true);
        setMessage(
          "Model trained. Open Test to evaluate an archived demonstration.",
        );
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

  function persistDemonstrations(next: Demonstration[]) {
    setDemonstrations(next);
    if (!sessionId) return;
    void saveDemonstrations(sessionId, next).catch((cause) => {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save demonstrations.",
      );
    });
  }

  function applyPositions(next: number[]) {
    setState((current) => ({
      positions: next,
      training: current?.training ?? false,
    }));
    send({ type: "set_positions", positions: next });
  }

  function stopReplay() {
    if (replayTimerRef.current !== null) {
      window.clearTimeout(replayTimerRef.current);
      replayTimerRef.current = null;
    }
    setReplayingDemoId(null);
  }

  function startRecording() {
    if (!controllableJoints.length || recording) return;
    stopReplay();
    const id = `gesture-${Date.now()}`;
    const startedAt = performance.now();
    recordingRef.current = {
      id,
      name: `Gesture ${String(demonstrations.length + 1).padStart(2, "0")}`,
      startedAt,
      frames: [{ timestamp: 0, positions: [...positionsRef.current] }],
    };
    setRecordingFrameCount(1);
    setRecording(true);
    setActiveTab("demonstrations");
    setMessage(
      "Recording gesture. Move the joints, then stop recording to archive it.",
    );
  }

  function stopRecording() {
    const draft = recordingRef.current;
    if (!draft) return;
    const finalPositions = [...positionsRef.current];
    const elapsed = performance.now() - draft.startedAt;
    const frames = [
      ...draft.frames,
      { timestamp: elapsed, positions: finalPositions },
    ];
    const demonstration: Demonstration = {
      id: draft.id,
      name: draft.name,
      kind: "gesture",
      current: frames[0]?.positions ?? finalPositions,
      target: finalPositions,
      frames,
    };
    const next = [...demonstrations, demonstration];
    recordingRef.current = null;
    setRecording(false);
    setRecordingFrameCount(0);
    persistDemonstrations(next);
    setSelectedDemoId(demonstration.id);
    setTrained(false);
    setMessage(`Archived ${demonstration.name} with ${frames.length} frames.`);
  }

  function replayDemonstration(demonstration: Demonstration) {
    stopReplay();
    if (demonstration.frames.length < 2) {
      selectDemonstration(demonstration);
      setMessage(`${demonstration.name} is a static pose.`);
      return;
    }
    setSelectedDemoId(demonstration.id);
    setReplayingDemoId(demonstration.id);
    let frameIndex = 0;
    const playFrame = () => {
      const frame = demonstration.frames[frameIndex];
      if (!frame) {
        stopReplay();
        return;
      }
      applyPositions([...frame.positions]);
      frameIndex += 1;
      if (frameIndex >= demonstration.frames.length) {
        setReplayingDemoId(null);
        setMessage(`Finished replaying ${demonstration.name}.`);
        return;
      }
      const nextFrame = demonstration.frames[frameIndex];
      const delay = Math.max(
        40,
        Math.min(500, nextFrame.timestamp - frame.timestamp || 120),
      );
      replayTimerRef.current = window.setTimeout(playFrame, delay);
    };
    setMessage(`Replaying ${demonstration.name} in the viewport.`);
    playFrame();
  }

  async function openRobot(nextRobot: Robot) {
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(nextRobot.id);
      setRobot(nextRobot);
      setSessionId(session.session_id);
      setState(session.state);
      stopReplay();
      recordingRef.current = null;
      setRecording(false);
      setDemonstrations([]);
      setSelectedDemoId(null);
      setEditingDemoId(null);
      setActiveTab("training");
      setMetric(null);
      setMetricHistory([]);
      setEvaluation(null);
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
    const id = `demo-${Date.now()}`;
    const demonstration: Demonstration = {
      id,
      name: `Pose ${String(demonstrations.length + 1).padStart(2, "0")}`,
      kind: "pose",
      current: target.map(() => 0),
      target,
      frames: [{ timestamp: 0, positions: target }],
    };
    persistDemonstrations([...demonstrations, demonstration]);
    setSelectedDemoId(id);
    setTrained(false);
    setActiveTab("demonstrations");
    setMessage(`Captured ${demonstration.name}. Review it before training.`);
  }

  function selectDemonstration(demonstration: Demonstration) {
    setSelectedDemoId(demonstration.id);
    setState((current) => ({
      positions: [...demonstration.target],
      training: current?.training ?? false,
    }));
    send({ type: "set_positions", positions: demonstration.target });
  }

  function beginEditing(demonstration: Demonstration) {
    selectDemonstration(demonstration);
    setEditingDemoId(demonstration.id);
    setActiveTab("demonstrations");
    setMessage(`Editing ${demonstration.name}. Adjust the sliders, then save.`);
  }

  function saveEditedDemonstration() {
    if (!editingDemoId) return;
    const next = demonstrations.map((demonstration) =>
      demonstration.id === editingDemoId
        ? {
            ...demonstration,
            target: [...positions],
            current: positions.map(() => 0),
            frames:
              demonstration.kind === "pose"
                ? [{ timestamp: 0, positions: [...positions] }]
                : demonstration.frames,
          }
        : demonstration,
    );
    persistDemonstrations(next);
    setEditingDemoId(null);
    setTrained(false);
    setMessage("Demonstration updated. Retrain the model to use the new pose.");
  }

  function renameDemonstration(id: string, name: string) {
    persistDemonstrations(
      demonstrations.map((demonstration) =>
        demonstration.id === id
          ? { ...demonstration, name: name || "Untitled pose" }
          : demonstration,
      ),
    );
    setTrained(false);
  }

  function deleteDemonstration(id: string) {
    persistDemonstrations(
      demonstrations.filter((demonstration) => demonstration.id !== id),
    );
    if (selectedDemoId === id) setSelectedDemoId(null);
    if (editingDemoId === id) setEditingDemoId(null);
    setTrained(false);
    setMessage("Demonstration removed. Retrain the model to update it.");
  }

  function clearDemonstrations() {
    if (
      !demonstrations.length ||
      !window.confirm("Remove every captured demonstration?")
    )
      return;
    persistDemonstrations([]);
    setSelectedDemoId(null);
    setEditingDemoId(null);
    setTrained(false);
    setMessage("Dataset cleared. Capture new poses before training.");
  }

  async function startTraining() {
    if (!sessionId || demonstrations.length === 0) return;
    setBusy(true);
    setError(null);
    setMetric(null);
    setMetricHistory([]);
    setEvaluation(null);
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
    if (!sessionId || !trained || !demonstrations.length) return;
    const demonstration =
      demonstrations.find((item) => item.id === selectedDemoId) ??
      demonstrations[0];
    setBusy(true);
    setError(null);
    try {
      const result = await predictPose(
        sessionId,
        demonstration.target,
        demonstration.current,
      );
      setEvaluation(result);
      applyPositions(result.positions);
      setActiveTab("testing");
      setMessage(
        `Evaluated ${demonstration.name}. Maximum joint error: ${result.error.toFixed(4)} native units.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to evaluate the demonstration.",
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
          <StatusPill online={Boolean(sessionId)}>
            {sessionId ? "Session live" : "No session"}
          </StatusPill>
          {sessionId && (
            <a className="button ghost small" href={exportUrl(sessionId)}>
              Export session
            </a>
          )}
        </div>
      </header>

      <section className="intro-row">
        <div>
          <p className="kicker">SIMULATION / DEMONSTRATION STUDIO</p>
          <h2>Teach a robot by recording the behavior.</h2>
          <p className="intro-copy">
            Upload a primitive URDF, record poses or gestures, archive the
            expected behavior, and train a small policy when you are ready.
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
        <Panel className="viewer-column">
          <PanelHeader>
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
          </PanelHeader>
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
        </Panel>

        <Panel className="controls-column">
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
          <div className="capture-actions">
            <Button
              variant="primary"
              full
              className="capture-button"
              onClick={captureDemonstration}
              disabled={!robot || !controllableJoints.length || recording}
              type="button"
            >
              <span>＋</span> Capture pose <b>{demonstrations.length}</b>
            </Button>
            {recording ? (
              <Button
                variant="recording"
                full
                onClick={stopRecording}
                type="button"
              >
                <span className="recording-dot" /> Stop recording ·{" "}
                {recordingFrameCount} frames
              </Button>
            ) : (
              <Button
                variant="secondary"
                full
                onClick={startRecording}
                disabled={!robot || !controllableJoints.length}
                type="button"
              >
                Record gesture
              </Button>
            )}
          </div>
          <p className="helper-text">
            Capture a static pose or record a timestamped gesture. Recorded
            frames are archived with the demonstration.
          </p>
        </Panel>

        <Panel className="training-column">
          <PanelHeader compact>
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
          </PanelHeader>
          <div
            className="tab-switcher"
            role="tablist"
            aria-label="Training workspace"
          >
            <TabButton
              active={activeTab === "training"}
              onClick={() => setActiveTab("training")}
              role="tab"
              aria-selected={activeTab === "training"}
              type="button"
            >
              Train
            </TabButton>
            <TabButton
              active={activeTab === "demonstrations"}
              onClick={() => setActiveTab("demonstrations")}
              role="tab"
              aria-selected={activeTab === "demonstrations"}
              type="button"
            >
              Demonstrations <span>{demonstrations.length}</span>
            </TabButton>
            <TabButton
              active={activeTab === "testing"}
              onClick={() => setActiveTab("testing")}
              role="tab"
              aria-selected={activeTab === "testing"}
              type="button"
            >
              Test
            </TabButton>
          </div>
          {activeTab === "training" ? (
            <>
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
                    onChange={(event) =>
                      updateConfig("epochs", event.target.value)
                    }
                  />
                </label>
              </div>
              <div className="training-actions">
                <button
                  className="button primary full"
                  onClick={startTraining}
                  disabled={
                    !sessionId ||
                    !demonstrations.length ||
                    busy ||
                    state?.training
                  }
                >
                  Train network <span>↗</span>
                </button>
                <button
                  className="button secondary full"
                  onClick={testModel}
                  disabled={!trained || !demonstrations.length || busy}
                >
                  Evaluate selected demonstration
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
            </>
          ) : activeTab === "demonstrations" ? (
            <div className="demonstrations-panel">
              <div className="demo-toolbar">
                <div>
                  <p className="panel-label">DEMONSTRATION ARCHIVE</p>
                  <strong>
                    {demonstrations.length} captured item
                    {demonstrations.length === 1 ? "" : "s"}
                  </strong>
                </div>
                <button
                  className="button ghost small"
                  onClick={clearDemonstrations}
                  disabled={!demonstrations.length}
                >
                  Clear all
                </button>
              </div>
              {demonstrations.length ? (
                <div className="demo-list">
                  {demonstrations.map((demonstration, demoIndex) => (
                    <article
                      className={`demo-card ${selectedDemoId === demonstration.id ? "selected" : ""}`}
                      key={demonstration.id}
                      onClick={() => selectDemonstration(demonstration)}
                    >
                      <div className="demo-card-top">
                        <PoseSketch target={demonstration.target} />
                        <div className="demo-card-heading">
                          <input
                            value={demonstration.name}
                            aria-label={`Name for demonstration ${demoIndex + 1}`}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              renameDemonstration(
                                demonstration.id,
                                event.target.value,
                              )
                            }
                          />
                          <span>
                            {demonstration.kind === "gesture"
                              ? "Gesture"
                              : "Pose"}{" "}
                            {String(demoIndex + 1).padStart(2, "0")} ·{" "}
                            {demonstration.frames.length} frame
                            {demonstration.frames.length === 1 ? "" : "s"} ·{" "}
                            {selectedDemoId === demonstration.id
                              ? "selected"
                              : "click to preview"}
                          </span>
                        </div>
                        <button
                          className="icon-button"
                          aria-label={`Delete ${demonstration.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteDemonstration(demonstration.id);
                          }}
                        >
                          ×
                        </button>
                      </div>
                      <div className="demo-bars">
                        {demonstration.target.map((value, index) => {
                          const joint = controllableJoints[index];
                          const range = Math.max(
                            joint ? joint.upper - joint.lower : 1,
                            0.001,
                          );
                          const progress = Math.max(
                            0,
                            Math.min(
                              100,
                              ((value - (joint?.lower ?? 0)) / range) * 100,
                            ),
                          );
                          return (
                            <div
                              className="demo-bar-row"
                              key={`${demonstration.id}-${index}`}
                            >
                              <span>{joint?.name ?? `joint ${index + 1}`}</span>
                              <i>
                                <b style={{ width: `${progress}%` }} />
                              </i>
                              <output>
                                {joint
                                  ? formatJoint(joint.type, value)
                                  : value.toFixed(2)}
                              </output>
                            </div>
                          );
                        })}
                      </div>
                      <div className="demo-card-actions">
                        <button
                          className="button ghost small"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (replayingDemoId === demonstration.id) {
                              stopReplay();
                            } else {
                              replayDemonstration(demonstration);
                            }
                          }}
                        >
                          {replayingDemoId === demonstration.id
                            ? "Stop replay"
                            : demonstration.kind === "gesture"
                              ? "Replay gesture"
                              : "Preview pose"}
                        </button>
                        <button
                          className="button secondary small"
                          onClick={(event) => {
                            event.stopPropagation();
                            beginEditing(demonstration);
                          }}
                        >
                          {editingDemoId === demonstration.id
                            ? "Editing…"
                            : "Edit pose"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="demo-empty">
                  <span className="demo-empty-icon">✦</span>
                  <strong>No demonstrations yet</strong>
                  <span>
                    Move the sliders and capture a target pose to start a
                    dataset.
                  </span>
                  <button
                    className="button secondary small"
                    onClick={() => setActiveTab("training")}
                  >
                    Back to pose editor
                  </button>
                </div>
              )}
              {editingDemoId && (
                <div className="edit-banner">
                  <span>Editing selected pose with the sliders.</span>
                  <div>
                    <button
                      className="button ghost small"
                      onClick={() => setEditingDemoId(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="button primary small"
                      onClick={saveEditedDemonstration}
                    >
                      Save changes
                    </button>
                  </div>
                </div>
              )}
              {demonstrations.length > 0 && !editingDemoId && (
                <p className="helper-text demo-helper">
                  Select a card to preview it. Edit loads that pose into the
                  joint sliders; changing the dataset requires retraining.
                </p>
              )}
            </div>
          ) : (
            <div className="testing-panel">
              <div className="test-heading">
                <div>
                  <p className="panel-label">MODEL TEST</p>
                  <strong>
                    {trained
                      ? "Evaluate an archived demonstration"
                      : "Train a model first"}
                  </strong>
                </div>
                <span className={`test-status ${trained ? "ready" : ""}`}>
                  {trained ? "Ready" : "Waiting"}
                </span>
              </div>
              <button
                className="button primary full"
                onClick={testModel}
                disabled={!trained || !demonstrations.length || busy}
              >
                Evaluate selected demonstration
              </button>
              <div className="chart-card">
                <div className="chart-header">
                  <span className="panel-label">TRAINING LOSS</span>
                  <span>
                    {metric ? `${metric.epoch}/${metric.epochs}` : "No run yet"}
                  </span>
                </div>
                <div className="loss-chart" aria-label="Training loss chart">
                  {metricHistory.length ? (
                    metricHistory.map((point, index) => (
                      <span
                        key={`${point.epoch}-${index}`}
                        title={`Epoch ${point.epoch}: ${point.loss.toFixed(5)}`}
                        style={{
                          height: `${Math.max(8, Math.min(100, (point.loss / Math.max(metricHistory[0].loss, 0.000001)) * 100))}%`,
                        }}
                      />
                    ))
                  ) : (
                    <div className="chart-empty">
                      Training metrics will appear here.
                    </div>
                  )}
                </div>
                <div className="chart-footer">
                  <span>
                    Latest <b>{metric ? metric.loss.toFixed(5) : "—"}</b>
                  </span>
                  <span>
                    Epochs <b>{metric ? metric.epoch : "—"}</b>
                  </span>
                </div>
              </div>
              {evaluation ? (
                <div className="evaluation-card">
                  <div className="chart-header">
                    <span className="panel-label">SELECTED DEMONSTRATION</span>
                    <strong>Prediction error</strong>
                  </div>
                  <div className="evaluation-summary">
                    <span>
                      Mean{" "}
                      <b>
                        {meanError(
                          evaluation.target,
                          evaluation.positions,
                        ).toFixed(4)}
                      </b>
                    </span>
                    <span>
                      Maximum <b>{evaluation.error.toFixed(4)}</b>
                    </span>
                  </div>
                  <div className="error-list">
                    {evaluation.target.map((target, index) => {
                      const joint = controllableJoints[index];
                      const absoluteError = Math.abs(
                        target - (evaluation.positions[index] ?? 0),
                      );
                      const range = Math.max(
                        (joint?.upper ?? 1) - (joint?.lower ?? 0),
                        0.001,
                      );
                      return (
                        <div
                          className="error-row"
                          key={`${joint?.name ?? "joint"}-${index}`}
                        >
                          <span>{joint?.name ?? `joint ${index + 1}`}</span>
                          <i>
                            <b
                              style={{
                                width: `${Math.min(100, (absoluteError / range) * 100) * 3}%`,
                              }}
                            />
                          </i>
                          <output>
                            {joint
                              ? formatJoint(joint.type, absoluteError)
                              : absoluteError.toFixed(4)}
                          </output>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="test-empty">
                  Select a demonstration and evaluate it to compare the expected
                  pose with the model prediction.
                </div>
              )}
            </div>
          )}
        </Panel>
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

function meanError(target: number[], positions: number[]) {
  if (!target.length) return 0;
  return (
    target.reduce(
      (total, value, index) =>
        total + Math.abs(value - (positions[index] ?? 0)),
      0,
    ) / target.length
  );
}

function PoseSketch({ target }: { target: number[] }) {
  const firstAngle = -Math.PI / 2 + (target[0] ?? 0);
  const secondAngle = firstAngle + (target[1] ?? 0);
  const shoulder = {
    x: 29 + Math.cos(firstAngle) * 15,
    y: 25 + Math.sin(firstAngle) * 15,
  };
  const wrist = {
    x: shoulder.x + Math.cos(secondAngle) * 13,
    y: shoulder.y + Math.sin(secondAngle) * 13,
  };
  return (
    <div className="pose-sketch" aria-hidden="true">
      <svg viewBox="0 0 58 50">
        <path d="M8 42h42" />
        <line x1="29" y1="25" x2={shoulder.x} y2={shoulder.y} />
        <line x1={shoulder.x} y1={shoulder.y} x2={wrist.x} y2={wrist.y} />
        <circle cx="29" cy="25" r="3" />
        <circle cx={shoulder.x} cy={shoulder.y} r="2.5" />
        <circle cx={wrist.x} cy={wrist.y} r="2.2" />
      </svg>
    </div>
  );
}
