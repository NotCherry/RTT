// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { useCameraCapture } from "./useCameraCapture";
import { useMultiCameraCapture } from "./useMultiCameraCapture";
const state = vi.hoisted(() => ({
  next: 0,
  options: [] as Parameters<typeof useCameraCapture>[0][],
  opens: vi.fn(),
  closes: vi.fn(),
  failed: -1,
}));
vi.mock("./useCameraCapture", async () => {
  const { useRef, useState } = await import("react");
  return {
    useCameraCapture: (options: Parameters<typeof useCameraCapture>[0]) => {
      const id = useRef<number>(undefined);
      if (id.current === undefined) id.current = state.next++;
      const index = id.current;
      state.options[index] = options;
      const [connected, setConnected] = useState(false);
      return {
        videoRef: useRef(null),
        imageRef: useRef(null),
        connected,
        opening: false,
        recording: false,
        finalizing: false,
        elapsed: 0,
        status: "Ready",
        open: async (...args: unknown[]) => {
          state.opens(index, ...args);
          if (index === state.failed) return undefined;
          setConnected(true);
          return true;
        },
        close: () => {
          state.closes(index);
          setConnected(false);
        },
        startRecording: vi.fn(),
        stopRecording: vi.fn(),
      };
    },
  };
});
beforeEach(() => {
  state.next = 0;
  state.options = [];
  state.failed = -1;
  vi.clearAllMocks();
});
afterEach(cleanup);
function setup() {
  const onFrame = vi.fn(),
    onRecording = vi.fn().mockResolvedValue(undefined);
  return {
    ...renderHook(() =>
      useMultiCameraCapture({
        processing: "live",
        sampleRate: 15,
        onFrame,
        onRecording,
      }),
    ),
    onFrame,
    onRecording,
  };
}
it("requires distinct devices and passes exact selections to independent captures", async () => {
  const { result } = setup();
  act(() => result.current.rig.add());
  await act(() => result.current.open("local", ""));
  expect(state.opens).not.toHaveBeenCalled();
  expect(result.current.status).toMatch(/different USB/);
  act(() => {
    result.current.rig.update(0, { deviceId: "a" });
    result.current.rig.update(1, { deviceId: "b" });
  });
  await act(() => result.current.open("local", ""));
  expect(state.opens.mock.calls).toEqual([
    [0, "local", "", "a"],
    [1, "local", "", "b"],
  ]);
  expect(result.current.connected).toBe(true);
  act(() => result.current.close());
  expect(result.current.connected).toBe(false);
});
it("closes every view when a supplementary capture fails", async () => {
  const { result } = setup();
  act(() => result.current.rig.add());
  act(() => {
    result.current.rig.update(0, { deviceId: "a" });
    result.current.rig.update(1, { deviceId: "b" });
  });
  state.failed = 1;
  await act(() => result.current.open("local", ""));
  expect(result.current.connected).toBe(false);
  expect(result.current.status).toMatch(/Camera 2 could not open/);
  expect(state.closes).toHaveBeenCalledWith(0);
});
it("only the primary view drives fresh targets and null state is propagated", async () => {
  const { result, onFrame } = setup();
  await act(() => result.current.open("local", ""));
  const frame = {
    timestamp: 1000,
    confidence: 1,
    pose: [],
    left_hand: [],
    right_hand: [],
  };
  act(() => state.options[0].onFrame(frame));
  expect(onFrame).toHaveBeenLastCalledWith(frame);
  act(() => state.options[1].onFrame({ ...frame, timestamp: 1500 }));
  expect(onFrame).toHaveBeenCalledTimes(1);
  act(() => state.options[0].onFrame(null));
  expect(onFrame).toHaveBeenLastCalledWith(null);
});
it("keeps two live sources after a supplementary dropout but prevents grouped recording until reopened", async () => {
  const { result } = setup();
  act(() => result.current.rig.setCount(3));
  act(() => { for (let i=0; i<3; i++) result.current.rig.update(i, { deviceId: `camera-${i}` }); });
  await act(() => result.current.open("local", ""));
  act(() => state.options[2].onRecordingError!("Device disconnected"));
  expect(result.current.connected).toBe(true);
  expect(result.current.allConnected).toBe(false);
  expect(result.current.status).toMatch(/continuing live with two views/);
  expect(result.current.rig.cameras[0].connected).toBe(true);
  expect(result.current.rig.cameras[1].connected).toBe(true);
});
it("assembles one recording only after all views finalize, preserving independent timing and videos", async () => {
  const { result, onRecording } = setup();
  act(() => result.current.rig.add());
  act(() => {
    result.current.rig.update(0, { deviceId: "a" });
    result.current.rig.update(1, { deviceId: "b" });
  });
  await act(() => result.current.open("local", ""));
  act(() => result.current.startRecording());
  const clip = {
    id: "recording",
    name: "Gesture",
    created_at: "2026-10-10",
    source: { kind: "local-media-stream" as const, stream_count: 1 as const },
    sample_rate: 15 as const,
    frames: [],
    duration_ms: 1000,
    video: new Blob(["first"]),
    recording_start_ms: 500,
  };
  await act(() => state.options[0].onRecording(clip));
  expect(onRecording).not.toHaveBeenCalled();
  await act(() =>
    state.options[1].onRecording({
      ...clip,
      recording_start_ms: 505,
      video: new Blob(["second"]),
    }),
  );
  expect(onRecording).toHaveBeenCalledOnce();
  const group = onRecording.mock.calls[0][0];
  expect(group.source).toMatchObject({
    kind: "multi-camera",
    stream_count: 2,
    model: "body-aligned",
  });
  expect(group.views.map((v: { offset_ms: number }) => v.offset_ms)).toEqual([
    0, 5,
  ]);
  expect(group.views.map((v: { video: Blob }) => v.video.size)).toEqual([5, 6]);
});
it("limits the rig to three views and refuses triangulation without calibration", async () => {
  const { result } = setup();
  act(() => result.current.rig.add());
  act(() => result.current.rig.add());
  act(() => result.current.rig.add());
  expect(result.current.rig.inputs).toHaveLength(3);
  act(() => {
    for (let i = 0; i < 3; i++)
      result.current.rig.update(i, {
        kind: "ip",
        address: `http://camera-${i}/video`,
      });
    result.current.rig.setModel("triangulated");
  });
  await act(() => result.current.open("ip", "http://camera-0/video"));
  expect(state.opens).not.toHaveBeenCalled();
  expect(result.current.status).toMatch(/Import calibration/);
});
