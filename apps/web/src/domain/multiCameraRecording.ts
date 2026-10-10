import type { CameraRecording } from "./cameraArchive";
import { extractCameraRecording } from "./cameraProcessing";
import { fuseRecordedViews } from "./multiCameraPose";
import { hasUsablePose } from "./retargeting";
import { visiblePosePoint } from "./retargetingGeometry";

export async function extractMultiCameraRecording(
  recording: CameraRecording,
  sampleRate: number,
  signal: AbortSignal,
  progress: (percent: number) => void,
) {
  if (recording.source.kind !== "multi-camera") {
    if (!recording.video)
      throw new Error("This recording has no retained video.");
    return extractCameraRecording(
      recording.video,
      sampleRate,
      recording.duration_ms,
      signal,
      progress,
    );
  }
  const retained = recording.views;
  if (
    !retained ||
    retained.length !== recording.source.stream_count ||
    retained.some((v) => !v.video)
  )
    throw new Error(
      "Some camera videos are missing. Keep the existing extraction or record all views again.",
    );
  const views = [];
  for (let index = 0; index < retained.length; index++) {
    signal.throwIfAborted();
    const view = retained[index];
    const result = await extractCameraRecording(
      view.video!,
      sampleRate,
      view.duration_ms,
      signal,
      (percent) => progress((index * 100 + percent) / retained.length),
      (frame) =>
        hasUsablePose(frame) ||
        [11, 12, 23, 24].every((i) => visiblePosePoint(frame.pose[i])),
    );
    views.push({ ...view, ...result });
  }
  const frames = fuseRecordedViews(
    views,
    recording.source.model,
    recording.source.calibration,
  );
  return {
    views,
    frames,
    processed: true,
    width: views[0].width,
    height: views[0].height,
    duration_ms: views[0].duration_ms,
    rejected_frames: Math.max(
      0,
      Math.ceil((views[0].duration_ms * sampleRate) / 1000) - frames.length,
    ),
  };
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadCameraVideos(recording: CameraRecording) {
  if (!recording.views) return;
  for (const view of recording.views)
    if (view.video)
      download(
        view.video,
        `${view.id}.${view.video.type.includes("mp4") ? "mp4" : "webm"}`,
      );
  download(
    new Blob(
      [
        JSON.stringify(
          {
            version: 1,
            views: recording.views.map(({ id, offset_ms, width, height }) => ({
              id,
              offset_ms,
              width,
              height,
            })),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    "camera-timing.json",
  );
}
