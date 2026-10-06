import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { H2, IntroCopy, Kicker } from "@/components/ui/typography";
import { MappingControls } from "@/components/camera/MappingControls";
import { CameraCapturePanel } from "@/components/camera/CameraCapturePanel";
import { RecordingLibrary } from "@/components/camera/RecordingLibrary";
import { CameraSourcePanel } from "@/components/camera/CameraSourcePanel";
import { useCameraCapture } from "@/components/camera/useCameraCapture";
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
  const [processing, setProcessing] = useState<"live" | "offline">("offline");
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
  const [storageFailed, setStorageFailed] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Preview positions feed back through props; keep the entry pose as a stable neutral.
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
      preview.current(frame ? retargetLandmarkFrame(frame, joints, baseline.current, profile) : [...baseline.current]);
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
      setStorageFailed(!saved);
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
      <ol className="camera-workflow" aria-label="Camera teaching workflow">
        <li>1 · Capture</li><li>2 · Process</li><li>3 · Inspect mapping</li><li>4 · Save to Archive</li>
      </ol>
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
      <MappingControls profile={profile} disabled={locked} onChange={setProfile} />
      <div className="route-form-grid camera-inspection-settings">
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
        <div className="route-two-column camera-live-layout">
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
          <CameraCapturePanel mode={mode} setMode={setMode} countdown={countdown} setCountdown={setCountdown}
            processing={processing} locked={locked} robot={robot} state={state} latest={latest && mappingCoverage(latest, joints, profile).mapped.length ? latest : null}
            remaining={remaining} camera={camera} cancelCountdown={cancelCountdown} start={start} savePose={savePose} />
        </div>
      ) : (
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
        Mapping drives compatible G1 joints; unsupported or unobserved joints keep the neutral pose.
      </p>
    </div>
  );
}
