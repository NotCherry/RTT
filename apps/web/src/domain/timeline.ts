import type { DemonstrationFrame, Joint, Keyframe } from "../types";

export const DEFAULT_TIMELINE_FPS = 60;
export const DEFAULT_TIMELINE_GAP_FRAMES = 10;

export function frameToTimestamp(
  frame: number,
  fps = DEFAULT_TIMELINE_FPS,
): number {
  return frame * (1000 / fps);
}

export function timestampToFrame(
  timestamp: number,
  fps = DEFAULT_TIMELINE_FPS,
): number {
  return Math.round(timestamp / (1000 / fps));
}

export function quantizeTimestamp(
  timestamp: number,
  fps = DEFAULT_TIMELINE_FPS,
): number {
  return frameToTimestamp(timestampToFrame(timestamp, fps), fps);
}

export function hasUnsavedTimelineChanges(
  draft: DemonstrationFrame[] | null | undefined,
  source: DemonstrationFrame[] | null | undefined,
): boolean {
  if (!draft && !source) return false;
  if (!draft || !source) return true;
  if (draft.length !== source.length) return true;
  const a = [...draft].sort((x, y) => x.timestamp - y.timestamp);
  const b = [...source].sort((x, y) => x.timestamp - y.timestamp);
  for (let i = 0; i < a.length; i++) {
    if (a[i].timestamp !== b[i].timestamp) return true;
    if (a[i].positions.length !== b[i].positions.length) return true;
    for (let j = 0; j < a[i].positions.length; j++) {
      if (Math.abs(a[i].positions[j] - b[i].positions[j]) > 1e-9) return true;
    }
  }
  return false;
}

export const MIN_TIMELINE_DURATION_FRAMES = 60;

export function effectiveDurationFrames(
  frames: DemonstrationFrame[],
  durationFrames: number,
  fps = DEFAULT_TIMELINE_FPS,
): number {
  const lastFrame = frames.length
    ? timestampToFrame(frames[frames.length - 1].timestamp, fps)
    : 0;
  return Math.max(durationFrames, lastFrame + 1, MIN_TIMELINE_DURATION_FRAMES);
}

export function nextFreeFrame(
  frames: DemonstrationFrame[],
  desiredFrame: number,
  fps = DEFAULT_TIMELINE_FPS,
): number {
  const occupied = new Set(
    frames.map((f) => timestampToFrame(f.timestamp, fps)),
  );
  let candidate = desiredFrame;
  while (occupied.has(candidate)) candidate += 1;
  return candidate;
}

export function parseJointInput(rawValue: string, joint: Joint): number | null {
  const value = Number(rawValue);
  if (
    !rawValue.trim() ||
    !Number.isFinite(value) ||
    value < joint.lower ||
    value > joint.upper
  ) {
    return null;
  }
  return value;
}

export function upsertFrameAtFrame(
  frames: DemonstrationFrame[],
  targetFrame: number,
  positions: number[],
  fps = DEFAULT_TIMELINE_FPS,
): DemonstrationFrame[] {
  const frame = Math.max(0, Math.round(targetFrame));
  const timestamp = frameToTimestamp(frame, fps);
  const existingIndex = frames.findIndex(
    (item) => timestampToFrame(item.timestamp, fps) === frame,
  );
  let next: DemonstrationFrame[];
  if (existingIndex >= 0) {
    next = frames.map((item, index) => {
      if (index !== existingIndex) return item;
      return { timestamp, positions: [...positions] };
    });
  } else {
    next = [...frames, { timestamp, positions: [...positions] }];
  }
  return sanitizeFrames(next, fps);
}

export function sanitizeFrames(
  frames: DemonstrationFrame[],
  _fps = DEFAULT_TIMELINE_FPS,
) {
  return [...frames]
    .map((frame) => ({
      timestamp: Math.max(0, frame.timestamp),
      positions: [...frame.positions],
      // Preserve interpolation when present (full-gesture fidelity)
      // SAFETY: DemonstrationFrame may carry interpolation from Keyframe round-trip; optional field check is safe
      ...((frame as unknown as { interpolation?: string }).interpolation
        // SAFETY: DemonstrationFrame may carry interpolation from Keyframe round-trip; optional field check is safe
        ? { interpolation: (frame as { interpolation?: string }).interpolation! }
        : {}),
    }))
    .sort((left, right) => left.timestamp - right.timestamp) as DemonstrationFrame[];
}

export function framesToKeyframes(
  frames: DemonstrationFrame[],
  fps = DEFAULT_TIMELINE_FPS,
): Keyframe[] {
  const millisecondsPerFrame = 1000 / fps;
  let previousFrame = -1;
  return normalizeFrames(frames).map((frame, index) => {
    const timelineFrame = Math.max(
      previousFrame + 1,
      Math.round(frame.timestamp / millisecondsPerFrame),
    );
    previousFrame = timelineFrame;
    // SAFETY: DemonstrationFrame may carry interpolation from Keyframe round-trip; optional field check is safe
    const interpolation = (frame as unknown as { interpolation?: string }).interpolation as
      | "linear"
      | "step"
      | undefined;
    return {
      id: `keyframe-${index}-${timelineFrame}`,
      frame: timelineFrame,
      timestamp: frame.timestamp,
      positions: [...frame.positions],
      interpolation: interpolation === "step" ? "step" : "linear",
    };
  });
}

