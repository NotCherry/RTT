import { useEffect, useRef, useState } from "react";
import { Button, Panel, PanelHeader, PanelLabel, StatusPill } from "@/components/ui";
import { H2, H3, IntroCopy, Kicker } from "@/components/ui/typography";
import { RobotViewport } from "@/components/workbench/RobotViewport";
import { hasUsablePose, retargetLandmarkFrame, type RetargetingAdjustments, type RetargetingProfile } from "@/domain/retargeting";
import { cameraErrorMessage } from "@/domain/cameraErrors";
import { directIpCameraStreamUrl } from "@/domain/ipCamera";
import type { CameraCapture, Joint, LandmarkFrame, Robot, SimulationState } from "@/types";

type Props = {
  robot: Robot | null;
  state: SimulationState | null;
  joints: Joint[];
  neutral: number[];
  onPreview: (positions: number[]) => void;
  onSave: (capture: CameraCapture, positions: number[][]) => Promise<void>;
};

const MODEL_URL = "/mediapipe/models/holistic_landmarker.task";
const WASM_URL = "/mediapipe/wasm";

function toPoints(points: Array<{ x: number; y: number; z: number; visibility?: number }>) {
  return points.map(({ x, y, z, visibility }) => ({ x, y, z, visibility }));
}

export function CameraTeachingPage({ robot, state, joints, neutral, onPreview, onSave }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const landmarkerRef = useRef<{ detectForVideo: (source: HTMLVideoElement | HTMLImageElement, timestamp: number) => any; close: () => void } | null>(null);
  const rafRef = useRef<number | null>(null);
  const replayTimerRef = useRef<number | null>(null);
  const recordedVideoUrlRef = useRef<string | null>(null);
  const countdownRef = useRef<number | null>(null);
  const recordingRef = useRef<LandmarkFrame[]>([]);
  const isRecordingRef = useRef(false);
  const lastSampleRef = useRef(-Infinity);
  const [status, setStatus] = useState("Camera off");
  const [mode, setMode] = useState<"simple" | "continuous">("simple");
  const [processing, setProcessing] = useState<"live" | "offline">("live");
  const [sampleRate, setSampleRate] = useState<10 | 15 | 30>(15);
  const [profile, setProfile] = useState<RetargetingProfile>("g1-upper-body");
  const [countdown, setCountdown] = useState(3);
  const [recording, setRecording] = useState(false);
  const [frames, setFrames] = useState<LandmarkFrame[]>([]);
  const [latest, setLatest] = useState<LandmarkFrame | null>(null);
  const [adjustments] = useState<RetargetingAdjustments>({});
  const [cameraSource, setCameraSource] = useState<"local" | "ip">("local");
  const [ipCameraUrl, setIpCameraUrl] = useState("");
  const [activeIpCameraUrl, setActiveIpCameraUrl] = useState("");
  const [recordedVideoUrl, setRecordedVideoUrl] = useState<string | null>(null);

  const stopCamera = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (replayTimerRef.current) window.clearTimeout(replayTimerRef.current);
    if (countdownRef.current) window.clearInterval(countdownRef.current);
    countdownRef.current = null;
    rafRef.current = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current?.stop();
    recorderRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (imageRef.current) imageRef.current.src = "";
    setRecording(false);
    isRecordingRef.current = false;
    setStatus("Camera off");
  };

  useEffect(() => () => {
    stopCamera();
    if (recordedVideoUrlRef.current) URL.revokeObjectURL(recordedVideoUrlRef.current);
  }, []);

  const draw = (frame: LandmarkFrame | null) => {
    const video = videoRef.current;
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = video?.videoWidth || image?.naturalWidth || 640;
    canvas.height = video?.videoHeight || image?.naturalHeight || 480;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!frame) return;
    context.fillStyle = "#75b5ff";
    for (const point of [...frame.pose, ...frame.left_hand, ...frame.right_hand]) {
      context.beginPath();
      context.arc(point.x * canvas.width, point.y * canvas.height, 3, 0, Math.PI * 2);
      context.fill();
    }
  };

  const tick = () => {
    const video = videoRef.current;
    const image = imageRef.current;
    const source = cameraSource === "ip" ? image : video;
    const landmarker = landmarkerRef.current;
    const ready = cameraSource === "ip"
      ? Boolean(image?.complete && image.naturalWidth)
      : Boolean(video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
    if (!source || !landmarker || !ready) {
      rafRef.current = requestAnimationFrame(tick);
      return;
    }
    const timestamp = performance.now();
    try {
      const result = landmarker.detectForVideo(source, timestamp);
      const pose = result.poseLandmarks?.[0] ?? [];
      const next: LandmarkFrame | null = pose.length
        ? {
            timestamp,
            pose: toPoints(pose),
            left_hand: toPoints(result.leftHandLandmarks?.[0] ?? []),
            right_hand: toPoints(result.rightHandLandmarks?.[0] ?? []),
            confidence: pose.reduce((sum: number, point: { visibility?: number }) => sum + (point.visibility ?? 1), 0) / pose.length,
          }
        : null;
      if (next) {
        setLatest(next);
        draw(next);
        const interval = 1000 / sampleRate;
        if (processing === "live" && isRecordingRef.current && timestamp - lastSampleRef.current >= interval && hasUsablePose(next)) {
          lastSampleRef.current = timestamp;
          recordingRef.current.push(next);
          const mapped = retargetLandmarkFrame(next, joints, neutral, profile, adjustments);
          onPreview(mapped);
        }
      } else draw(null);
    } catch {
      setStatus("Landmark processing paused. Reopen the camera to retry.");
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  async function startLandmarker() {
    setStatus("Loading local pose model…");
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
    const createLandmarker = (delegate: "GPU" | "CPU") => vision.HolisticLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate }, runningMode: "VIDEO", minPosePresenceConfidence: 0.5, minHandLandmarksConfidence: 0.5,
    });
    try { landmarkerRef.current = await createLandmarker("GPU"); setStatus("Live IP/local pose estimation · GPU"); }
    catch { landmarkerRef.current = await createLandmarker("CPU"); setStatus("Live IP/local pose estimation · CPU fallback"); }
    tick();
  }

  async function openCamera() {
    if (!robot) return;
    try {
      setStatus("Requesting local camera…");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      await startLandmarker();
    } catch (cause) {
      stopCamera();
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      setStatus(cameraErrorMessage(cause, devices.filter((device) => device.kind === "videoinput").length));
    }
  }

  async function openIpCamera() {
    if (!robot || !ipCameraUrl.trim() || !imageRef.current) return;
    let streamUrl: string;
    try { streamUrl = directIpCameraStreamUrl(ipCameraUrl); }
    catch { setStatus("Enter a complete IP camera URL, for example http://10.189.224.16:4444"); return; }
    if (location.protocol === "https:" && streamUrl.startsWith("http:")) {
      setStatus("This HTTPS workbench cannot load an HTTP IP camera. Open the workbench over HTTP on your LAN, or configure HTTPS on the camera.");
      return;
    }
    try {
      setStatus("Connecting to IP camera…");
      await new Promise<void>((resolve, reject) => {
        const image = imageRef.current!;
        image.onload = () => resolve(); image.onerror = () => reject(new Error("The IP stream could not be loaded. Check its URL and LAN access."));
        image.src = streamUrl;
      });
      setActiveIpCameraUrl(streamUrl);
      await startLandmarker();
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "The IP stream could not be loaded."); }
  }

  function selectPose() {
    if (!latest || !hasUsablePose(latest)) {
      setStatus("Stand in view until a confident pose is visible.");
      return;
    }
    const capture = buildCapture("simple", [latest]);
    const mapped = retargetLandmarkFrame(latest, joints, neutral, profile, adjustments);
    onPreview(mapped);
    void onSave(capture, [mapped]).then(() => setStatus("Pose saved locally to the archive."));
  }

  function startGesture() {
    recordingRef.current = [];
    lastSampleRef.current = -Infinity;
    let remaining = countdown;
    setStatus(`Recording begins in ${remaining}…`);
    countdownRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) setStatus(`Recording begins in ${remaining}…`);
      else {
        if (countdownRef.current) window.clearInterval(countdownRef.current);
        countdownRef.current = null;
        if (processing === "offline" && streamRef.current) {
          const chunks: BlobPart[] = [];
          const recorder = new MediaRecorder(streamRef.current, { mimeType: "video/webm" });
          recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
          recorder.onstop = () => void processRecording(new Blob(chunks, { type: "video/webm" }));
          recorder.start();
          recorderRef.current = recorder;
        }
        isRecordingRef.current = true;
        setRecording(true);
        setStatus(processing === "live" ? "Recording landmark frames locally" : "Recording locally; processing will follow");
      }
    }, 1000);
  }

  function stopGesture() {
    setRecording(false);
    isRecordingRef.current = false;
    if (processing === "offline" && recorderRef.current?.state === "recording") {
      setStatus("Processing recorded video locally…");
      recorderRef.current.stop();
      recorderRef.current = null;
      return;
    }
    saveGesture(recordingRef.current);
  }

  async function processRecording(blob: Blob) {
    const url = URL.createObjectURL(blob);
    if (recordedVideoUrlRef.current) URL.revokeObjectURL(recordedVideoUrlRef.current);
    recordedVideoUrlRef.current = url;
    setRecordedVideoUrl(url);
    const video = document.createElement("video");
    video.muted = true;
    video.src = url;
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("Recorded video could not be decoded."));
      });
      const captured: LandmarkFrame[] = [];
      const interval = 1 / sampleRate;
      for (let seconds = 0; seconds < video.duration; seconds += interval) {
        video.currentTime = seconds;
        await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
        const timestamp = Math.round(seconds * 1000);
        const result = landmarkerRef.current?.detectForVideo(video, timestamp);
        const pose = result?.poseLandmarks?.[0] ?? [];
        if (pose.length) {
          const next: LandmarkFrame = {
            timestamp,
            pose: toPoints(pose),
            left_hand: toPoints(result.leftHandLandmarks?.[0] ?? []),
            right_hand: toPoints(result.rightHandLandmarks?.[0] ?? []),
            confidence: pose.reduce((sum: number, point: { visibility?: number }) => sum + (point.visibility ?? 1), 0) / pose.length,
          };
          if (hasUsablePose(next)) captured.push(next);
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      saveGesture(captured);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Local video processing failed.");
    } finally {
      // Keep this local-only URL alive for the on-page recording review.
    }
  }

  function saveGesture(capturedInput: LandmarkFrame[]) {
    const captured = [...capturedInput];
    setFrames(captured);
    if (!captured.length) {
      setStatus("No confident frames were captured.");
      return;
    }
    const capture = buildCapture("continuous", captured);
    const mapped = captured.map((frame) => retargetLandmarkFrame(frame, joints, neutral, profile, adjustments));
    onPreview(mapped[mapped.length - 1]);
    void onSave(capture, mapped).then(() =>
      setStatus(`Saved ${captured.length} local landmark frames and a trainable gesture.`),
    );
  }

  function replayGestureOnRobot() {
    if (!frames.length) return;
    if (replayTimerRef.current) window.clearTimeout(replayTimerRef.current);
    const play = (index: number) => {
      const frame = frames[index];
      if (!frame) return;
      onPreview(retargetLandmarkFrame(frame, joints, neutral, profile, adjustments));
      const next = frames[index + 1];
      if (next) replayTimerRef.current = window.setTimeout(() => play(index + 1), Math.max(1, next.timestamp - frame.timestamp));
    };
    play(0);
    setStatus(`Replaying ${frames.length} stick-figure frames on the robot.`);
  }

  function buildCapture(captureMode: "simple" | "continuous", captured: LandmarkFrame[]): CameraCapture {
    return {
      id: `camera-${Date.now()}`,
      version: 1,
      name: captureMode === "simple" ? "Camera pose" : "Camera gesture",
      created_at: new Date().toISOString(),
      mode: captureMode,
      sample_rate: sampleRate,
      source: cameraSource === "ip" ? { kind: "ip-image-stream", url: activeIpCameraUrl } : { kind: "local-media-stream", stream_count: 1 },
      frames: captured,
      quality: { accepted_frames: captured.length, rejected_frames: 0 },
      retargeting_profile: profile,
      retargeting_profile_version: 1,
    };
  }

  return <div className="route-page">
    <div className="route-heading"><div><Kicker>TEACH / CAMERA</Kicker><H2>Teach from your movement.</H2><IntroCopy>Camera pixels stay on this device. Capture a stick figure, then retarget its observable upper-body motion to the robot.</IntroCopy></div><StatusPill online={Boolean(streamRef.current)}>{status}</StatusPill></div>
    <div className="route-two-column">
      <Panel className="route-viewport-panel"><PanelHeader><div><PanelLabel>{cameraSource === "ip" ? "IP CAMERA" : "LOCAL CAMERA"}</PanelLabel><H3>Stick-figure preview</H3></div><Button size="small" variant="secondary" onClick={streamRef.current || landmarkerRef.current ? stopCamera : cameraSource === "ip" ? openIpCamera : openCamera} disabled={!robot}>{streamRef.current || landmarkerRef.current ? "Close camera" : cameraSource === "ip" ? "Connect IP camera" : "Open camera"}</Button></PanelHeader>
        <div className="route-form-grid"><label>Video source<select aria-label="Video source" value={cameraSource} onChange={(event) => { const next = event.target.value as "local" | "ip"; setCameraSource(next); if (next === "ip") setProcessing("live"); }}><option value="local">Laptop / USB camera</option><option value="ip">Android IP camera</option></select></label>{cameraSource === "ip" && <label>IP camera URL<input aria-label="IP camera URL" value={ipCameraUrl} onChange={(event) => setIpCameraUrl(event.target.value)} placeholder="http://192.168.1.20:8080/video" /></label>}</div>
        {cameraSource === "ip" && <p className="helper-text">You can paste this Android IP Camera base address; it will use <code>/video/mjpeg</code> automatically. IP cameras use live mode only.</p>}
        <div className="relative aspect-video overflow-hidden rounded border border-border">{recordedVideoUrl ? <video controls src={recordedVideoUrl} className="h-full w-full object-cover" /> : <><video ref={videoRef} muted playsInline className={cameraSource === "local" ? "h-full w-full object-cover" : "hidden"} /><img ref={imageRef} alt="IP camera stream" className={cameraSource === "ip" ? "h-full w-full object-cover" : "hidden"} /><canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" /></>}</div>
      </Panel>
      <Panel className="route-content-panel"><PanelHeader><div><PanelLabel>CAMERA TEACHING</PanelLabel><H3>{mode === "simple" ? "Select a pose" : "Record a gesture"}</H3></div><span className="count-badge">{frames.length} frames</span></PanelHeader>
        <div className="route-form-grid"><label>Capture mode<select aria-label="Capture mode" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="simple">Simple pose</option><option value="continuous">Continuous gesture</option></select></label><label>Processing<select aria-label="Processing mode" value={processing} onChange={(event) => setProcessing(event.target.value as typeof processing)} disabled={cameraSource === "ip"}><option value="live">Live preview</option><option value="offline">Record then process</option></select></label><label>Sample rate<select aria-label="Sample rate" value={sampleRate} onChange={(event) => setSampleRate(Number(event.target.value) as typeof sampleRate)}><option value={10}>10 fps</option><option value={15}>15 fps</option><option value={30}>30 fps</option></select></label><label>Mapping profile<select aria-label="Mapping profile" value={profile} onChange={(event) => setProfile(event.target.value as RetargetingProfile)}><option value="g1-upper-body">G1 upper body</option><option value="g1-single-arm">Single right arm</option></select></label>{mode === "continuous" && <label>Countdown<select aria-label="Countdown" value={countdown} onChange={(event) => setCountdown(Number(event.target.value))}>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} seconds</option>)}</select></label>}</div>
        <RobotViewport robot={robot} state={state} title="Retargeted preview" label="ROBOT PREVIEW" />
        <div className="route-actions">{mode === "simple" ? <Button variant="primary" onClick={selectPose} disabled={!latest}>Select pose</Button> : recording ? <Button variant="recording" onClick={stopGesture}>Stop and save gesture</Button> : <Button variant="primary" onClick={startGesture} disabled={!landmarkerRef.current}>Start stick-figure capture</Button>}{frames.length > 1 && <Button variant="secondary" onClick={replayGestureOnRobot}>Play stick figure on robot</Button>}</div>
        <p className="helper-text">{status}. Video is never archived; only landmark frames and the derived robot demonstration are saved.</p>
      </Panel>
    </div>
  </div>;
}
