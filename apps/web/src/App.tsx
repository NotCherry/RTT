import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  useLocation,
} from "react-router-dom";
import {
  createSession,
  exportUrl,
  loadDemoRobot,
  predictPose,
  rolloutSession,
  saveDatasets,
  saveDemonstrations,
  trainSession,
  uploadRobot,
  websocketUrl,
} from "./api";
import { RobotScene } from "./RobotScene";
import {
  formatJointValue as formatJoint,
  meanAbsoluteError as meanError,
} from "./domain/metrics";
import {
  framesToKeyframes,
  interpolatePositions,
  keyframesToFrames,
  normalizeFrames,
} from "./domain/timeline";
import {
  Button,
  Panel,
  PanelHeader,
  PanelLabel,
  StatusPill,
  TabButton,
} from "./components/ui";
import { useWorkbench, WorkbenchProvider } from "./workbench/context";
import type {
  Dataset,
  Demonstration,
  DemonstrationFrame,
  Joint,
  Robot,
  RolloutFrame,
  SimulationState,
  TrainingConfig,
} from "./types";

const initialConfig: TrainingConfig = {
  hidden_layers: [64, 64],
  activation: "relu",
  learning_rate: 0.003,
  epochs: 300,
  batch_size: 16,
  timestep_ms: 120,
  random_starts: 4,
  random_seed: 7,
  rollout_steps: 160,
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
  return (
    <BrowserRouter>
      <Workbench />
    </BrowserRouter>
  );
}

