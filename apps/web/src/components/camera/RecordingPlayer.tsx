import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { RobotViewport } from "@/components/workbench/RobotViewport";
import type { CameraRecording } from "@/domain/cameraArchive";
import { retargetLandmarkFrame, type RetargetingProfile } from "@/domain/retargeting";
import type { Joint, Robot, SimulationState } from "@/types";
import { StickFigure } from "./StickFigure";

export function RecordingPlayer({
  recording,
  robot,
  state,
  joints,
  neutral,
  profile,
  onPreview,
}: {
  recording: CameraRecording;
  robot: Robot | null;
  state: SimulationState | null;
  joints: Joint[];
  neutral: number[];
  profile: RetargetingProfile;
  onPreview: (positions: number[]) => void;
}) {
  const [view, setView] = useState("side-by-side");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
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
    if (!playing) {
      videoRef.current?.pause();
      return;
    }
    let raf = 0;
    const start = performance.now() - timeRef.current;
    const video = videoRef.current;
    if (url && video)
      void video.play().catch(() => {
        setError("Video playback failed; extracted motion remains available.");
      });
    const tick = () => {
      const next = Math.min(
        duration,
        url && video && !video.paused && Number.isFinite(video.currentTime)
          ? video.currentTime * 1000
          : performance.now() - start,
      );
      const cursor = video?.ended && url ? duration : next;
      timeRef.current = cursor;
      setTime(cursor);
      if (next >= duration || (video?.ended && url)) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      video?.pause();
    };
  }, [playing, duration, url]);
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
      if (video.currentTime >= video.duration) video.currentTime = timeRef.current / 1000;
      return;
    }
    // MediaRecorder WebM blobs can omit their duration header. Seeking far
    // past the end makes Chromium discover the intrinsic duration.
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) video.currentTime = 1e10;
  }
  return (
    <>
      <div className="route-form-grid camera-inspection-settings">
        <label>
          Inspection mode
          <select aria-label="Inspection mode" value={view} onChange={(event) => setView(event.target.value)}>
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
      <video
        ref={videoRef}
        src={url}
        muted
        playsInline
        className={view === "video" ? "camera-video" : "hidden"}
        onLoadedMetadata={(event) => readMediaDuration(event.currentTarget)}
        onDurationChange={(event) => readMediaDuration(event.currentTarget)}
        onError={() => setError("Recorded video could not be decoded. You can still inspect saved landmarks.")}
      />
      <div className={view === "side-by-side" ? "camera-comparison" : "camera-inspection"}>
        {(view === "stick" || view === "side-by-side") && (
          <StickFigure frame={frame} width={recording.width || 640} height={recording.height || 480} />
        )}
        {(view === "robot" || view === "side-by-side") && (
          <RobotViewport robot={robot} state={state} title="Retargeted preview" label="ROBOT PREVIEW" />
        )}
      </div>
      <div className="route-actions">
        <Button
          variant="secondary"
          disabled={!duration || (!recording.frames.length && !url)}
          onClick={() => {
            if (time >= duration) seek(0);
            setPlaying(!playing);
          }}
        >
          {playing ? "Pause" : "Play"}
        </Button>
        <Button variant="secondary" onClick={() => seek(0)}>
          Restart
        </Button>
        <label className="camera-timeline">
          Playback position
          <input
            aria-label="Playback position"
            type="range"
            min={0}
            max={duration || 1}
            step={1}
            value={time}
            onChange={(event) => seek(Number(event.target.value))}
          />
        </label>
        <output aria-label="Playback time">{(time / 1000).toFixed(2)} s</output>
      </div>
      {error && (
        <p role="alert" className="helper-text">
          {error}
        </p>
      )}
    </>
  );
}
