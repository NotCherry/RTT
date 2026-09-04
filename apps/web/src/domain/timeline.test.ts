import { describe, expect, it } from "vitest";
import {
  buildIncrementalSamples,
  buildReplayPlan,
  effectiveDurationFrames,
  frameToTimestamp,
  framesToKeyframes,
  hasUnsavedTimelineChanges,
  interpolatePositions,
  keyframesToFrames,
  nextFreeFrame,
  normalizeFrames,
  parseJointInput,
  quantizeTimestamp,
  sanitizeFrames,
  timestampToFrame,
  upsertFrameAtFrame,
} from "./timeline";

describe("gesture timeline", () => {
  it("keeps authored keyframes separate from derived playback frames", () => {
    const keyframes = framesToKeyframes(
      [
        { timestamp: 0, positions: [0, 0] },
        { timestamp: 800, positions: [1, -1] },
      ],
      20,
    );
    expect(keyframes.map((keyframe) => keyframe.frame)).toEqual([0, 16]);
    expect(keyframesToFrames(keyframes, 20)[1]).toEqual({
      timestamp: 800,
      positions: [1, -1],
    });
  });

  const frames = [
    { timestamp: 200, positions: [1, 2] },
    { timestamp: 0, positions: [0, 0] },
  ];

  it("orders frames and interpolates every joint between checkpoints", () => {
    expect(normalizeFrames(frames)).toEqual([
      { timestamp: 0, positions: [0, 0] },
      { timestamp: 200, positions: [1, 2] },
    ]);
    expect(interpolatePositions(frames, 100)).toEqual([0.5, 1]);
  });

  it("creates small next-state deltas for each timeline segment", () => {
    const samples = buildIncrementalSamples(
      [
        { timestamp: 0, positions: [0, 0] },
        { timestamp: 300, positions: [0.9, -0.6] },
      ],
      100,
    );
    expect(samples).toHaveLength(3);
    expect(samples[0]).toMatchObject({
      current: [0, 0],
      goal: [0.9, -0.6],
      progress: 0,
    });
    samples.forEach((sample) => {
      expect(sample.delta[0]).toBeCloseTo(0.3, 10);
      expect(sample.delta[1]).toBeCloseTo(-0.2, 10);
    });
  });

  it("plays the full gesture through intermediate poses instead of the final pose", () => {
    const plan = buildReplayPlan(
      [
        { timestamp: 0, positions: [0, 0] },
        { timestamp: 240, positions: [1, 1] },
      ],
      120,
    );
    expect(plan.times).toEqual([0, 120, 240]);
    expect(plan.poses).toEqual([
      [0, 0],
      [0.5, 0.5],
      [1, 1],
    ]);
  });

  it("holds a 60-frame floor and covers the last keyframe", () => {
    expect(effectiveDurationFrames([], 30, 30)).toBe(60);
    expect(
      effectiveDurationFrames(
        [
          { timestamp: 0, positions: [0] },
          { timestamp: frameToTimestamp(30, 30), positions: [1] },
        ],
        30,
        30,
      ),
    ).toBe(60);
    expect(
      effectiveDurationFrames(
        [
          { timestamp: 0, positions: [0] },
          { timestamp: frameToTimestamp(200, 30), positions: [1] },
        ],
        30,
        30,
      ),
    ).toBe(201);
  });

  it("replays deterministically and resets short demonstrations to a static pose", () => {
    const gesture = [
      { timestamp: 0, positions: [0, 0] },
      { timestamp: 300, positions: [0.9, -0.6] },
    ];
    expect(buildReplayPlan(gesture, 100)).toEqual(
      buildReplayPlan(gesture, 100),
    );
    expect(buildReplayPlan([{ timestamp: 0, positions: [0, 0] }], 120)).toEqual(
      { times: [], poses: [] },
    );
    expect(buildReplayPlan([], 120)).toEqual({ times: [], poses: [] });
  });
});

