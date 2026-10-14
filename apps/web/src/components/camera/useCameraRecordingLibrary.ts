import { useEffect, useRef, useState } from "react";
import { safeCameraGesture } from "@/domain/cameraMotionSafety";
import { mappingCoverage, retargetLandmarkFrame, RETARGETING_PROFILE_VERSION, type RetargetingProfile } from "@/domain/retargeting";
import { deleteCameraRecording, listCameraRecordings, loadCameraRecording, saveCameraRecording, type CameraRecording, type CameraRecordingSummary } from "@/domain/cameraArchive";
import { extractMultiCameraRecording } from "@/domain/multiCameraRecording";
import type { CameraCapture, Joint, Robot } from "@/types";
const message = (error: unknown) => error instanceof Error ? error.message : "Camera operation failed.";
export function useCameraRecordingLibrary({ robot, joints, neutral, profile, sampleRate, setSampleRate, onSave }: {
  robot: Robot | null; joints: Joint[]; neutral: number[]; profile: RetargetingProfile; sampleRate: 10 | 15 | 30;
  setSampleRate: (value: 10 | 15 | 30) => void; onSave: (capture: CameraCapture, positions: number[][]) => Promise<void>;
}) {
  const [rows, setRows] = useState<CameraRecordingSummary[]>([]);
  const [selected, setSelected] = useState<CameraRecording | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [storageFailed, setStorageFailed] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
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
    };
  }, []);
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
      const extracted = await extractMultiCameraRecording(
        selected,
        sampleRate,
        controller.signal,
        setProgress,
      );
      const { inference_times_ms: _inferenceTimes, ...result } = extracted as typeof extracted & { inference_times_ms?: number[] };
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
      detector: recording.detector,
      sample_rate: recording.sample_rate,
      source: recording.source,
      frames: recording.frames,
      quality: { accepted_frames: recording.frames.length, rejected_frames: recording.rejected_frames ?? 0 },
      retargeting_profile: profile,
      retargeting_profile_version: RETARGETING_PROFILE_VERSION,
      ...(recording.video ? { video_id: recording.id } : {}),
    };
    const guarded = captureMode === "continuous" ? safeCameraGesture(recording.frames, joints, neutral, profile) : null;
    try {
      await onSave(capture, guarded?.positions ?? recording.frames.map((frame) => retargetLandmarkFrame(frame, joints, neutral, profile)));
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
  async function acceptRecording(recording: CameraRecording) {
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
  }
  return { rows, selected, status, setStatus, busy, extracting, progress, storageFailed,
    select, extract, saveDemonstration, retrySave, remove, acceptRecording,
    cancelExtraction: () => abort.current?.abort() };
}
