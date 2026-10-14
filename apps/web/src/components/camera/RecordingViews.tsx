import { useEffect, useRef, useState } from "react";
import type { CameraViewRecording } from "@/domain/multiCameraContract";
import type { LandmarkFrame } from "@/types";
import { StickFigure } from "./StickFigure";
function RecordedView({ view, time, playing, speed, maximumGapMs }: { view: CameraViewRecording; time: number; playing: boolean; speed: number; maximumGapMs: number }) {
  const video = useRef<HTMLVideoElement>(null), [url, setUrl] = useState<string>();
  const relative = time - view.offset_ms;
  const inRange = relative >= 0 && relative <= view.duration_ms;
  const frame = inRange ? view.frames.reduce<LandmarkFrame | null>((previous, frame) => frame.timestamp <= relative && relative - frame.timestamp <= maximumGapMs ? frame : previous, null) : null;
  useEffect(() => { if (!view.video) return; const value = URL.createObjectURL(view.video); setUrl(value); return () => URL.revokeObjectURL(value); }, [view.video]);
  useEffect(() => {
    const source = video.current; if (!source || !url) return;
    const desired = Math.max(0, Math.min(view.duration_ms / 1000, relative / 1000));
    if (Math.abs(source.currentTime - desired) > (playing ? .1 : .001)) source.currentTime = desired;
    source.playbackRate = speed;
    if (playing && inRange) void source.play().catch(() => {}); else source.pause();
  }, [relative, playing, speed, inRange, url, view.duration_ms]);
  return <section className="camera-recorded-view" aria-label={`${view.id} synchronized recording`}><p className="camera-preview-label">{view.id.toUpperCase()} · offset {view.offset_ms.toFixed(1)} ms</p>
    <div className="camera-recorded-stage">{url ? <video ref={video} src={url} muted playsInline className="camera-recorded-video" /> : <p className="helper-text">Source video unavailable</p>}
      <StickFigure frame={frame} overlay width={view.width || 640} height={view.height || 480} />
    </div>{!inRange && <p className="helper-text">Outside this camera's recorded time range</p>}
  </section>;
}
export function RecordingViews({ views, time, playing, speed, maximumGapMs = 200 }: { views: CameraViewRecording[]; time: number; playing: boolean; speed: number; maximumGapMs?: number }) {
  return <div className="camera-recorded-views">{views.map(view => <RecordedView key={view.id} view={view} time={time} playing={playing} speed={speed} maximumGapMs={maximumGapMs} />)}</div>;
}
