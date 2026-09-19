import { useEffect, useRef, useState } from "react";
import { Button, Panel, PanelHeader, PanelLabel } from "@/components/ui";
import { H2, H3, IntroCopy, Kicker } from "@/components/ui/typography";
import { RobotViewport } from "@/components/workbench/RobotViewport";
import { RecordingLibrary } from "@/components/camera/RecordingLibrary";
import { CameraSourcePanel } from "@/components/camera/CameraSourcePanel";
import { useCameraCapture } from "@/components/camera/useCameraCapture";
import { retargetLandmarkFrame, type RetargetingProfile } from "@/domain/retargeting";
import {
  deleteCameraRecording,
  listCameraRecordings,
  loadCameraRecording,
  saveCameraRecording,
  type CameraRecording,
  type CameraRecordingSummary,
} from "@/domain/cameraArchive";
import { directIpCameraStreamUrl } from "@/domain/ipCamera";
import { extractCameraRecording } from "@/domain/cameraProcessing";
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
  const [tab, setTab] = useState<"live" | "recordings">("live");
  const [source, setSource] = useState<"local" | "ip">("local");
  const [address, setAddress] = useState("");
  const [processing, setProcessing] = useState<"live" | "offline">("live");
  const [sampleRate, setSampleRate] = useState<10 | 15 | 30>(15);
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
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const baseline = useRef([...neutral]);
  const preview = useRef(onPreview);
  preview.current = onPreview;
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
  const camera = useCameraCapture({
    processing,
    sampleRate,
    onFrame: (frame) => {
      setLatest(frame);
      if (frame) preview.current(retargetLandmarkFrame(frame, joints, baseline.current, profile));
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
      camera.close();
      setSelected(recording);
      setTab("recordings");
      setBusy(false);
      setStatus(
        saved
          ? "Recording saved on this device. Extract or inspect its motion."
          : "Browser storage failed. This recording is available only in this session; use Retry saving recording.",
      );
      if (saved) await refresh();
    },
  });
  const locked = busy || extracting || camera.recording || camera.finalizing || camera.opening || remaining !== null;
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
      const result = await extractCameraRecording(
        selected.video,
        sampleRate,
        selected.duration_ms,
        controller.signal,
        setProgress,
      );
      controller.signal.throwIfAborted();
      const next = { ...selected, ...result, sample_rate: sampleRate };
      setSelected(next);
      await saveCameraRecording(robot.id, next);
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
    if (!recording.frames.length) return;
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
      retargeting_profile_version: 1,
      ...(recording.video ? { video_id: recording.id } : {}),
    };
    try {
      await onSave(
        capture,
        recording.frames.map((frame) => retargetLandmarkFrame(frame, joints, baseline.current, profile)),
      );
      setStatus("Saved to Archive. The robot demonstration is ready for training.");
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
          source:
            source === "local"
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
          <IntroCopy>Record locally, extract a stick figure, then inspect and save its mapped robot motion.</IntroCopy>
        </div>
      </div>
      <div className="route-actions">
        <Button
          variant={tab === "live" ? "primary" : "secondary"}
          disabled={locked}
          onClick={() => {
            setTab("live");
            setStatus("");
          }}
        >
          Live camera
        </Button>
        <Button
          variant={tab === "recordings" ? "primary" : "secondary"}
          disabled={locked}
          onClick={() => {
            camera.close();
            setTab("recordings");
          }}
        >
          Recordings
        </Button>
      </div>
      {!robot && <p className="helper-text">Open a robot to capture and inspect its recordings.</p>}
      <div role="status" className="helper-text">
        {status || (tab === "live" ? camera.status : "Select a recording to process or replay.")}
      </div>
      <div className="route-form-grid">
        <label>
          Mapping profile
          <select
            aria-label="Mapping profile"
            value={profile}
            disabled={busy || extracting}
            onChange={(event) => setProfile(event.target.value as RetargetingProfile)}
          >
            <option value="g1-upper-body">G1 upper body</option>
            <option value="g1-single-arm">Single right arm</option>
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
      </div>
      {tab === "live" ? (
        <div className="route-two-column">
          <CameraSourcePanel
            source={source}
            setSource={setSource}
            address={address}
            setAddress={setAddress}
            processing={processing}
            setProcessing={setProcessing}
            setMode={setMode}
            camera={camera}
            latest={latest}
            locked={locked}
            disabled={!robot}
            onToggle={() => {
              setStatus("");
              if (camera.connected) camera.close();
              else {
                baseline.current = [...neutral];
                void camera.open(source, address);
              }
            }}
          />
          <Panel className="route-content-panel">
            <PanelHeader>
              <div>
                <PanelLabel>CAMERA TEACHING</PanelLabel>
                <H3>Capture movement</H3>
              </div>
            </PanelHeader>
            <div className="route-form-grid">
              <label>
                Capture mode
                <select
                  aria-label="Capture mode"
                  value={mode}
                  disabled={locked || processing === "offline"}
                  onChange={(event) => setMode(event.target.value as typeof mode)}
                >
                  <option value="simple">Simple pose</option>
                  <option value="continuous">Continuous gesture</option>
                </select>
              </label>
              <label>
                Countdown
                <select
                  aria-label="Countdown"
                  value={countdown}
                  disabled={locked}
                  onChange={(event) => setCountdown(Number(event.target.value))}
                >
                  {[1, 3, 5, 10].map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} seconds
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <RobotViewport robot={robot} state={state} title="Retargeted preview" label="ROBOT PREVIEW" />
            <div className="route-actions">
              {remaining !== null ? (
                <Button onClick={cancelCountdown}>Cancel countdown ({remaining})</Button>
              ) : camera.recording ? (
                <Button variant="recording" onClick={camera.stopRecording}>
                  Stop recording
                </Button>
              ) : mode === "continuous" ? (
                <Button disabled={!camera.connected || locked} onClick={start}>
                  Start recording
                </Button>
              ) : (
                <Button disabled={!latest || locked} onClick={savePose}>
                  Save pose
                </Button>
              )}
            </div>
          </Panel>
        </div>
      ) : (
        <RecordingLibrary
          recordings={rows}
          selected={selected}
          locked={locked}
          extracting={extracting}
          progress={progress}
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
        Videos stay in this browser until deleted. Exported archives contain demonstrations, not videos. Existing
        profiles map compatible G1 upper-body joints; other joints retain the neutral pose.
      </p>
    </div>
  );
}