export function keyframesToFrames(
  keyframes: Keyframe[],
  fps = DEFAULT_TIMELINE_FPS,
) {
  const millisecondsPerFrame = 1000 / fps;
  return [...keyframes]
    .sort((left, right) => left.frame - right.frame)
    .map((keyframe) => ({
      timestamp: keyframe.frame * millisecondsPerFrame,
      positions: [...keyframe.positions],
    }));
}

export type IncrementalSample = {
  current: number[];
  goal: number[];
  progress: number;
  delta: number[];
};

export function normalizeFrames(frames: DemonstrationFrame[]) {
  return [...frames]
    .map((frame) => ({
      timestamp: Math.max(0, frame.timestamp),
      positions: [...frame.positions],
      // SAFETY: DemonstrationFrame may carry interpolation from Keyframe round-trip; optional field check is safe
      ...((frame as unknown as { interpolation?: string }).interpolation
        // SAFETY: DemonstrationFrame may carry interpolation from Keyframe round-trip; optional field check is safe
        ? { interpolation: (frame as { interpolation?: string }).interpolation! }
        : {}),
    }))
    .sort((left, right) => left.timestamp - right.timestamp) as DemonstrationFrame[];
}

export function interpolatePositions(
  frames: DemonstrationFrame[],
  timestamp: number,
) {
  // SAFETY: DemonstrationFrame may carry interpolation from Keyframe round-trip; optional field check is safe
  const ordered = normalizeFrames(frames) as unknown as (DemonstrationFrame & {
    interpolation?: string;
  })[];
  if (!ordered.length) return [];
  if (timestamp <= ordered[0].timestamp) return [...ordered[0].positions];

  const last = ordered[ordered.length - 1];
  if (timestamp >= last.timestamp) return [...last.positions];

  const nextIndex = ordered.findIndex((frame) => frame.timestamp >= timestamp);
  const next = ordered[nextIndex];
  const previous = ordered[Math.max(0, nextIndex - 1)] as DemonstrationFrame & {
    interpolation?: string;
  };
  // Step interpolation: hold previous until next timestamp (full-gesture fidelity)
  if ((previous as { interpolation?: string }).interpolation === "step") {
    return [...previous.positions];
  }
  const duration = Math.max(next.timestamp - previous.timestamp, 1);
  const progress = (timestamp - previous.timestamp) / duration;
  return previous.positions.map(
    (position, index) =>
      position + ((next.positions[index] ?? position) - position) * progress,
  );
}

export type ReplayPlan = {
  times: number[];
  poses: number[][];
};

export function buildReplayPlan(
  frames: DemonstrationFrame[],
  stepMs = 120,
): ReplayPlan {
  const ordered = normalizeFrames(frames);
  if (ordered.length < 2) return { times: [], poses: [] };
  const step = Math.max(1, stepMs);
  const startTimestamp = ordered[0].timestamp;
  const endTimestamp = ordered[ordered.length - 1].timestamp;
  const times: number[] = [];
  for (
    let timestamp = startTimestamp;
    timestamp < endTimestamp;
    timestamp += step
  ) {
    times.push(timestamp);
  }
  times.push(endTimestamp);
  return {
    times,
    poses: times.map((timestamp) => interpolatePositions(ordered, timestamp)),
  };
}

export function buildIncrementalSamples(
  frames: DemonstrationFrame[],
  stepMs = 120,
): IncrementalSample[] {
  const ordered = normalizeFrames(frames);
  const samples: IncrementalSample[] = [];
  if (ordered.length < 2) return samples;
  const step = Math.max(1, stepMs);

  for (
    let segmentIndex = 0;
    segmentIndex < ordered.length - 1;
    segmentIndex += 1
  ) {
    const start = ordered[segmentIndex];
    const end = ordered[segmentIndex + 1];
    const duration = Math.max(end.timestamp - start.timestamp, step);
    for (let elapsed = 0; elapsed < duration; elapsed += step) {
      const currentTimestamp = start.timestamp + elapsed;
      const nextTimestamp = Math.min(currentTimestamp + step, end.timestamp);
      const current = interpolatePositions(ordered, currentTimestamp);
      const next = interpolatePositions(ordered, nextTimestamp);
      const progress = Math.min(1, elapsed / duration);
      samples.push({
        current,
        goal: [...end.positions],
        progress,
        delta: next.map((value, index) => value - (current[index] ?? value)),
      });
    }
  }
  return samples;
}