describe("timeline quantization (Blender-like)", () => {
  it("quantizes timestamps to 30 fps grid", () => {
    // 30 fps => 33.333ms per frame
    expect(quantizeTimestamp(0, 30)).toBe(0);
    expect(quantizeTimestamp(16, 30)).toBeCloseTo(0, 5); // snaps to frame 0
    expect(quantizeTimestamp(17, 30)).toBeCloseTo(33.333, 1);
    expect(quantizeTimestamp(50, 30)).toBeCloseTo(66.666, 1); // 50/33.33=1.5 -> round to 2
    expect(quantizeTimestamp(500, 30)).toBeCloseTo(500, 5); // 15 frames exactly
    expect(timestampToFrame(500, 30)).toBe(15);
    expect(frameToTimestamp(15, 30)).toBeCloseTo(500, 5);
  });

  it("sanitizes frames by sorting and clamping without changing timing", () => {
    const frames = [
      { timestamp: 200, positions: [1, 2] },
      { timestamp: -10, positions: [0, 0] },
      { timestamp: 17, positions: [0.5, 0.5] }, // same frame as 0 after quantize
    ];
    const sanitized = sanitizeFrames(frames, 30);
    // -10 clamped to 0 then quantized to 0, 17 quantized to 33.33 frame 1, 200 quantized to 200 frame 6
    // Duplicate at frame 0 pushed to frame 1, then existing frame 1 pushed to frame 2, etc.
    expect(sanitized.map((frame) => frame.timestamp)).toEqual([0, 17, 200]);
    expect(sanitized.map((f) => timestampToFrame(f.timestamp, 30))).toEqual([
      0, 1, 6,
    ]);
    // strictly increasing
    for (let index = 1; index < sanitized.length; index += 1) {
      expect(sanitized[index].timestamp).toBeGreaterThan(
        sanitized[index - 1].timestamp,
      );
    }
  });

  it("finds next free frame avoiding collisions", () => {
    const frames = [
      { timestamp: 0, positions: [0, 0] },
      { timestamp: frameToTimestamp(10, 30), positions: [1, 1] },
    ];
    expect(nextFreeFrame(frames, 10, 30)).toBe(11);
    expect(nextFreeFrame(frames, 5, 30)).toBe(5);
    expect(nextFreeFrame([], 0, 30)).toBe(0);
  });

  it("insert gap is deterministic 10 frames (Blender-like standard)", () => {
    const base = [{ timestamp: frameToTimestamp(0, 30), positions: [0, 0] }];
    const gap = 10;
    const desired = timestampToFrame(base[0].timestamp, 30) + gap;
    const free = nextFreeFrame(base, desired, 30);
    expect(free).toBe(10);
    expect(frameToTimestamp(free, 30)).toBeCloseTo(333.333, 1);
  });

  it("duplicate does not produce random hundreds-of-frames jump", () => {
    const frames = [
      { timestamp: 0, positions: [0, 0] },
      { timestamp: frameToTimestamp(10, 30), positions: [1, 1] },
      { timestamp: frameToTimestamp(20, 30), positions: [2, 2] },
    ];
    const baseFrame = timestampToFrame(frames[1].timestamp, 30);
    const insert = nextFreeFrame(frames, baseFrame + 10, 30);
    // base 10 +10 =20 is occupied, so bumps to 21 - deterministic, not random hundreds
    expect(insert).toBe(21);
    const duplicateInsert = nextFreeFrame(frames, 10 + 10, 30);
    expect(duplicateInsert).toBe(21);
    // If gap is free, it stays
    const freeGap = nextFreeFrame(
      [{ timestamp: 0, positions: [0, 0] }],
      10,
      30,
    );
    expect(freeGap).toBe(10);
  });

  it("inserts a filled pose at the exact selected frame", () => {
    const frames = [
      { timestamp: 0, positions: [0, 0] },
      { timestamp: frameToTimestamp(189, 30), positions: [1, 1] },
    ];
    const next = upsertFrameAtFrame(frames, 12, [0.25, -0.5], 30);

    expect(next.map((frame) => timestampToFrame(frame.timestamp, 30))).toEqual([
      0, 12, 189,
    ]);
    expect(next[1].positions).toEqual([0.25, -0.5]);
  });

  it("updates the keyframe when the selected frame is already occupied", () => {
    const frames = [
      { timestamp: 0, positions: [0, 0] },
      { timestamp: frameToTimestamp(12, 30), positions: [1, 1] },
    ];
    const next = upsertFrameAtFrame(frames, 12, [0.5, -0.25], 30);

    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({
      timestamp: frameToTimestamp(12, 30),
      positions: [0.5, -0.25],
    });
  });

  it("accepts valid pose input and rejects incomplete or out-of-range input", () => {
    const joint = {
      name: "shoulder",
      type: "revolute",
      parent: "base",
      child: "arm",
      origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
      axis: [0, 0, 1],
      lower: -1,
      upper: 1,
      controllable: true,
    };

    expect(parseJointInput("0.25", joint)).toBe(0.25);
    expect(parseJointInput("", joint)).toBeNull();
    expect(parseJointInput("2", joint)).toBeNull();
  });

  it("preserves full-pose key invariant after sanitize", () => {
    const frames = [
      { timestamp: 0, positions: [0.1, -0.2] },
      { timestamp: frameToTimestamp(10, 30), positions: [0.5, 0.3] },
    ];
    const sanitized = sanitizeFrames(frames, 30);
    expect(sanitized).toHaveLength(2);
    expect(sanitized[0].positions).toEqual([0.1, -0.2]);
    expect(sanitized[1].positions).toEqual([0.5, 0.3]);
  });

  it("detects unsaved timeline changes as pure deep module", () => {
    const source = [
      { timestamp: 0, positions: [0, 0] },
      { timestamp: 100, positions: [1, 1] },
    ];
    const same = [
      { timestamp: 0, positions: [0, 0] },
      { timestamp: 100, positions: [1, 1] },
    ];
    const edited = [
      { timestamp: 0, positions: [0, 0] },
      { timestamp: 100, positions: [1, 0.9] },
    ];
    expect(hasUnsavedTimelineChanges(null, null)).toBe(false);
    expect(hasUnsavedTimelineChanges(source, same)).toBe(false);
    expect(hasUnsavedTimelineChanges(edited, source)).toBe(true);
    expect(hasUnsavedTimelineChanges(null, source)).toBe(true);
    expect(hasUnsavedTimelineChanges(source, null)).toBe(true);
    expect(hasUnsavedTimelineChanges([], source)).toBe(true);
  });
});
