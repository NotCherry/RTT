import { useEffect, useRef, useState } from "react";
import type { LandmarkFrame } from "@/types";
import type { CameraRecording } from "@/domain/cameraArchive";
import { fuseCameraViews, fuseRecordedViews } from "@/domain/multiCameraPose";
import type {
  CameraCalibration,
  CameraInput,
  PoseFusionModel,
} from "@/domain/multiCameraContract";
import { useCameraCapture } from "./useCameraCapture";
import { hasUsablePose } from "@/domain/retargeting";
import { visiblePosePoint } from "@/domain/retargetingGeometry";
import { directIpCameraStreamUrl } from "@/domain/ipCamera";
import { defaultCameraInputs, loadCameraSetup, saveCameraSetup } from "@/domain/cameraSetup";
import { nearestCameraFrame, TRIANGULATION_SYNC_MS } from "@/domain/cameraViewAlignment";

type Options = Parameters<typeof useCameraCapture>[0];
export function useMultiCameraCapture(options: Options, setupKey?: string) {
  const current = useRef(options);
  current.current = options;
  const savedSetup = useRef(loadCameraSetup(setupKey));
  const [inputs, setInputs] = useState<CameraInput[]>(() => defaultCameraInputs().map((input, i) => savedSetup.current?.inputs[i] ?? input));
  const [count, setCount] = useState(savedSetup.current?.inputs.length ?? 1);
  const [setupName, setSetupName] = useState(savedSetup.current?.name ?? "My camera setup");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [model, setModel] = useState<PoseFusionModel>(savedSetup.current?.model ?? "body-aligned");
  const [calibration, setCalibration] = useState<CameraCalibration | undefined>(savedSetup.current?.calibration);
  const [message, setMessage] = useState("");
  const [opening, setOpening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [latest, setLatest] = useState<(LandmarkFrame | null)[]>([
    null,
    null,
    null,
  ]);
  const observed = useRef<(LandmarkFrame | null)[]>([null, null, null]);
  const history = useRef<LandmarkFrame[][]>([[], [], []]);
  const batch = useRef<{
    count: number;
    model: PoseFusionModel;
    calibration?: CameraCalibration;
    clips: Map<number, CameraRecording>;
  } | null>(null);
  const lifecycle = useRef(0);
  const ready = useRef(false);
  const mounted = useRef(true);

  function frame(index: number, value: LandmarkFrame | null) {
    observed.current[index] = value;
    history.current[index] = value ? [...history.current[index], value].slice(-6) : [];
    setLatest([...observed.current]);
    // Only the primary clock drives targets; supplementary cameras never refresh a stale primary view.
    const mismatched =
      model === "triangulated" &&
      count > 1 &&
      observed.current.slice(0, count).some((f, i) => {
        const c = calibration?.cameras.find((c) => c.id === inputs[i].id);
        return (
          f &&
          (!c || f.source_width !== c.width || f.source_height !== c.height)
        );
      });
    if (mismatched)
      setMessage(
        "Capture resolution does not match calibration. Close cameras and recalibrate at this resolution.",
      );
    if (index === 0)
      current.current.onFrame(
        ready.current && !mismatched
          ? fuseCameraViews(
              inputs
                .slice(0, count)
                .map((input, i) => ({
                  id: input.id,
                  frame: i === 0 ? value : value ? nearestCameraFrame(history.current[i], value.timestamp, model === "triangulated" ? TRIANGULATION_SYNC_MS : 100) : null,
                })),
              model,
              calibration,
            )
          : null,
      );
  }
  async function recorded(index: number, clip: CameraRecording) {
    if (count === 1) return current.current.onRecording(clip);
    const group = batch.current;
    if (!group) return;
    group.clips.set(index, clip);
    if (group.clips.size !== group.count) return;
    batch.current = null;
    const primary = group.clips.get(0)!;
    const views = Array.from({ length: group.count }, (_, i) => {
      const c = group.clips.get(i)!;
      return {
        id: `view-${i + 1}`,
        source: c.source as Exclude<
          CameraRecording["source"],
          { kind: "multi-camera" }
        >,
        offset_ms:
          (c.recording_start_ms ?? 0) - (primary.recording_start_ms ?? 0),
        duration_ms: c.duration_ms,
        width: c.width,
        height: c.height,
        frames: c.frames,
        video: c.video,
      };
    });
    const frames = fuseRecordedViews(views, group.model, group.calibration);
    setSaving(true);
    try {
      await current.current.onRecording({
        ...primary,
        views,
        frames,
        processed: Array.from(group.clips.values()).every((c) => c.processed),
        rejected_frames:
          Math.max(0, primary.frames.length - frames.length) +
          (primary.rejected_frames ?? 0),
        source: {
          kind: "multi-camera",
          stream_count: group.count as 2 | 3,
          model: group.model,
          calibration: group.calibration,
        },
      });
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  function recordingError(index: number, error: string) {
    const remaining = cameras.slice(0, count).filter((camera, i) => i !== index && camera.connected);
    if (ready.current && count === 3 && index !== 0 && remaining.length === 2
      && !batch.current && !active.some(camera => camera.recording || camera.finalizing)) {
      cameras[index].close();
      observed.current[index] = null;
      history.current[index] = [];
      setLatest([...observed.current]);
      setMessage(`Camera ${index + 1} unavailable · continuing live with two views. ${error} Reopen the full setup before recording.`);
      return;
    }
    batch.current = null;
    close();
    if (mounted.current) setMessage(error);
  }
  const acceptFrame = (f: LandmarkFrame) =>
    hasUsablePose(f) ||
    (count > 1 && [11, 12, 23, 24].every((i) => visiblePosePoint(f.pose[i])));
  const first = useCameraCapture({
    ...options,
    acceptFrame,
    onFrame: (value) => frame(0, value),
    onRecording: (clip) => recorded(0, clip),
    onRecordingError: error => recordingError(0, error),
  });
  const second = useCameraCapture({
    ...options,
    acceptFrame,
    onFrame: (value) => frame(1, value),
    onRecording: (clip) => recorded(1, clip),
    onRecordingError: error => recordingError(1, error),
  });
  const third = useCameraCapture({
    ...options,
    acceptFrame,
    onFrame: (value) => frame(2, value),
    onRecording: (clip) => recorded(2, clip),
    onRecordingError: error => recordingError(2, error),
  });
  const cameras = [first, second, third];
  const active = cameras.slice(0, count);
  async function refreshDevices(askPermission = false) {
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.enumerateDevices)
        throw new Error("Camera selection requires localhost or HTTPS.");
      if (askPermission)
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            resizeMode: "none",
          } as MediaTrackConstraints,
          audio: false,
        });
      const list = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === "videoinput",
      );
      if (mounted.current) setDevices(list);
    } catch (error) {
      if (mounted.current && askPermission)
        setMessage(
          error instanceof Error ? error.message : "Cannot list cameras.",
        );
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refreshDevices();
    const changed = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", changed);
    return () => {
      mounted.current = false;
      lifecycle.current++;
      navigator.mediaDevices?.removeEventListener?.("devicechange", changed);
    };
  }, []);
  function close() {
    lifecycle.current++;
    ready.current = false;
    cameras.forEach((camera) => camera.close());
    observed.current = [null, null, null];
    history.current = [[], [], []];
    if (mounted.current) {
      setOpening(false);
      setLatest([null, null, null]);
    }
  }
  async function open(kind: "local" | "ip", address: string) {
    close();
    setMessage("");
    const selected = [
      { ...inputs[0], kind, address },
      ...inputs.slice(1, count),
    ];
    const local = selected.filter((v) => v.kind === "local");
    if (
      count > 1 &&
      (local.some((v) => !v.deviceId) ||
        new Set(local.map((v) => v.deviceId)).size !== local.length)
    ) {
      setMessage(
        "Choose a different USB camera for each local view. Use Detect cameras to list devices.",
      );
      return;
    }
    try {
      const remote = selected
        .filter((v) => v.kind === "ip")
        .map((v) => directIpCameraStreamUrl(v.address));
      if (new Set(remote).size !== remote.length) {
        setMessage("Choose a different IP stream for each view.");
        return;
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Invalid IP camera URL.",
      );
      return;
    }
    if (
      model === "triangulated" &&
      count > 1 &&
      (!calibration ||
        selected.some((v) => !calibration.cameras.some((c) => c.id === v.id)))
    ) {
      setMessage(
        "Import calibration for every selected view before triangulating.",
      );
      return;
    }
    const generation = lifecycle.current;
    setOpening(true);
    const openedDevices = new Set<string>();
    try {
      for (let i = 0; i < selected.length; i++) {
        const input = selected[i];
        const opened = await cameras[i].open(
          input.kind,
          input.address,
          input.deviceId,
        );
        if (generation !== lifecycle.current) return;
        if (!opened) {
          close();
          setMessage(
            `Camera ${i + 1} could not open. Check its source and permissions.`,
          );
          return;
        }
        if (input.kind === "local") {
          const stream = cameras[i].videoRef.current
            ?.srcObject as MediaStream | null;
          const physicalId = stream
            ?.getVideoTracks?.()[0]
            ?.getSettings?.().deviceId;
          if (physicalId && openedDevices.has(physicalId)) {
            close();
            setMessage(
              "Two inputs resolve to the same USB camera. Choose distinct devices.",
            );
            return;
          }
          if (physicalId) openedDevices.add(physicalId);
        }
      }
      await refreshDevices();
      if (generation !== lifecycle.current) return;
      ready.current = true;
      return true;
    } finally {
      if (mounted.current && generation === lifecycle.current)
        setOpening(false);
    }
  }
  function startRecording() {
    if (
      !active.every((c) => c.connected) ||
      active.some((c) => c.recording || c.finalizing)
    )
      return;
    setMessage("");
    batch.current =
      count > 1 ? { count, model, calibration, clips: new Map() } : null;
    for (const c of active) {
      c.startRecording();
      // A failed recorder synchronously cancels the group.
      if (count > 1 && !batch.current) break;
    }
  }
  const status =
    message ||
    (opening
      ? "Connecting camera views…"
      : count === 1
        ? first.status
        : active.map((c, i) => `Camera ${i + 1}: ${c.status}`).join(" · "));
  return {
    ...first,
    connected: active.some((c) => c.connected),
    allConnected: active.every((c) => c.connected),
    opening: opening || active.some((c) => c.opening),
    recording: active.some((c) => c.recording),
    finalizing: saving || active.some((c) => c.finalizing),
    status,
    open,
    close,
    startRecording,
    stopRecording: () => active.forEach((c) => c.stopRecording()),
    rig: {
      inputs: inputs.slice(0, count),
      cameras: active,
      latest,
      devices,
      model,
      calibration,
      setupName,
      setSetupName,
      setCount: (value: number) => {
        if (![1, 2, 3].includes(value)) return;
        close();
        setCount(value);
        setCalibration(undefined);
      },
      saveSetup: () => {
        try {
          if (!setupKey) throw new Error("Open a robot before saving the camera setup.");
          saveCameraSetup(setupKey, { version: 1, name: setupName.trim() || "My camera setup", inputs: inputs.slice(0, count), model, calibration });
          setMessage("Camera setup saved on this device.");
        } catch (error) { setMessage(error instanceof Error ? error.message : "Camera setup could not be saved."); }
      },
      add: () => {
        close();
        setCount((n) => Math.min(3, n + 1));
      },
      remove: () => {
        close();
        setCount((n) => Math.max(1, n - 1));
      },
      update: (index: number, patch: Partial<CameraInput>) => {
        setCalibration(undefined);
        setInputs((rows) =>
          rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
        );
      },
      setModel,
      setCalibration,
      refreshDevices: () => refreshDevices(true),
    },
  };
}
