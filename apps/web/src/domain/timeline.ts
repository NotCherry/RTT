import type { DemonstrationFrame } from "../types";

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
    }))
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function interpolatePositions(
  frames: DemonstrationFrame[],
  timestamp: number,
) {
  const ordered = normalizeFrames(frames);
  if (!ordered.length) return [];
  if (timestamp <= ordered[0].timestamp) return [...ordered[0].positions];

  const last = ordered[ordered.length - 1];
  if (timestamp >= last.timestamp) return [...last.positions];

  const nextIndex = ordered.findIndex((frame) => frame.timestamp >= timestamp);
  const next = ordered[nextIndex];
  const previous = ordered[Math.max(0, nextIndex - 1)];
  const duration = Math.max(next.timestamp - previous.timestamp, 1);
  const progress = (timestamp - previous.timestamp) / duration;
  return previous.positions.map(
    (position, index) =>
      position + ((next.positions[index] ?? position) - position) * progress,
  );
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