function Workbench() {
  const location = useLocation();
  const [robot, setRobot] = useState<Robot | null>(null);
  const [state, setState] = useState<SimulationState | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [demonstrations, setDemonstrations] = useState<Demonstration[]>([]);
  const [config, setConfig] = useState<TrainingConfig>(initialConfig);
  const [metric, setMetric] = useState<TrainingMetric | null>(null);
  const [metricHistory, setMetricHistory] = useState<TrainingMetric[]>([]);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [rolloutFrames, setRolloutFrames] = useState<RolloutFrame[]>([]);
  const [trained, setTrained] = useState(false);
  const [message, setMessage] = useState(
    "Load the sample robot or upload a primitive URDF.",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "training" | "timeline" | "demonstrations" | "datasets" | "testing"
  >("training");
  const [selectedDemoId, setSelectedDemoId] = useState<string | null>(null);
  const [editingDemoId, setEditingDemoId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingFrameCount, setRecordingFrameCount] = useState(0);
  const [recordingFrames, setRecordingFrames] = useState<DemonstrationFrame[]>(
    [],
  );
  const [selectedFrameIndex, setSelectedFrameIndex] = useState(0);
  const [timelineDraft, setTimelineDraft] = useState<DemonstrationFrame[] | null>(
    null,
  );
  const [timelineDraftSourceId, setTimelineDraftSourceId] = useState<
    string | null
  >(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null);
  const [replayingDemoId, setReplayingDemoId] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const positionsRef = useRef<number[]>([]);
  const recordingRef = useRef<RecordingDraft | null>(null);
  const replayTimerRef = useRef<number | null>(null);

  const controllableJoints = useMemo(
    () => robot?.joints.filter((joint) => joint.controllable) ?? [],
    [robot],
  );
  const positions = state?.positions ?? controllableJoints.map(() => 0);
  const hiddenLayerText = config.hidden_layers.join(", ");
  const timelineDemonstration = demonstrations.find(
    (demonstration) =>
      demonstration.id === selectedDemoId && demonstration.kind === "gesture",
  );
  const timelineSourceFrames = useMemo(
    () =>
      normalizeFrames(
        timelineDemonstration?.keyframes?.length
          ? keyframesToFrames(
              timelineDemonstration.keyframes,
              timelineDemonstration.timeline_fps ?? 30,
            )
          : (timelineDemonstration?.frames ?? []),
      ),
    [timelineDemonstration],
  );
  const timelineFrames = useMemo(() => {
    if (recording) return normalizeFrames(recordingFrames);
    if (timelineDraft !== null) return timelineDraft;
    return timelineSourceFrames;
  }, [recording, recordingFrames, timelineDraft, timelineSourceFrames]);
  const timelineDirty =
    timelineDraft !== null &&
    JSON.stringify(timelineDraft) !== JSON.stringify(timelineSourceFrames);

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    if (recording) return;
    if (!timelineDemonstration) {
      setTimelineDraft(null);
      setTimelineDraftSourceId(null);
      return;
    }
    if (timelineDraftSourceId !== timelineDemonstration.id) {
      setTimelineDraft(timelineSourceFrames.map((f) => ({ ...f, positions: [...f.positions] })));
      setTimelineDraftSourceId(timelineDemonstration.id);
      setSelectedFrameIndex(0);
    }
  }, [timelineDemonstration, timelineSourceFrames, timelineDraftSourceId, recording]);

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

  function persistDatasets(next: Dataset[]) {
    setDatasets(next);
    if (!sessionId) return;
    void saveDatasets(sessionId, next).catch((cause) => {
      setError(
        cause instanceof Error ? cause.message : "Unable to save datasets.",
      );
    });
  }

  function persistDemonstrations(next: Demonstration[]) {
    setDemonstrations(next);
    const previousIds = new Set(
      demonstrations.map((demonstration) => demonstration.id),
    );
    const retainedIds = new Set(next.map((demonstration) => demonstration.id));
    const newIds = next
      .filter((demonstration) => !previousIds.has(demonstration.id))
      .map((demonstration) => demonstration.id);
    const nextDatasets = datasets.map((dataset) => {
      const members = dataset.demonstration_ids.filter((id) =>
        retainedIds.has(id),
      );
      return {
        ...dataset,
        demonstration_ids:
          dataset.id === activeDatasetId
            ? [...new Set([...members, ...newIds])]
            : members,
        updated_at: new Date().toISOString(),
      };
    });
    if (!sessionId) {
      if (nextDatasets.length) setDatasets(nextDatasets);
      return;
    }
    void saveDemonstrations(sessionId, next)
      .then(() => {
        if (nextDatasets.length) persistDatasets(nextDatasets);
      })
      .catch((cause) => {
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to save demonstrations.",
        );
      });
  }

  function moveDemonstration(demonstrationId: string, datasetId: string) {
    const nextDemonstrations = demonstrations.map((demonstration) =>
      demonstration.id === demonstrationId
        ? { ...demonstration, dataset_id: datasetId }
        : demonstration,
    );
    const nextDatasets = datasets.map((dataset) => ({
      ...dataset,
      demonstration_ids:
        dataset.id === datasetId
          ? [...new Set([...dataset.demonstration_ids, demonstrationId])]
          : dataset.demonstration_ids.filter((id) => id !== demonstrationId),
      updated_at: new Date().toISOString(),
    }));
    setDemonstrations(nextDemonstrations);
    if (sessionId) {
      void saveDemonstrations(sessionId, nextDemonstrations)
        .then(() => persistDatasets(nextDatasets))
        .catch((cause) => {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to move demonstration.",
          );
        });
    } else {
      persistDatasets(nextDatasets);
    }
    setActiveDatasetId(datasetId);
    setMessage("Demonstration moved to the selected dataset.");
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

  function replaceTimelineFrames(nextFrames: DemonstrationFrame[]) {
    const next = normalizeFrames(nextFrames);
    if (recording && recordingRef.current) {
      recordingRef.current.frames = next;
      setRecordingFrames(next);
      setRecordingFrameCount(next.length);
      return;
    }
    if (!timelineDemonstration) return;
    // Isolated draft — pose tab live state stays independent until Save.
    setTimelineDraft(next);
  }

  function saveTimelineDraft() {
    if (!timelineDemonstration || timelineDraft === null) return;
    const next = normalizeFrames(timelineDraft);
    const target = next[next.length - 1]?.positions ?? positions;
    persistDemonstrations(
      demonstrations.map((demonstration) =>
        demonstration.id === timelineDemonstration.id
          ? {
              ...demonstration,
              current: next[0]?.positions ?? target,
              target,
              frames: next,
              keyframes: framesToKeyframes(next),
              timeline_fps: 30,
              duration_frames: Math.round(
                ((next[next.length - 1]?.timestamp ?? 0) * 30) / 1000,
              ),
            }
          : demonstration,
      ),
    );
    setMessage(`Saved ${next.length} keyframes to ${timelineDemonstration.name}. Training will use the updated motion.`);
    setTrained(false);
  }

  function discardTimelineDraft() {
    if (!timelineDemonstration) return;
    setTimelineDraft(timelineSourceFrames.map((f) => ({ ...f, positions: [...f.positions] })));
    setSelectedFrameIndex(0);
    setMessage("Discarded timeline edits.");
  }

  function captureCheckpoint() {
    if (!controllableJoints.length) return;
    if (!recording && !timelineDemonstration) {
      startRecording();
      return;
    }
    const timestamp = recording
      ? performance.now() -
        (recordingRef.current?.startedAt ?? performance.now())
      : (timelineFrames[timelineFrames.length - 1]?.timestamp ?? 0) + 500;
    replaceTimelineFrames([
      ...timelineFrames,
      { timestamp, positions: [...positionsRef.current] },
    ]);
    setSelectedFrameIndex(Math.max(0, timelineFrames.length));
    setMessage(`Captured checkpoint ${timelineFrames.length + 1}.`);
  }

  function selectTimelineFrame(index: number) {
    const frame = timelineFrames[index];
    if (!frame) return;
    setSelectedFrameIndex(index);
    applyPositions([...frame.positions]);
  }

  function updateTimelineFrame(
    frameIndex: number,
    jointIndex: number,
    value: number,
  ) {
    const nextFrames = timelineFrames.map((frame, index) =>
      index === frameIndex
        ? {
            ...frame,
            positions: frame.positions.map((position, positionIndex) =>
              positionIndex === jointIndex ? value : position,
            ),
          }
        : frame,
    );
    replaceTimelineFrames(nextFrames);
    const updatedFrame = nextFrames[frameIndex];
    if (frameIndex === selectedFrameIndex && updatedFrame) {
      applyPositions([...updatedFrame.positions]);
    }
  }

  function updateTimelineTimestamp(frameIndex: number, value: number) {
    const clamped = Math.max(0, value);
    // Avoid immediate resort flicker: update draft then normalize will sort.
    const next = timelineFrames.map((frame, index) =>
      index === frameIndex ? { ...frame, timestamp: clamped } : frame,
    );
    replaceTimelineFrames(next);
    // Keep selection on same logical keyframe after sort by finding nearest timestamp.
    const sorted = normalizeFrames(next);
    const moved = sorted.findIndex((f) => f.timestamp === clamped);
    if (moved >= 0) setSelectedFrameIndex(moved);
  }

  function deleteTimelineFrame(frameIndex: number) {
    if (timelineFrames.length <= 1) return;
    const next = timelineFrames.filter((_, index) => index !== frameIndex);
    replaceTimelineFrames(next);
    setSelectedFrameIndex(Math.min(frameIndex, Math.max(0, next.length - 1)));
    setMessage(`Removed keyframe ${frameIndex + 1}. Save to persist.`);
  }

  function duplicateTimelineFrame(frameIndex: number) {
    const frame = timelineFrames[frameIndex];
    if (!frame) return;
    const copy: DemonstrationFrame = {
      timestamp: frame.timestamp + 120,
      positions: [...frame.positions],
    };
    const next = [...timelineFrames];
    next.splice(frameIndex + 1, 0, copy);
    replaceTimelineFrames(next);
    setSelectedFrameIndex(frameIndex + 1);
  }

  function previewTimelineFrame(index: number) {
    const frame = timelineFrames[index];
    if (!frame) return;
    applyPositions([...frame.positions]);
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
    setRecordingFrames(recordingRef.current.frames);
    setRecordingFrameCount(1);
    setRecording(true);
    setActiveTab("timeline");
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
      keyframes: framesToKeyframes(frames),
      timeline_fps: 30,
      duration_frames: Math.round(
        ((frames[frames.length - 1]?.timestamp ?? 0) * 30) / 1000,
      ),
      start_frame_index: 0,
      dataset_id: activeDatasetId ?? undefined,
    };
    const next = [...demonstrations, demonstration];
    recordingRef.current = null;
    setRecording(false);
    setRecordingFrames([]);
    setRecordingFrameCount(0);
    persistDemonstrations(next);
    setSelectedDemoId(demonstration.id);
    setTrained(false);
    setMessage(`Archived ${demonstration.name} with ${frames.length} frames.`);
  }

  function replayFrames(frames: RolloutFrame[], label: string) {
    stopReplay();
    if (!frames.length) return;
    setReplayingDemoId("evaluation");
    let frameIndex = 0;
    const playFrame = () => {
      const frame = frames[frameIndex];
      if (!frame) {
        stopReplay();
        return;
      }
      applyPositions([...frame.positions]);
      frameIndex += 1;
      if (frameIndex >= frames.length) {
        setReplayingDemoId(null);
        setMessage(`Finished replaying ${label}.`);
        return;
      }
      const nextFrame = frames[frameIndex];
      replayTimerRef.current = window.setTimeout(
        playFrame,
        Math.max(
          40,
          Math.min(500, nextFrame.timestamp - frame.timestamp || 120),
        ),
      );
    };
    setMessage(`Replaying ${label} through the viewport.`);
    playFrame();
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
      applyPositions(
        interpolatePositions(demonstration.frames, frame.timestamp),
      );
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
      const datasetId = `dataset-${Date.now()}`;
      const now = new Date().toISOString();
      setDatasets([
        {
          id: datasetId,
          name: "Untitled dataset",
          demonstration_ids: [],
          created_at: now,
          updated_at: now,
        },
      ]);
      setActiveDatasetId(datasetId);
      setSelectedDemoId(null);
      setSelectedFrameIndex(0);
      setRecordingFrames([]);
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
      keyframes: framesToKeyframes([{ timestamp: 0, positions: target }]),
      timeline_fps: 30,
      duration_frames: 0,
      start_frame_index: 0,
      dataset_id: activeDatasetId ?? undefined,
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
    setActiveTab(
      demonstration.kind === "gesture" ? "timeline" : "demonstrations",
    );
    setMessage(
      demonstration.kind === "gesture"
        ? `Editing ${demonstration.name} checkpoints in the timeline.`
        : `Editing ${demonstration.name}. Adjust the pose editor, then save.`,
    );
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
            keyframes:
              demonstration.kind === "pose"
                ? framesToKeyframes([
                    { timestamp: 0, positions: [...positions] },
                  ])
                : demonstration.keyframes,
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
    setRolloutFrames([]);
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
      if (demonstration.kind === "gesture" && demonstration.frames.length > 1) {
        const result = await rolloutSession(
          sessionId,
          demonstration.frames,
          demonstration.current,
          config.timestep_ms,
          config.rollout_steps,
        );
        const finalFrame = result.frames[result.frames.length - 1];
        if (!finalFrame) throw new Error("The rollout returned no frames.");
        const error = Math.max(
          ...finalFrame.positions.map((position, index) =>
            Math.abs(position - (finalFrame.expected[index] ?? position)),
          ),
        );
        setRolloutFrames(result.frames);
        setEvaluation({
          target: finalFrame.expected,
          positions: finalFrame.positions,
          error,
        });
        applyPositions(finalFrame.positions);
        setActiveTab("testing");
        setMessage(
          `Rolled out ${demonstration.name} through ${result.frames.length} incremental frames. Maximum error: ${error.toFixed(4)} native units.`,
        );
      } else {
        const result = await predictPose(
          sessionId,
          demonstration.target,
          demonstration.current,
        );
        setRolloutFrames([]);
        setEvaluation(result);
        applyPositions(result.positions);
        setActiveTab("testing");
        setMessage(
          `Evaluated ${demonstration.name}. Maximum joint error: ${result.error.toFixed(4)} native units.`,
        );
      }
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

  const routePage = (() => {
    if (location.pathname === "/") return <Navigate to="/teach/pose" replace />;
    if (
      ![
        "/teach/pose",
        "/teach/timeline",
        "/archive",
        "/train",
        "/evaluate",
      ].includes(location.pathname)
    ) {
      return <Navigate to="/teach/pose" replace />;
    }
    if (location.pathname === "/teach/timeline") {
      return (
        <div className="route-page">
          <div className="route-heading">
            <div>
              <p className="kicker">TEACH / KEYFRAME ANIMATION</p>
              <h2>Author the robot motion.</h2>
              <p className="intro-copy">
                Insert full-pose keyframes on a Blender-style timeline, then
                preview the interpolated gesture.
              </p>
            </div>
            <StatusPill online={recording}>
              {recording ? "Keyframe capture" : "Timeline ready"}
            </StatusPill>
          </div>
          <div className="route-two-column">
            <Panel className="route-viewport-panel">
              <PanelHeader>
                <div>
                  <PanelLabel>LIVE VIEWPORT</PanelLabel>
                  <h3>{robot?.name ?? "Awaiting robot"}</h3>
                </div>
                <Button
                  size="small"
                  variant="secondary"
                  onClick={resetPose}
                  disabled={!robot}
                >
                  Reset pose
                </Button>
              </PanelHeader>
              <RobotScene robot={robot} state={state} />
            </Panel>
            <Panel className="route-content-panel">
              <PanelHeader>
                <div>
                  <PanelLabel>ANIMATION EDITOR</PanelLabel>
                  <h3>Gesture keyframes</h3>
                </div>
                <span className="count-badge">
                  {timelineFrames.length} keys
                </span>
              </PanelHeader>
              <TimelinePanel
                frames={timelineFrames}
                joints={controllableJoints}
                recording={recording}
                selectedFrameIndex={selectedFrameIndex}
                dirty={timelineDirty}
                hasSelection={Boolean(timelineDemonstration)}
                onCapture={captureCheckpoint}
                onSelectFrame={selectTimelineFrame}
                onUpdateFrame={updateTimelineFrame}
                onUpdateTimestamp={updateTimelineTimestamp}
                onDeleteFrame={deleteTimelineFrame}
                onDuplicateFrame={duplicateTimelineFrame}
                onPreviewFrame={previewTimelineFrame}
                onSave={saveTimelineDraft}
                onDiscard={discardTimelineDraft}
                onStartRecording={startRecording}
                onStopRecording={stopRecording}
              />
            </Panel>
          </div>
        </div>
      );
    }
    if (location.pathname === "/archive") {
      return (
        <div className="route-page">
          <div className="route-heading">
            <div>
              <p className="kicker">ARCHIVE / DATASETS</p>
              <h2>Organize expected behavior.</h2>
              <p className="intro-copy">
                Keep poses and authored gestures grouped by robot and training
                purpose.
              </p>
            </div>
          </div>
          <div className="route-archive-grid">
            <Panel className="route-content-panel">
              <DatasetPanel
                datasets={datasets}
                activeDatasetId={activeDatasetId}
                demonstrations={demonstrations}
                onSelect={setActiveDatasetId}
                onCreate={() => {
                  const now = new Date().toISOString();
                  const dataset = {
                    id: `dataset-${Date.now()}`,
                    name: `Dataset ${datasets.length + 1}`,
                    demonstration_ids: demonstrations.map((item) => item.id),
                    created_at: now,
                    updated_at: now,
                  };
                  persistDatasets([...datasets, dataset]);
                  setActiveDatasetId(dataset.id);
                }}
                onRename={(datasetId, name) =>
                  persistDatasets(
                    datasets.map((dataset) =>
                      dataset.id === datasetId
                        ? {
                            ...dataset,
                            name,
                            updated_at: new Date().toISOString(),
                          }
                        : dataset,
                    ),
                  )
                }
                onMoveDemonstration={moveDemonstration}
              />
            </Panel>
            <Panel className="route-content-panel archive-demo-panel">
              <PanelHeader>
                <div>
                  <PanelLabel>DEMONSTRATIONS</PanelLabel>
                  <h3>{demonstrations.length} captured items</h3>
                </div>
                <Link className="button secondary small" to="/teach/pose">
                  New pose
                </Link>
              </PanelHeader>
              <div className="archive-route-list">
                {demonstrations.length ? (
                  demonstrations.map((demonstration) => (
                    <article
                      className="archive-route-card"
                      key={demonstration.id}
                    >
                      <div>
                        <strong>{demonstration.name}</strong>
                        <span>
                          {demonstration.kind} ·{" "}
                          {demonstration.keyframes?.length ??
                            demonstration.frames.length}{" "}
                          authored keyframes
                        </span>
                      </div>
                      <div className="demo-card-actions">
                        <Button
                          size="small"
                          variant="ghost"
                          onClick={() => {
                            setSelectedDemoId(demonstration.id);
                            selectDemonstration(demonstration);
                          }}
                        >
                          Preview
                        </Button>
                        {demonstration.kind === "gesture" && (
                          <Link
                            className="button secondary small"
                            to="/teach/timeline"
                            onClick={() => {
                              setSelectedDemoId(demonstration.id);
                            }}
                          >
                            Edit timeline
                          </Link>
                        )}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="demo-empty">
                    <strong>No demonstrations yet</strong>
                    <span>Capture a pose or author a gesture timeline.</span>
                  </div>
                )}
              </div>
            </Panel>
          </div>
        </div>
      );
    }
    if (location.pathname === "/train") {
      return (
        <div className="route-page">
          <div className="route-heading">
            <div>
              <p className="kicker">TRAIN / TEMPORAL MLP</p>
              <h2>Train from keyframe motion.</h2>
              <p className="intro-copy">
                The model learns small joint deltas between authored keyframes,
                including seeded randomized starts.
              </p>
            </div>
            <StatusPill online={Boolean(state?.training)}>
              {state?.training ? "Training" : trained ? "Model ready" : "Idle"}
            </StatusPill>
          </div>
          <Panel className="route-content-panel">
            <PanelHeader>
              <div>
                <PanelLabel>TRAINING RUN</PanelLabel>
                <h3>Behavior cloning configuration</h3>
              </div>
              <span className="count-badge">{demonstrations.length} demos</span>
            </PanelHeader>
            <div className="route-selection-grid">
              <label>
                Dataset
                <select
                  value={activeDatasetId ?? ""}
                  onChange={(event) => setActiveDatasetId(event.target.value)}
                >
                  <option value="">All datasets</option>
                  {datasets.map((dataset) => (
                    <option value={dataset.id} key={dataset.id}>
                      {dataset.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Demonstration
                <select
                  value={selectedDemoId ?? ""}
                  onChange={(event) => setSelectedDemoId(event.target.value)}
                >
                  <option value="">All demonstrations</option>
                  {demonstrations.map((demonstration) => (
                    <option value={demonstration.id} key={demonstration.id}>
                      {demonstration.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="route-form-grid">
              <label>
                Hidden layers
                <input
                  value={hiddenLayerText}
                  onChange={(event) =>
                    updateConfig("hidden_layers", event.target.value)
                  }
                />
              </label>
              <label>
                Activation
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
                Increment (ms)
                <input
                  type="number"
                  min="10"
                  max="2000"
                  value={config.timestep_ms}
                  onChange={(event) =>
                    updateConfig("timestep_ms", event.target.value)
                  }
                />
              </label>
              <label>
                Random starts
                <input
                  type="number"
                  min="0"
                  max="64"
                  value={config.random_starts}
                  onChange={(event) =>
                    updateConfig("random_starts", event.target.value)
                  }
                />
              </label>
              <label>
                Rollout steps
                <input
                  type="number"
                  min="1"
                  max="2000"
                  value={config.rollout_steps}
                  onChange={(event) =>
                    updateConfig("rollout_steps", event.target.value)
                  }
                />
              </label>
              <label>
                Epochs
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
            <div className="route-actions">
              <Button
                variant="primary"
                onClick={startTraining}
                disabled={
                  !sessionId ||
                  !demonstrations.length ||
                  busy ||
                  state?.training
                }
              >
                Train temporal controller
              </Button>
              <Link className="button secondary" to="/evaluate">
                Open evaluation
              </Link>
            </div>
            <div className="route-metric-grid">
              <div>
                <PanelLabel>LATEST LOSS</PanelLabel>
                <strong>{metric ? metric.loss.toFixed(5) : "—"}</strong>
              </div>
              <div>
                <PanelLabel>PROGRESS</PanelLabel>
                <strong>
                  {metric ? `${metric.epoch}/${metric.epochs}` : "—"}
                </strong>
              </div>
              <div>
                <PanelLabel>INPUTS</PanelLabel>
                <strong>{controllableJoints.length * 2 + 1}</strong>
              </div>
              <div>
                <PanelLabel>OUTPUTS</PanelLabel>
                <strong>{controllableJoints.length}</strong>
              </div>
            </div>
          </Panel>
        </div>
      );
    }
    if (location.pathname === "/evaluate") {
      return (
        <div className="route-page">
          <div className="route-heading">
            <div>
              <p className="kicker">EVALUATE / TRAJECTORY</p>
              <h2>Inspect the learned motion.</h2>
              <p className="intro-copy">
                Compare the predicted rollout against every authored keyframe
                instead of only checking the final pose.
              </p>
            </div>
            <StatusPill online={trained}>
              {trained ? "Evaluation ready" : "Train a model first"}
            </StatusPill>
          </div>
          <div className="route-two-column">
            <Panel className="route-viewport-panel">
              <PanelHeader>
                <div>
                  <PanelLabel>PREDICTED VIEWPORT</PanelLabel>
                  <h3>{robot?.name ?? "Awaiting robot"}</h3>
                </div>
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() =>
                    replayFrames(rolloutFrames, "the evaluated trajectory")
                  }
                  disabled={rolloutFrames.length < 2}
                >
                  {replayingDemoId === "evaluation"
                    ? "Replaying"
                    : "Play rollout"}
                </Button>
              </PanelHeader>
              <RobotScene robot={robot} state={state} />
            </Panel>
            <Panel className="route-content-panel">
              <PanelHeader>
                <div>
                  <PanelLabel>CHECKPOINT COMPARISON</PanelLabel>
                  <h3>
                    {rolloutFrames.length
                      ? `${rolloutFrames.length} predicted frames`
                      : "No rollout yet"}
                  </h3>
                </div>
              </PanelHeader>
              <div className="evaluation-route-content">
                <Button
                  variant="primary"
                  full
                  onClick={testModel}
                  disabled={!trained || !demonstrations.length || busy}
                >
                  Evaluate selected demonstration
                </Button>
                {evaluation ? (
                  <>
                    <div className="route-metric-grid">
                      <div>
                        <PanelLabel>MEAN ERROR</PanelLabel>
                        <strong>
                          {meanError(
                            evaluation.target,
                            evaluation.positions,
                          ).toFixed(4)}
                        </strong>
                      </div>
                      <div>
                        <PanelLabel>MAX ERROR</PanelLabel>
                        <strong>{evaluation.error.toFixed(4)}</strong>
                      </div>
                    </div>
                    <div className="keyframe-results">
                      {rolloutFrames.map((frame, index) => (
                        <div
                          className="keyframe-result"
                          key={`${frame.timestamp}-${index}`}
                        >
                          <span>Frame {index + 1}</span>
                          <span>
                            {meanError(frame.expected, frame.positions).toFixed(
                              4,
                            )}{" "}
                            error
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="test-empty">
                    Select a demonstration and run evaluation to inspect the
                    complete trajectory.
                  </div>
                )}
              </div>
            </Panel>
          </div>
        </div>
      );
    }
    return (
      <div className="route-page">
        <div className="route-heading">
          <div>
            <p className="kicker">TEACH / POSE EDITOR</p>
            <h2>Shape the robot pose.</h2>
            <p className="intro-copy">
              Edit every controllable joint together, then capture a full-pose
              keyframe or continue in the animation timeline.
            </p>
          </div>
          <div className="route-heading-actions">
            <label className="button ghost route-upload">
              <input
                type="file"
                accept=".urdf,application/xml,text/xml"
                onChange={handleUpload}
              />
              Upload URDF
            </label>
            <Button variant="primary" onClick={handleDemo} disabled={busy}>
              Open sample robot
            </Button>
          </div>
        </div>
        <div className="route-two-column">
          <Panel className="route-viewport-panel">
            <PanelHeader>
              <div>
                <PanelLabel>LIVE VIEWPORT</PanelLabel>
                <h3>{robot?.name ?? "Awaiting robot"}</h3>
              </div>
              <Button
                size="small"
                variant="secondary"
                onClick={resetPose}
                disabled={!robot}
              >
                Reset pose
              </Button>
            </PanelHeader>
            <RobotScene robot={robot} state={state} />
          </Panel>
          <Panel className="route-content-panel">
            <PanelHeader>
              <div>
                <PanelLabel>FULL-ROBOT POSE</PanelLabel>
                <h3>Joint editor</h3>
              </div>
              <span className="count-badge">
                {controllableJoints.length} active
              </span>
            </PanelHeader>
            <div className="route-joint-list">
              {controllableJoints.map((joint, index) => (
                <label className="route-joint-row" key={joint.name}>
                  <span>
                    {joint.name}
                    <small>{joint.type}</small>
                  </span>
                  <input
                    type="range"
                    min={joint.lower}
                    max={joint.upper}
                    step="0.001"
                    value={positions[index] ?? 0}
                    onChange={(event) =>
                      updateJoint(index, Number(event.target.value))
                    }
                  />
                  <input
                    type="number"
                    min={joint.lower}
                    max={joint.upper}
                    step="0.001"
                    value={positions[index] ?? 0}
                    aria-label={`${joint.name} route position`}
                    onChange={(event) =>
                      updateJoint(index, Number(event.target.value))
                    }
                  />
                </label>
              ))}
            </div>
            <div className="route-actions">
              <Button
                variant="primary"
                onClick={captureDemonstration}
                disabled={!robot || !controllableJoints.length}
              >
                Capture pose
              </Button>
              <Link className="button secondary" to="/teach/timeline">
                Open keyframe editor
              </Link>
            </div>
          </Panel>
        </div>
      </div>
    );
  })();

  if (location.pathname !== "/legacy") {
    return (
      <WorkbenchProvider
        value={{
          robot,
          sessionId,
          state,
          positions,
          demonstrations,
          datasets,
          activeDatasetId,
          selectedDemoId,
          applyPositions,
          persistDemonstrations,
          persistDatasets,
        }}
      >
        <RouteFrame
          robot={robot}
          sessionId={sessionId}
          error={error}
          message={message}
          onDismissError={() => setError(null)}
        >
          {routePage}
        </RouteFrame>
      </WorkbenchProvider>
    );
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
                  <input
                    className="joint-number"
                    aria-label={`${joint.name} numeric position`}
                    type="number"
                    min={joint.lower}
                    max={joint.upper}
                    step="0.001"
                    value={positions[index] ?? 0}
                    onChange={(event) =>
                      updateJoint(index, Number(event.target.value))
                    }
                  />
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
              active={activeTab === "timeline"}
              onClick={() => setActiveTab("timeline")}
              role="tab"
              aria-selected={activeTab === "timeline"}
              type="button"
            >
              Timeline <span>{timelineFrames.length}</span>
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
              active={activeTab === "datasets"}
              onClick={() => setActiveTab("datasets")}
              role="tab"
              aria-selected={activeTab === "datasets"}
              type="button"
            >
              Datasets <span>{datasets.length}</span>
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
                <label>
                  <span>Increment (ms)</span>
                  <input
                    type="number"
                    min="10"
                    max="2000"
                    value={config.timestep_ms}
                    onChange={(event) =>
                      updateConfig("timestep_ms", event.target.value)
                    }
                  />
                </label>
                <label>
                  <span>Random starts</span>
                  <input
                    type="number"
                    min="0"
                    max="64"
                    value={config.random_starts}
                    onChange={(event) =>
                      updateConfig("random_starts", event.target.value)
                    }
                  />
                </label>
                <label>
                  <span>Rollout steps</span>
                  <input
                    type="number"
                    min="1"
                    max="2000"
                    value={config.rollout_steps}
                    onChange={(event) =>
                      updateConfig("rollout_steps", event.target.value)
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
                  <strong>{controllableJoints.length * 2 + 1}</strong>
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
          ) : activeTab === "timeline" ? (
            <TimelinePanel
              frames={timelineFrames}
              joints={controllableJoints}
              recording={recording}
              selectedFrameIndex={selectedFrameIndex}
              dirty={timelineDirty}
              hasSelection={Boolean(timelineDemonstration)}
              onCapture={captureCheckpoint}
              onSelectFrame={selectTimelineFrame}
              onUpdateFrame={updateTimelineFrame}
              onUpdateTimestamp={updateTimelineTimestamp}
              onDeleteFrame={deleteTimelineFrame}
              onDuplicateFrame={duplicateTimelineFrame}
              onPreviewFrame={previewTimelineFrame}
              onSave={saveTimelineDraft}
              onDiscard={discardTimelineDraft}
              onStopRecording={stopRecording}
              onStartRecording={startRecording}
            />
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
                            : demonstration.kind === "gesture"
                              ? "Edit timeline"
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
          ) : activeTab === "datasets" ? (
            <DatasetPanel
              datasets={datasets}
              activeDatasetId={activeDatasetId}
              demonstrations={demonstrations}
              onSelect={(datasetId) => {
                setActiveDatasetId(datasetId);
                const dataset = datasets.find((item) => item.id === datasetId);
                if (dataset) {
                  setMessage(`Selected ${dataset.name}.`);
                }
              }}
              onCreate={() => {
                const now = new Date().toISOString();
                const dataset = {
                  id: `dataset-${Date.now()}`,
                  name: `Dataset ${datasets.length + 1}`,
                  demonstration_ids: demonstrations.map((item) => item.id),
                  created_at: now,
                  updated_at: now,
                };
                persistDatasets([...datasets, dataset]);
                setActiveDatasetId(dataset.id);
              }}
              onRename={(datasetId, name) =>
                persistDatasets(
                  datasets.map((dataset) =>
                    dataset.id === datasetId
                      ? {
                          ...dataset,
                          name,
                          updated_at: new Date().toISOString(),
                        }
                      : dataset,
                  ),
                )
              }
              onMoveDemonstration={moveDemonstration}
            />
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
              {rolloutFrames.length > 1 && (
                <button
                  className="button secondary full"
                  onClick={() =>
                    replayingDemoId === "evaluation"
                      ? stopReplay()
                      : replayFrames(rolloutFrames, "the evaluated trajectory")
                  }
                  disabled={busy}
                >
                  {replayingDemoId === "evaluation"
                    ? "Stop trajectory replay"
                    : "Play evaluated trajectory"}
                </button>
              )}
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
                    <strong>
                      {rolloutFrames.length
                        ? `Trajectory error · ${rolloutFrames.length} frames`
                        : "Prediction error"}
                    </strong>
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

type RouteFrameProps = {
  children: ReactNode;
  robot: Robot | null;
  sessionId: string | null;
  error: string | null;
  message: string;
  onDismissError: () => void;
};

function RouteFrame({
  children,
  robot,
  sessionId,
  error,
  message,
  onDismissError,
}: RouteFrameProps) {
  const workspace = useWorkbench();
  const navigation = [
    ["/teach/pose", "Pose"],
    ["/teach/timeline", "Timeline"],
    ["/archive", "Archive"],
    ["/train", "Train"],
    ["/evaluate", "Evaluate"],
  ] as const;
  return (
    <main className="app-shell route-shell">
      <header className="topbar">
        <Link className="brand-lockup brand-link" to="/teach/pose">
          <div className="brand-mark">⌁</div>
          <div>
            <div className="eyebrow">ROBOTICS LAB / 01</div>
            <h1>Learning Workbench</h1>
          </div>
        </Link>
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
      <nav className="route-nav" aria-label="Workbench pages">
        {navigation.map(([href, label]) => (
          <NavLink
            className={({ isActive }) =>
              `route-nav-link ${isActive ? "active" : ""}`
            }
            to={href}
            key={href}
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="route-context">
        <span>{workspace.robot?.name ?? robot?.name ?? "No robot loaded"}</span>
        <span>·</span>
        <span>{message}</span>
      </div>
      {error && (
        <div className="alert error">
          <strong>Attention</strong>
          <span>{error}</span>
          <button onClick={onDismissError}>×</button>
        </div>
      )}
      {children}
      <footer className="footer">
        <span>FastAPI · PyBullet · PyTorch · Three.js</span>
        <span>Robot teaching workspace / routed session</span>
      </footer>
    </main>
  );
}

type TimelinePanelProps = {
  frames: DemonstrationFrame[];
  joints: Joint[];
  recording: boolean;
  selectedFrameIndex: number;
  dirty: boolean;
  hasSelection: boolean;
  onCapture: () => void;
  onSelectFrame: (index: number) => void;
  onUpdateFrame: (
    frameIndex: number,
    jointIndex: number,
    value: number,
  ) => void;
  onUpdateTimestamp: (frameIndex: number, value: number) => void;
  onDeleteFrame: (index: number) => void;
  onDuplicateFrame: (index: number) => void;
  onPreviewFrame: (index: number) => void;
  onSave: () => void;
  onDiscard: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
};

function TimelinePanel({
  frames,
  joints,
  recording,
  selectedFrameIndex,
  dirty,
  hasSelection,
  onCapture,
  onSelectFrame,
  onUpdateFrame,
  onUpdateTimestamp,
  onDeleteFrame,
  onDuplicateFrame,
  onPreviewFrame,
  onSave,
  onDiscard,
  onStartRecording,
  onStopRecording,
}: TimelinePanelProps) {
  const fps = 30;
  const lastFrame = frames[frames.length - 1]?.timestamp ?? 0;
  const durationFrames = Math.max(60, Math.ceil((lastFrame / 1000) * fps) + 12);
  const selected = frames[selectedFrameIndex];
  const markerPosition = (timestamp: number) =>
    `${Math.min(100, Math.max(0, (timestamp / Math.max(lastFrame, 1)) * 100))}%`;
  const [playing, setPlaying] = useState(false);
  const playRef = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || !frames.length) return;
    let idx = selectedFrameIndex;
    const tick = () => {
      idx = (idx + 1) % frames.length;
      onSelectFrame(idx);
      onPreviewFrame(idx);
      playRef.current = window.setTimeout(tick, 240);
    };
    playRef.current = window.setTimeout(tick, 240);
    return () => {
      if (playRef.current !== null) window.clearTimeout(playRef.current);
    };
  }, [playing, frames, selectedFrameIndex, onSelectFrame, onPreviewFrame]);

  if (!hasSelection && !recording) {
    return (
      <div className="animation-editor">
        <div className="demo-empty">
          <strong>No gesture selected</strong>
          <span>Select a gesture in Archive or start a new capture.</span>
          <Button variant="secondary" size="small" onClick={onStartRecording} disabled={!joints.length}>
            Start capture
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="animation-editor">
      <div className="animation-toolbar">
        <div>
          <PanelLabel>KEYFRAME EDITOR · {fps} FPS</PanelLabel>
          <strong>
            {frames.length} authored keyframe{frames.length === 1 ? "" : "s"}
            {dirty && <em className="draft-badge"> · unsaved</em>}
          </strong>
        </div>
        <div className="demo-card-actions">
          {recording ? (
            <Button variant="recording" size="small" onClick={onStopRecording}>
              Stop capture
            </Button>
          ) : (
            <Button variant="secondary" size="small" onClick={onStartRecording}>
              Start capture
            </Button>
          )}
          <Button
            variant="primary"
            size="small"
            onClick={onCapture}
            disabled={!joints.length}
          >
            Insert full-pose key
          </Button>
        </div>
      </div>
      <p className="helper-text">
        Isolated draft: pose sliders stay independent. Save publishes to archive
        for training. Diamonds are authored keys — playback is derived.
      </p>
      {dirty && !recording && (
        <div className="edit-banner">
          <span>Unsaved timeline edits — training uses last saved version.</span>
          <div>
            <Button variant="ghost" size="small" onClick={onDiscard}>Discard</Button>
            <Button variant="primary" size="small" onClick={onSave}>Save keyframes</Button>
          </div>
        </div>
      )}
      {frames.length ? (
        <>
          <div className="timeline-scrub">
            <input
              type="range"
              min={0}
              max={Math.max(0, frames.length - 1)}
              value={selectedFrameIndex}
              aria-label="Scrub keyframes"
              onChange={(e) => {
                const idx = Number(e.target.value);
                onSelectFrame(idx);
                onPreviewFrame(idx);
              }}
            />
            <Button
              variant="secondary"
              size="small"
              onClick={() => setPlaying((v) => !v)}
              disabled={frames.length < 2}
            >
              {playing ? "Pause" : "Play"}
            </Button>
            <span className="scrub-label">{selectedFrameIndex + 1} / {frames.length}</span>
          </div>
          <div
            className="animation-ruler"
            style={
              { "--timeline-duration": durationFrames } as React.CSSProperties
            }
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              const targetTime = pct * Math.max(lastFrame, 1);
              let nearest = 0;
              let best = Infinity;
              frames.forEach((f, i) => {
                const d = Math.abs(f.timestamp - targetTime);
                if (d < best) { best = d; nearest = i; }
              });
              onSelectFrame(nearest);
              onPreviewFrame(nearest);
            }}
          >
            {Array.from(
              { length: Math.ceil(durationFrames / 12) + 1 },
              (_, index) => (
                <span
                  key={index}
                  style={{ left: `${((index * 12) / durationFrames) * 100}%` }}
                >
                  {index * 12}
                </span>
              ),
            )}
            <i
              className="animation-playhead"
              style={{ left: markerPosition(selected?.timestamp ?? 0) }}
            />
          </div>
          <div
            className="animation-channels"
            role="list"
            aria-label="Robot animation channels"
          >
            <div className="channel-row channel-header">
              <span>CHANNELS</span>
              <span>AUTHORED KEYFRAMES (click diamond to select)</span>
            </div>
            {joints.map((joint) => (
              <div className="channel-row" key={joint.name}>
                <span className="channel-name">
                  {joint.name}
                  <small>{joint.type}</small>
                </span>
                <div className="channel-track">
                  {frames.map((frame, frameIndex) => (
                    <button
                      className={`keyframe-diamond ${selectedFrameIndex === frameIndex ? "selected" : ""}`}
                      style={{ left: markerPosition(frame.timestamp) }}
                      aria-label={`Keyframe ${frameIndex + 1} for ${joint.name}`}
                      key={`${frameIndex}-${frame.timestamp}`}
                      onClick={() => {
                        onSelectFrame(frameIndex);
                        onPreviewFrame(frameIndex);
                      }}
                      type="button"
                    >
                      ◆
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {selected ? (
            <div className="keyframe-inspector">
              <div className="timeline-frame-header">
                <div>
                  <PanelLabel>SELECTED KEYFRAME</PanelLabel>
                  <strong>
                    Frame {Math.round((selected.timestamp / 1000) * fps)} · {Math.round(selected.timestamp)} ms
                  </strong>
                </div>
                <label>
                  <span>Frame time (ms)</span>
                  <input
                    aria-label="Selected keyframe time"
                    type="number"
                    min="0"
                    step="10"
                    value={Math.round(selected.timestamp)}
                    onChange={(event) =>
                      onUpdateTimestamp(
                        selectedFrameIndex,
                        Number(event.target.value),
                      )
                    }
                  />
                </label>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => onDuplicateFrame(selectedFrameIndex)}
                >
                  Duplicate
                </Button>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => onDeleteFrame(selectedFrameIndex)}
                  disabled={frames.length <= 1}
                >
                  Delete key
                </Button>
              </div>
              <div className="timeline-joint-grid">
                {joints.map((joint, jointIndex) => {
                  const value = selected.positions[jointIndex] ?? 0;
                  const updateValue = (nextValue: string) =>
                    onUpdateFrame(
                      selectedFrameIndex,
                      jointIndex,
                      Number(nextValue),
                    );

                  return (
                    <label className="timeline-joint-control" key={joint.name}>
                      <span>{joint.name}</span>
                      <div className="timeline-joint-inputs">
                        <input
                          aria-label={`${joint.name} slider at selected keyframe`}
                          type="range"
                          min={joint.lower}
                          max={joint.upper}
                          step="0.001"
                          value={value}
                          onChange={(event) => updateValue(event.target.value)}
                        />
                        <input
                          aria-label={`${joint.name} at selected keyframe`}
                          type="number"
                          min={joint.lower}
                          max={joint.upper}
                          step="0.001"
                          value={value}
                          onChange={(event) => updateValue(event.target.value)}
                        />
                      </div>
                    </label>
                  );
                })}
              </div>
              <p className="helper-text" style={{ paddingLeft: 0 }}>Slider + number per joint — edits this keyframe only. Use Play/scrub to preview.</p>
            </div>
          ) : (
            <div className="demo-empty">
              <strong>No keyframes yet</strong>
              <span>Insert a full-pose keyframe to start the animation.</span>
            </div>
          )}
        </>
      ) : (
        <div className="demo-empty">
          <strong>No authored keyframes yet</strong>
          <span>
            Start capture, then insert full-pose keys at meaningful moments. Each key stores the full pose, not a delta.
          </span>
        </div>
      )}
    </div>
  );
}

type DatasetPanelProps = {
  datasets: Dataset[];
  activeDatasetId: string | null;
  demonstrations: Demonstration[];
  onSelect: (datasetId: string) => void;
  onCreate: () => void;
  onRename: (datasetId: string, name: string) => void;
  onMoveDemonstration: (demonstrationId: string, datasetId: string) => void;
};

function DatasetPanel({
  datasets,
  activeDatasetId,
  demonstrations,
  onSelect,
  onCreate,
  onRename,
  onMoveDemonstration,
}: DatasetPanelProps) {
  return (
    <div className="datasets-panel">
      <div className="demo-toolbar">
        <div>
          <p className="panel-label">ROBOT DATASETS</p>
          <strong>
            {datasets.length} saved dataset{datasets.length === 1 ? "" : "s"}
          </strong>
        </div>
        <button className="button primary small" onClick={onCreate}>
          New dataset
        </button>
      </div>
      <p className="helper-text">
        Datasets organize the current robot's captured poses and gestures. The
        active dataset receives new demonstrations.
      </p>
      {datasets.length ? (
        <div className="dataset-list">
          {datasets.map((dataset) => (
            <article
              className={`dataset-card ${dataset.id === activeDatasetId ? "selected" : ""}`}
              key={dataset.id}
            >
              <button
                className="dataset-select"
                onClick={() => onSelect(dataset.id)}
              >
                <span className="panel-label">
                  {dataset.id === activeDatasetId
                    ? "ACTIVE DATASET"
                    : "DATASET"}
                </span>
                <strong>{dataset.name}</strong>
                <small>{dataset.demonstration_ids.length} demonstrations</small>
              </button>
              <input
                aria-label={`Rename ${dataset.name}`}
                value={dataset.name}
                onChange={(event) => onRename(dataset.id, event.target.value)}
              />
            </article>
          ))}
        </div>
      ) : (
        <div className="demo-empty">
          <strong>No datasets yet</strong>
          <span>Create one before capturing a demonstration.</span>
        </div>
      )}
      {demonstrations.length > 0 && datasets.length > 0 && (
        <div className="dataset-members">
          <p className="panel-label">DEMONSTRATION MEMBERSHIP</p>
          {demonstrations.map((demonstration) => {
            const memberDataset = datasets.find((dataset) =>
              dataset.demonstration_ids.includes(demonstration.id),
            );
            return (
              <label key={demonstration.id}>
                <span>{demonstration.name}</span>
                <select
                  aria-label={`Dataset for ${demonstration.name}`}
                  value={memberDataset?.id ?? ""}
                  onChange={(event) =>
                    onMoveDemonstration(demonstration.id, event.target.value)
                  }
                >
                  <option value="" disabled>
                    Select dataset
                  </option>
                  {datasets.map((dataset) => (
                    <option value={dataset.id} key={dataset.id}>
                      {dataset.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      )}
      <div className="training-summary">
        <div>
          <span>Current archive</span>
          <strong>{demonstrations.length}</strong>
        </div>
        <div>
          <span>Robot scope</span>
          <strong>1</strong>
        </div>
      </div>
    </div>
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
