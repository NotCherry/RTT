import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { RobotViewport } from "@/components/workbench/RobotViewport";
import type { CameraRecording } from "@/domain/cameraArchive";
import { retargetLandmarkFrame, type RetargetingProfile } from "@/domain/retargeting";
import type { Joint, Robot, SimulationState } from "@/types";
import { StickFigure } from "./StickFigure";
import { MappingInspector } from "./MappingInspector";

export function RecordingPlayer({
  recording,
  robot,
  state,
  joints,
  neutral,
  profile,
  onPreview,
  locked = false,
}: {
  recording: CameraRecording;
  robot: Robot | null;
  state: SimulationState | null;
  joints: Joint[];
  neutral: number[];
  profile: RetargetingProfile;
  onPreview: (positions: number[]) => void;
  locked?: boolean;
}) {
  const [view, setView] = useState("side-by-side");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [motionPlayback, setMotionPlayback] = useState(false);
  const probing = useRef(false);
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState("");
  const [mediaDuration, setMediaDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timeRef = useRef(0);
  const preview = useRef(onPreview);
  preview.current = onPreview;
  const duration = Math.max(recording.duration_ms, recording.frames.at(-1)?.timestamp ?? 0, mediaDuration);
  useEffect(() => {
    if (!recording.video) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(recording.video);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [recording.video]);
  useEffect(() => {
    if (locked) setPlaying(false);
  }, [locked]);
  useEffect(() => {
    if (!playing || locked) {
      videoRef.current?.pause();
      return;
    }
    let raf = 0;
    const initialTime = timeRef.current;
    const start = performance.now();
    const video = videoRef.current;
    if (url && video && !motionPlayback) {
      video.playbackRate = speed;
      void video.play().catch(() => {
        setError("Video playback failed; extracted motion remains available.");
        setPlaying(false);
      });
    }
    const tick = () => {
      const next = Math.min(
        duration,
        url && video && !motionPlayback && !probing.current && Number.isFinite(video.currentTime)
          ? video.currentTime * 1000
          : initialTime + (performance.now() - start) * speed,
      );
      const cursor = video?.ended && url && !motionPlayback ? duration : next;
      timeRef.current = cursor;
      setTime(cursor);
      if (next >= duration || (video?.ended && url && !motionPlayback)) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      video?.pause();
    };
  }, [playing, duration, url, speed, locked, motionPlayback]);
  // Use the last observation at/before the cursor, without bridging long detection gaps.
  let candidate = undefined as CameraRecording["frames"][number] | undefined;
  for (const observation of recording.frames) {
    if (observation.timestamp > time) break;
    candidate = observation;
  }
  const frame = candidate && time - candidate.timestamp <= 2000 / recording.sample_rate ? candidate : null;
  useEffect(() => {
    preview.current(frame ? retargetLandmarkFrame(frame, joints, neutral, profile) : [...neutral]);
  }, [frame, joints, neutral, profile]);
  function seek(next: number) {
    setPlaying(false);
    timeRef.current = next;
    setTime(next);
    if (videoRef.current && url) videoRef.current.currentTime = next / 1000;
  }
  function readMediaDuration(video: HTMLVideoElement) {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      setMediaDuration(video.duration * 1000);
      if (probing.current || video.currentTime >= video.duration) video.currentTime = timeRef.current / 1000;
      probing.current = false;
      return;
    }
    // MediaRecorder WebM blobs can omit their duration header. Seeking far
    // past the end makes Chromium discover the intrinsic duration.
    if (!recording.duration_ms && video.readyState >= HTMLMediaElement.HAVE_METADATA && !probing.current) {
      probing.current = true;
      video.currentTime = 1e10;
    }
  }
  return (
    <>
      <div className="route-form-grid camera-inspection-settings">
        <label>
          Inspection mode
          <select aria-label="Inspection mode" value={view} disabled={locked} onChange={(event) => setView(event.target.value)}>
            <option value="video" disabled={!url}>
              Video
            </option>
            <option value="stick">Stick figure</option>
            <option value="robot">Robot</option>
            <option value="side-by-side">Side-by-side</option>
          </select>
        </label>
        <p className="helper-text">
          {recording.frames.length} extracted frames · {(duration / 1000).toFixed(1)} seconds
        </p>
      </div>
      <div className={view === "side-by-side" ? "camera-comparison" : "camera-inspection"}>
        <div className={view === "video" || (view === "side-by-side" && url) ? "camera-recorded-source" : "hidden"}>
          <p className="camera-preview-label">SOURCE VIDEO</p>
          <div className="camera-recorded-stage">
            <video
              ref={videoRef}
              src={url}
              muted
              playsInline
              className="camera-recorded-video"
              onLoadedMetadata={(event) => readMediaDuration(event.currentTarget)}
              onDurationChange={(event) => readMediaDuration(event.currentTarget)}
              onError={() => { setError("Recorded video could not be decoded. You can still inspect saved landmarks."); setPlaying(false); }}
            />
            {recording.frames.length > 0 && <StickFigure frame={frame} overlay width={recording.width || 640} height={recording.height || 480} />}
          </div>
        </div>
        {(view === "stick" || (view === "side-by-side" && !url)) && (
          <div><p className="camera-preview-label">LANDMARKS</p><StickFigure frame={frame} width={recording.width || 640} height={recording.height || 480} /></div>
        )}
        {(view === "robot" || view === "side-by-side") && (
          <RobotViewport robot={robot} state={state} title="Retargeted preview" label="ROBOT PREVIEW" />
        )}
      </div>
      <p className="camera-tracking-status" aria-live="polite">
        {!recording.frames.length
          ? recording.processed ? "No confident pose found. Re-extract with a clearer view." : "Video ready. Extract its stick figure to inspect robot motion."
          : frame ? "Tracking available at this frame." : "Tracking lost at this time. Robot held at neutral pose."}
      </p>
      <div className="route-actions">
        <Button
          variant="secondary"
          disabled={locked || !duration || (!recording.frames.length && !url)}
          onClick={() => {
            if (time >= duration) seek(0);
            setPlaying(!playing);
          }}
        >
          {playing ? "Pause" : "Play"}
        </Button>
        <Button variant="secondary" disabled={locked || !duration} onClick={() => seek(0)}>
          Restart
        </Button>
        <Button variant="secondary" disabled={locked || !duration || time <= 0} onClick={() => seek(Math.max(0, time - 1000 / recording.sample_rate))}>Previous frame</Button>
        <Button variant="secondary" disabled={locked || !duration || time >= duration} onClick={() => seek(Math.min(duration, time + 1000 / recording.sample_rate))}>Next frame</Button>
        <label className="camera-speed">Speed
          <select aria-label="Playback speed" value={speed} disabled={locked} onChange={(event) => setSpeed(Number(event.target.value))}>
            {[0.25, 0.5, 1, 1.5, 2].map((value) => <option key={value} value={value}>{value}×</option>)}
          </select>
        </label>
        <label className="camera-timeline">
          Playback position
          <input
            aria-label="Playback position"
            type="range"
            min={0}
            max={duration || 1}
            step={1}
            value={time}
            disabled={locked || !duration}
            onChange={(event) => seek(Number(event.target.value))}
          />
        </label>
        <output aria-label="Playback time">{(time / 1000).toFixed(2)} s</output>
      </div>
      <MappingInspector frame={frame} joints={joints} profile={profile} />
      {error && (
        <p role="alert" className="helper-text">
          {error}
          {recording.frames.length > 0 && !motionPlayback && <Button variant="secondary" disabled={locked} onClick={() => { setMotionPlayback(true); setView("stick"); setError(""); }}>Replay extracted motion</Button>}
        </p>
      )}
    </>
  );
}
