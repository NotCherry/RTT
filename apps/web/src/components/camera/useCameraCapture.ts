import { useEffect, useRef, useState } from "react";
import type { CameraCapture, LandmarkFrame } from "@/types";
import type { CameraRecording } from "@/domain/cameraArchive";
import { createCameraDetector, detectCameraFrame, type CameraDetector } from "@/domain/cameraProcessing";
import { directIpCameraStreamUrl, gatewayCameraIdentity } from "@/domain/ipCamera";
import { openCameraGatewayStream } from "@/domain/cameraGatewayStream";
import { hasUsablePose } from "@/domain/retargeting";
import { cameraFrameMetrics } from "@/domain/cameraFrameMetrics";
import type { CameraDetectorModel } from "@/domain/cameraDetectorModels";
import { createImageFreshnessProbe } from "@/domain/cameraImageFreshness";

export function useCameraCapture(options: {
  processing: "live" | "offline";
  detector?: CameraDetectorModel;
  sampleRate: CameraCapture["sample_rate"];
  onFrame: (frame: LandmarkFrame | null) => void;
  onRecording: (recording: CameraRecording) => Promise<void>;
  onRecordingError?: (message: string) => void;
  acceptFrame?: (frame: LandmarkFrame) => boolean;
}) {
  const current = useRef(options);
  current.current = options;
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const resources = useRef<{
    stream?: MediaStream;
    detector?: CameraDetector;
    raf?: number;
    recorder?: MediaRecorder;
    generation: number;
    source?: CameraCapture["source"];
    frames: LandmarkFrame[];
    start: number;
    rejected: number;
    recording: boolean;
    processingFailed?: boolean;
    gateway?: ReturnType<typeof openCameraGatewayStream>;
  }>({ generation: 0, frames: [], start: 0, rejected: 0, recording: false });
  const [connected, setConnected] = useState(false);
  const [opening, setOpening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const stoppedAt = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState("Camera off");
  const [metrics, setMetrics] = useState(() => cameraFrameMetrics([], [], 0, "not started"));
  const mounted = useRef(true);

  function stopRecording() {
    const r = resources.current;
    if (r.recorder?.state === "recording") {
      stoppedAt.current = performance.now();
      if (mounted.current) setFinalizing(true);
      r.recorder.stop();
    }
    r.recording = false;
    if (mounted.current) setRecording(false);
  }
  function close() {
    const r = resources.current;
    r.generation++;
    stopRecording();
    if (r.raf) cancelAnimationFrame(r.raf);
    r.detector?.close();
    r.detector = undefined;
    r.gateway?.close(); r.gateway = undefined;
    r.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    r.stream = undefined;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (imageRef.current) imageRef.current.removeAttribute("src");
    r.source = undefined;
    if (mounted.current) {
      setConnected(false);
      setOpening(false);
      setStatus("Camera off");
      setMetrics(cameraFrameMetrics([], [], 0, "not started"));
      current.current.onFrame(null);
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      close();
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed(performance.now() - resources.current.start), 250);
    return () => clearInterval(timer);
  }, [recording]);

  async function open(source: "local" | "ip", address: string, deviceId = "") {
    close();
    const r = resources.current;
    const generation = r.generation;
    setOpening(true);
    setStatus("Connecting camera…");
    try {
      if (source === "local") {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("Camera access requires localhost or HTTPS and browser camera support.");
        const videoConstraints: MediaTrackConstraints & { resizeMode: string } = {
          width: { ideal: 1280 }, resizeMode: "none",
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        };
        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
        if (generation !== r.generation) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        r.stream = stream;
        stream.getVideoTracks().forEach(track => { track.onended = () => { close(); current.current.onRecordingError?.("Camera disconnected. Reopen all views before recording."); }; });
        const video = videoRef.current;
        if (!video) throw new Error("Camera preview is unavailable.");
        video.srcObject = stream;
        await video.play();
        r.source = { kind: "local-media-stream", stream_count: 1 };
      } else {
        const url = directIpCameraStreamUrl(address);
        if (location.protocol === "https:" && url.startsWith("http:"))
          throw new Error("An HTTPS workbench requires an HTTPS IP camera.");
        const image = imageRef.current;
        if (!image) throw new Error("IP preview is unavailable.");
        const identity = gatewayCameraIdentity(address);
        if (identity) {
          r.gateway = openCameraGatewayStream(identity, image, error => { close(); current.current.onRecordingError?.(error); });
          await r.gateway.ready;
        } else {
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            clearTimeout(timer);
            image.onload = image.onerror = null;
            if (error) reject(error);
            else resolve();
          };
          const timer = setTimeout(
            () => finish(new Error("IP camera timed out. Check its address and network access.")),
            15000,
          );
          image.onload = () => finish();
          image.onerror = () =>
            finish(
              new Error(
                "IP camera could not be read. Check the URL and enable cross-origin (CORS) access on the camera.",
              ),
            );
          image.crossOrigin = "anonymous";
          image.src = url;
        });
        }
        r.source = { kind: "ip-image-stream", url };
      }
      if (generation !== r.generation) return;
      if (current.current.processing === "live") {
        setStatus("Loading local pose model…");
        const detector = await createCameraDetector(current.current.detector);
        if (generation !== r.generation) {
          detector.close();
          return;
        }
        r.detector = detector;
      }
      setConnected(true);
      setOpening(false);
      setStatus(r.detector ? "Live processing ready" : "Camera ready to record; extract landmarks later");
      let last = -Infinity;
      let lastMediaTime = -Infinity;
      let lastGatewaySequence = "";
      const times: number[] = [], durations: number[] = [];
      let dropped = 0;
      const receivedCounts: { at: number; count: number }[] = [];
      const imageFresh = source === "ip" ? createImageFreshnessProbe() : undefined;
      const tick = async () => {
        if (generation !== r.generation) return;
        const timestamp = performance.now();
        const input = source === "local" ? videoRef.current : imageRef.current;
        if (input && r.detector && timestamp - last >= 1000 / current.current.sampleRate) {
          if (input instanceof HTMLImageElement && (input.dataset.cameraLoading === "true" || (input.dataset.cameraSequence && input.dataset.cameraSequence === lastGatewaySequence))) {
            r.raf = requestAnimationFrame(tick); return;
          }
          if (input instanceof HTMLVideoElement && input.currentTime===lastMediaTime) {
            r.raf=requestAnimationFrame(tick);
            return;
          }
          if (input instanceof HTMLVideoElement) lastMediaTime=input.currentTime;
          if (input instanceof HTMLImageElement && input.dataset.cameraSequence) lastGatewaySequence = input.dataset.cameraSequence;
          const sourceAge = input instanceof HTMLImageElement && input.dataset.cameraReceivedAt
            ? Number(input.dataset.cameraSourceAge) + timestamp - Number(input.dataset.cameraReceivedAt) : 0;
          const provenance = input instanceof HTMLVideoElement ? { media_time_ms: input.currentTime*1000, source_clock: "browser-media" as const }
            : input.dataset.cameraSequence ? { source_sequence: input.dataset.cameraSequence, source_age_ms: sourceAge, source_clock: "backend-decode" as const } : {};
          if (Number.isFinite(last)) dropped += Math.max(0, Math.floor((timestamp - last) * current.current.sampleRate / 1000) - 1);
          last = timestamp;
          try {
            if (input instanceof HTMLImageElement && imageFresh && !imageFresh(input, timestamp)) {
              setStatus("IP camera pixels repeated · tracking held until the image changes");
              current.current.onFrame(null); r.raf = requestAnimationFrame(tick); return;
            }
            if (imageFresh) setStatus("Live processing ready");
            const frame = await detectCameraFrame(r.detector, input, timestamp);
            if (generation !== r.generation) return;
            const processedAt = performance.now();
            times.push(processedAt); durations.push(processedAt - timestamp);
            if (times.length > 60) { times.shift(); durations.shift(); }
            if (input instanceof HTMLVideoElement && typeof input.getVideoPlaybackQuality === "function") {
              receivedCounts.push({ at: processedAt, count: input.getVideoPlaybackQuality().totalVideoFrames });
              if (receivedCounts.length > 60) receivedCounts.shift();
            }
            const receivedFirst = receivedCounts[0], receivedLast = receivedCounts.at(-1);
            const receivedFps = receivedFirst && receivedLast && receivedLast.at > receivedFirst.at && receivedLast.count > receivedFirst.count
              ? (receivedLast.count-receivedFirst.count)*1000/(receivedLast.at-receivedFirst.at) : null;
            setMetrics(cameraFrameMetrics(times, durations, dropped, r.detector.mode ?? "main-thread" , receivedFps));
            const accepted = frame && sourceAge + processedAt - timestamp <= 250 && (current.current.acceptFrame ?? hasUsablePose)(frame)
              ? { ...frame, timing: { ...provenance, observed_at_ms: timestamp, processed_at_ms: processedAt, source: "browser-observation" as const } } : null;
            current.current.onFrame(accepted);
            if (r.recording) {
              if (accepted) r.frames.push({ ...accepted, timestamp: timestamp - r.start,
                timing: { ...accepted.timing!, observed_at_ms: timestamp - r.start, processed_at_ms: processedAt - r.start } });
              else r.rejected++;
            }
          } catch (error) {
            if (generation !== r.generation) return;
            setStatus(
              `Live processing stopped: ${error instanceof Error ? error.message : "Unknown error"}. Reopen the camera to retry.`,
            );
            r.processingFailed = true;
            r.detector?.close();
            r.detector = undefined;
            current.current.onFrame(null);
          }
        }
        r.raf = requestAnimationFrame(tick);
      };
      r.raf = requestAnimationFrame(tick);
      return true;
    } catch (error) {
      if (generation !== r.generation) return;
      close();
      setStatus(error instanceof Error ? error.message : "Camera could not be opened.");
    }
  }

  function startRecording() {
    const r = resources.current;
    if (!connected || r.recording || r.recorder) return;
    let canvasLoop: number | undefined;
    let canvasStream: MediaStream | undefined;
    try {
      if (typeof MediaRecorder === "undefined") throw new Error("This browser does not support video recording.");
      let stream = r.stream;
      if (r.source?.kind === "ip-image-stream") {
        const image = imageRef.current!;
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context || !canvas.captureStream) throw new Error("This browser cannot record an IP stream.");
        context.drawImage(image, 0, 0);
        // Reject tainted canvases before starting a recorder.
        context.getImageData(0, 0, 1, 1);
        canvasStream = canvas.captureStream(current.current.sampleRate);
        stream = canvasStream;
        const draw = () => {
          context.drawImage(image, 0, 0);
          canvasLoop = requestAnimationFrame(draw);
        };
        canvasLoop = requestAnimationFrame(draw);
      }
      if (!stream) throw new Error("Open a camera before recording.");
      const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = [];
      const source = r.source!;
      const width =
        source.kind === "local-media-stream" ? videoRef.current?.videoWidth : imageRef.current?.naturalWidth;
      const height =
        source.kind === "local-media-stream" ? videoRef.current?.videoHeight : imageRef.current?.naturalHeight;
      const sampleRate = current.current.sampleRate;
      const onRecording = current.current.onRecording;
      const processed = Boolean(r.detector);
      const created = new Date();
      const id = `camera-${crypto.randomUUID()}`;
      const cleanup = () => {
        if (canvasLoop !== undefined) cancelAnimationFrame(canvasLoop);
        canvasStream?.getTracks().forEach((track) => track.stop());
      };
      let failed = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        failed = true;
        cleanup();
        r.recording = false;
        if (mounted.current) {
          setRecording(false);
          setFinalizing(false);
          setStatus("Video recording failed. Retry with a supported camera/browser.");
        }
        current.current.onRecordingError?.("Video recording failed. Retry with a supported camera/browser.");
      };
      recorder.onstop = () => {
        cleanup();
        const result: CameraRecording = {
          id,
          name: `Camera recording ${created.toLocaleString()}`,
          created_at: created.toISOString(),
          source,
          width,
          height,
          sample_rate: sampleRate,
          duration_ms: (stoppedAt.current || performance.now()) - r.start,
          frames: [...r.frames],
          rejected_frames: r.rejected,
          processed: processed && !r.processingFailed,
          detector: current.current.detector ?? "holistic",
          recording_start_ms: r.start,
          video: new Blob(chunks, { type: recorder.mimeType || mimeType || "video/webm" }),
        };
        r.recorder = undefined;
        if (!failed)
          void onRecording(result)
            .catch((error) => {
              if (mounted.current) setStatus(error instanceof Error ? error.message : "Recording could not be saved.");
            })
            .finally(() => {
              if (mounted.current) setFinalizing(false);
            });
      };
      stoppedAt.current = 0;
      r.processingFailed = false;
      setElapsed(0);
      r.frames = [];
      r.rejected = 0;
      r.start = performance.now();
      r.recording = true;
      r.recorder = recorder;
      recorder.start(1000);
      setRecording(true);
      setStatus("Recording video on this device");
    } catch (error) {
      if (canvasLoop !== undefined) cancelAnimationFrame(canvasLoop);
      canvasStream?.getTracks().forEach((track) => track.stop());
      r.recording = false;
      r.recorder = undefined;
      setStatus(error instanceof Error ? error.message : "Recording could not start. Check IP camera CORS support.");
      current.current.onRecordingError?.(error instanceof Error ? error.message : "Recording could not start.");
    }
  }
  return {
    videoRef,
    imageRef,
    connected,
    opening,
    recording,
    finalizing,
    elapsed,
    status,
    metrics,
    open,
    close,
    startRecording,
    stopRecording,
  };
}
