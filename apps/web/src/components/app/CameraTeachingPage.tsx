import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { H2, IntroCopy, Kicker } from "@/components/ui/typography";
import { safeCameraGesture } from "@/domain/cameraMotionSafety";
import { useSafeCameraMotion } from "@/components/camera/useSafeCameraMotion";
import { useRobotTransport } from "@/components/camera/useRobotTransport";
import { RobotConnectionPanel } from "@/components/camera/RobotConnectionPanel";
import { MappingControls } from "@/components/camera/MappingControls";
import { CameraCapturePanel } from "@/components/camera/CameraCapturePanel";
import { RecordingLibrary } from "@/components/camera/RecordingLibrary";
import { CameraSourcePanel } from "@/components/camera/CameraSourcePanel";
import { useMultiCameraCapture } from "@/components/camera/useMultiCameraCapture";
import { useLiveCameraSession } from "@/components/camera/useLiveCameraSession";
import { CameraSetupPanel } from "@/components/camera/CameraSetupPanel";
import { CameraRigControls } from "@/components/camera/CameraRigControls";
import { mappingCoverage, retargetLandmarkFrame, RETARGETING_PROFILE_VERSION, type RetargetingProfile } from "@/domain/retargeting";
import {
  deleteCameraRecording,
  listCameraRecordings,
  loadCameraRecording,
  saveCameraRecording,
  type CameraRecording,
  type CameraRecordingSummary,
} from "@/domain/cameraArchive";
import { directIpCameraStreamUrl } from "@/domain/ipCamera";
import { extractMultiCameraRecording } from "@/domain/multiCameraRecording";
import type { CameraCapture, Joint, LandmarkFrame, Robot, SimulationState } from "@/types";

type Props = {
  robot: Robot | null;
  state: SimulationState | null;
  joints: Joint[];
  neutral: number[];
  onPreview: (positions: number[]) => void;
  onSave: (capture: CameraCapture, positions: number[][]) => Promise<void>;
};
const message = (error: unknown) => (error instanceof Error ? error.message : "Camera operation failed.");

export function CameraTeachingPage(props: Props) {
  // Remount all camera resources when the robot changes; do not reuse another robot's recordings.
  return <CameraWorkspace key={props.robot?.id ?? "none"} {...props} />;
}
function CameraWorkspace({ robot, state, joints, neutral, onPreview, onSave }: Props) {
  const [previewSpeed, setPreviewSpeed] = useState(3);
  const [robotOnly, setRobotOnly] = useState(false);
  const [tab, setTab] = useState<"live" | "setup" | "calibration" | "recordings">("live");
  const [processing, setProcessing] = useState<"live" | "offline">("live");
  const [sampleRate, setSampleRate] = useState<10 | 15 | 30>(30);
  const [mode, setMode] = useState<"simple" | "continuous">("continuous");
  const [profile, setProfile] = useState<RetargetingProfile>("g1-upper-body");
  const [countdown, setCountdown] = useState(3);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [latest, setLatest] = useState<LandmarkFrame | null>(null);
  const [rows, setRows] = useState<CameraRecordingSummary[]>([]);
  const [selected, setSelected] = useState<CameraRecording | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [storageFailed, setStorageFailed] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Preview positions feed back through props; keep the entry pose as a stable neutral.
  const baseline = useRef([...neutral]);
  const connection = useRobotTransport();
  const trackingAt = useRef(-Infinity);
  const motion = useSafeCameraMotion(joints, baseline.current, profile, positions => { if (tab !== "recordings") onPreview(positions); }, state?.positions ?? neutral, previewSpeed);
  async function refresh() {
    if (robot) {
      const next = await listCameraRecordings(robot.id);
      if (mounted.current) setRows(next);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((error) => setStatus(message(error)));
    return () => {
      mounted.current = false;
      abort.current?.abort();
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    };
  }, []);
  const camera = useMultiCameraCapture({
    processing,
    sampleRate,
    onFrame: (frame) => {
      setLatest(frame);
      const target = motion.observe(frame);
      trackingAt.current = target && frame ? performance.now() : -Infinity;
      const physicalJoints = connection.controlJoints ?? joints;
      const physicalNeutral = physicalJoints.map(joint => baseline.current[joints.findIndex(preview => preview.name === joint.name)] ?? 0);
      const physicalTarget = target && frame && connection.controlJoints
        ? retargetLandmarkFrame(frame, physicalJoints, physicalNeutral, profile) : target;
      const visible = frame ? new Set(mappingCoverage(frame, physicalJoints, profile).mapped) : new Set<string>();
      const positions = physicalTarget ? Object.fromEntries(physicalJoints.flatMap((joint, i) =>
        visible.has(joint.name) && (/^(left|right)_(shoulder_(pitch|roll|yaw)|elbow|wrist_(roll|pitch|yaw))_joint$/.test(joint.name) || /^waist_(yaw|roll|pitch)_joint$/.test(joint.name))
          ? [[joint.name, physicalTarget[i]]] : [])) : null;
      connection.submit(positions && Object.keys(positions).length ? positions : null);
    },
    onRecording: async (recording) => {
      if (!robot) return;
      let saved = true;
      try {
        await saveCameraRecording(robot.id, recording);
      } catch {
        saved = false;
      }
      if (!mounted.current) return;
      setSelected(recording);
      setStorageFailed(!saved);
      setBusy(false);
      setStatus(
        saved
          ? "Recording saved on this device. Live preview continues; inspect it in Recordings."
          : "Browser storage failed. This recording is available only in this session; use Retry saving recording.",
      );
      if (saved) await refresh();
    },
  }, robot?.id);
  const source=camera.rig.inputs[0].kind, address=camera.rig.inputs[0].address;
  const locked = busy || extracting || camera.recording || camera.finalizing || camera.opening || remaining !== null;
  const session = useLiveCameraSession({ cameraConnected: camera.connected, openCamera: () => camera.open(source, address),
    closeCamera: camera.close, connection, liveProcessing: processing === "live",
    trackingFresh: () => performance.now() - trackingAt.current <= 250 });
  function cancelCountdown() {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    countdownTimer.current = null;
    setRemaining(null);
  }
  function start() {
    let seconds = countdown;
    setRemaining(seconds);
    setStatus("");
    countdownTimer.current = setInterval(() => {
      seconds--;
      setRemaining(seconds);
      if (seconds <= 0) {
        cancelCountdown();
        camera.startRecording();
      }
    }, 1000);
  }
  async function select(id: string) {
    if (!robot) return;
    setBusy(true);
    setStatus("");
    try {
      const recording = await loadCameraRecording(robot.id, id);
      if (!recording) throw new Error("This recording no longer exists.");
      if (mounted.current) {
        setSelected(recording);
        setStorageFailed(false);
        setSampleRate(recording.sample_rate);
      }
    } catch (error) {
      setStatus(message(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function extract() {
    if (!robot || !selected?.video) return;
    const controller = new AbortController();
    abort.current = controller;
    setExtracting(true);
    setProgress(0);
    setStatus("Extracting stick figure locally…");
    try {
      const result = await extractMultiCameraRecording(
        selected,
        sampleRate,
        controller.signal,
        setProgress,
      );
      controller.signal.throwIfAborted();
      const next = { ...selected, ...result, sample_rate: sampleRate };
      setSelected(next);
      setStorageFailed(true);
      await saveCameraRecording(robot.id, next);
      setStorageFailed(false);
      await refresh();
      setStatus(
        result.frames.length
          ? `Extracted ${result.frames.length} frames. Inspect the mapping, then save the robot gesture.`
          : "No confident pose found. The recording is retained; try a clearer view or re-extract.",
      );
    } catch (error) {
      if (mounted.current)
        setStatus(
          controller.signal.aborted
            ? "Extraction cancelled. The recording and previous extraction are retained."
            : `${message(error)} The recording remains available; retry extraction or saving.`,
        );
    } finally {
      if (mounted.current) setExtracting(false);
      abort.current = null;
    }
  }
  async function saveDemonstration(recording: CameraRecording, captureMode: "simple" | "continuous") {
    if (!recording.frames.some((frame) => mappingCoverage(frame, joints, profile).mapped.length)) return;
    setBusy(true);
    const capture: CameraCapture = {
      id: recording.id,
      version: 1,
      name: captureMode === "simple" ? "Camera pose" : recording.name,
      created_at: recording.created_at,
      mode: captureMode,
      sample_rate: recording.sample_rate,
      source: recording.source,
      frames: recording.frames,
      quality: { accepted_frames: recording.frames.length, rejected_frames: recording.rejected_frames ?? 0 },
      retargeting_profile: profile,
      retargeting_profile_version: RETARGETING_PROFILE_VERSION,
      ...(recording.video ? { video_id: recording.id } : {}),
    };
    const guarded = captureMode === "continuous" ? safeCameraGesture(recording.frames, joints, baseline.current, profile) : null;
    try {
      await onSave(capture, guarded?.positions ?? recording.frames.map((frame) => retargetLandmarkFrame(frame, joints, baseline.current, profile)));
      setStatus(guarded?.pausedAt != null
        ? `Saved to Archive. A tracking break at ${(guarded.pausedAt / 1000).toFixed(2)} s was held and recovered automatically. Inspect the gesture before training.`
        : "Saved to Archive. The robot demonstration is ready for training.");
    } catch (error) {
      setStatus(`Save failed: ${message(error)}`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function retrySave() {
    if (!robot || !selected) return;
    setBusy(true);
    try {
      await saveCameraRecording(robot.id, selected);
      setStorageFailed(false);
      await refresh();
      setStatus("Recording saved on this device.");
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!robot || !selected) return;
    setBusy(true);
    try {
      await deleteCameraRecording(robot.id, selected.id);
      setSelected(null);
      await refresh();
      setStatus("Local recording deleted. Saved robot demonstrations remain in Archive.");
    } catch (error) {
      setStatus(message(error));
    } finally {
      setBusy(false);
    }
  }
  function savePose() {
    if (latest)
      void saveDemonstration(
        {
          id: `camera-${crypto.randomUUID()}`,
          name: "Camera pose",
          created_at: new Date().toISOString(),
          source: camera.rig.inputs.length>1
            ? {kind:"multi-camera",stream_count:camera.rig.inputs.length as 2|3,model:camera.rig.model,calibration:camera.rig.calibration}
            : source === "local"
              ? { kind: "local-media-stream", stream_count: 1 }
              : { kind: "ip-image-stream", url: directIpCameraStreamUrl(address) },
          sample_rate: sampleRate,
          duration_ms: 0,
          frames: [{ ...latest, timestamp: 0 }],
        },
        "simple",
      );
  }
  return (
    <div className="route-page">
      <div className="route-heading">
        <div>
          <Kicker>TEACH / CAMERA</Kicker>
          <H2>Teach from your movement.</H2>
          <IntroCopy>Preview your movement live, run your robot, and keep poses or gestures as demonstrations.</IntroCopy>
        </div>
      </div>
      <RobotConnectionPanel connection={connection} profile={profile} live={camera.connected && processing === "live"} previewConnected={camera.connected} session={session} canStart={Boolean(robot) && !locked}
        preview={() => { if (camera.connected) camera.close(); else void session.start(); }} />
      <div className="route-actions" role="tablist" aria-label="Camera workspace">
        {([["live", "Live camera"], ["setup", "Camera setup"], ["calibration", "Calibration"], ["recordings", "Recordings"]] as const).map(([value, label]) =>
          <Button key={value} role="tab" aria-selected={tab === value} variant={tab === value ? "primary" : "secondary"} onClick={() => setTab(value)}>{label}</Button>)}
      </div>
      <p className="helper-text">{camera.rig.inputs.length} camera{camera.rig.inputs.length > 1 ? "s" : ""} · {camera.rig.setupName} · {camera.rig.inputs.length === 1 ? "Single-view estimate" : camera.rig.model === "triangulated" ? "Calibrated triangulation" : "Body-aligned fusion"}. Configure all views in Camera setup.</p>
      {!robot && <p className="helper-text">Open a robot to capture and inspect its recordings.</p>}
      <div role="status" className="helper-text">
        {status || camera.status}
      </div>
      <div className={tab === "recordings" || tab === "live" ? "" : "hidden"}><MappingControls profile={profile} disabled={locked || session.busy || connection.busy || Boolean(connection.status?.connected)} onChange={setProfile} /></div>
      <div className={tab === "setup" ? "" : "hidden"}><CameraSetupPanel rig={camera.rig} disabled={locked || session.busy || camera.connected || Boolean(connection.status?.connected)}
        connected={camera.connected} testDisabled={locked || session.busy || Boolean(connection.status?.armed)} onTest={() => { if (camera.connected) camera.close(); else void camera.open(source, address); }} />
      <div className="route-form-grid camera-inspection-settings">
        <label>Preview speed
          <select aria-label="Preview speed" value={previewSpeed} onChange={(event) => setPreviewSpeed(Number(event.target.value))}>
            {[1, 2, 3, 5].map(speed => <option key={speed} value={speed}>{speed} rad/s</option>)}
          </select>
        </label>
        <label>
          Sample rate
          <select
            aria-label="Sample rate"
            value={sampleRate}
            disabled={locked || camera.connected}
            onChange={(event) => setSampleRate(Number(event.target.value) as typeof sampleRate)}
          >
            {[10, 15, 30].map((fps) => (
              <option key={fps} value={fps}>
                {fps} fps
              </option>
            ))}
          </select>
        </label>
      </div></div>
      <div className={tab === "calibration" ? "" : "hidden"}><CameraSetupPanel rig={camera.rig} disabled={locked || session.busy || camera.connected || Boolean(connection.status?.connected)} calibrationOnly /></div>
        <div className={tab === "recordings" ? "hidden" : `camera-workspace-grid${tab === "live" && robotOnly ? " camera-robot-only" : ""}`}>
          <div className={`camera-source-container${tab === "live" && robotOnly ? " hidden" : ""}`}>
            <CameraSourcePanel
              source={source}
              setSource={value=>camera.rig.update(0,{kind:typeof value==="function"?value(source):value})}
              address={address}
              setAddress={value=>camera.rig.update(0,{address:typeof value==="function"?value(address):value})}
              processing={processing}
              setProcessing={setProcessing}
              setMode={setMode}
              camera={camera}
              rig={camera.rig}
              showSettings={tab === "setup"}
              showAction={false}
              latest={latest}
              joints={joints}
              profile={profile}
              locked={locked}
              disabled={!robot}
              onToggle={() => {
                setStatus("");
                if (camera.connected) camera.close();
                else {
                  void camera.open(source, address);
                }
              }}
            />
          </div>
          <div className={tab === "live" ? "hidden" : "camera-rig-tiles"}><CameraRigControls rig={camera.rig} disabled={locked || session.busy || camera.connected} showSettings={tab === "setup"} /></div>
          <CameraCapturePanel robotOnly={robotOnly} onToggleView={() => setRobotOnly(!robotOnly)} motionStatus={motion.status} mode={mode} setMode={setMode} countdown={countdown} setCountdown={setCountdown}
            processing={processing} locked={locked || session.busy} robot={robot} state={state} latest={latest && mappingCoverage(latest, joints, profile).mapped.length ? latest : null}
            remaining={remaining} camera={camera} cancelCountdown={cancelCountdown} start={start} savePose={savePose} />
        </div>
      {tab === "recordings" && (
        <RecordingLibrary
          recordings={rows}
          selected={selected}
          locked={locked}
          extracting={extracting}
          progress={progress}
          storageFailed={storageFailed}
          canSave={Boolean(selected?.frames.some((frame) => mappingCoverage(frame, joints, profile).mapped.length))}
          robot={robot}
          state={state}
          joints={joints}
          neutral={baseline.current}
          profile={profile}
          onPreview={onPreview}
          onSelect={(id) => void select(id)}
          onExtract={() => void extract()}
          onCancel={() => abort.current?.abort()}
          onSave={() => selected && void saveDemonstration(selected, "continuous")}
          onRetry={() => void retrySave()}
          onDelete={() => void remove()}
        />
      )}
      <p className="helper-text">
        Videos stay in this browser until deleted. Exported archives contain demonstrations, not videos. Left and right refer to your body.
        Continuous gestures use bounded motion and recover automatically after tracking settles. Keep one person in every view; tracking cannot guarantee person identity. Mapping drives compatible G1 joints; unsupported or unobserved joints keep the neutral pose.
      </p>
    </div>
  );
}
