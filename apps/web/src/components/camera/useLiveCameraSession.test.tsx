// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useLiveCameraSession } from "./useLiveCameraSession";
import type { useRobotTransport } from "./useRobotTransport";
const settings = { transport: "mock" as const, robot_model: "g1-29" as const, network_interface: "lo", domain_id: 0, max_joint_speed: 1, max_joint_acceleration: 3 };
function options() {
  const connection = { owned: true, streamReady: true, status: { connected: true, state_fresh: true, camera_target: { left_elbow_joint: .2 } },
    action: vi.fn().mockResolvedValue(true), connect: vi.fn().mockResolvedValue(true), cancelPendingConnect: vi.fn() };
  return { cameraConnected: true, liveProcessing: true, trackingFresh: () => true,
    openCamera: vi.fn().mockResolvedValue(true), closeCamera: vi.fn(), connection: connection as unknown as ReturnType<typeof useRobotTransport> };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("arms only after the explicit Run action and retains an existing preview", async () => {
  const o = options();
  const { result } = renderHook(() => useLiveCameraSession(o));
  expect(o.connection.action).not.toHaveBeenCalled();
  await act(async () => { await result.current.start(settings); });
  expect(o.openCamera).not.toHaveBeenCalled();
  expect(o.connection.action).toHaveBeenCalledWith("arm");
  expect(o.closeCamera).not.toHaveBeenCalled();
});
it("cancels a camera open and cannot arm after its delayed success", async () => {
  const o = options(); o.cameraConnected = false;
  let opened!: (value: boolean) => void;
  o.openCamera.mockImplementation(() => new Promise(resolve => { opened = resolve; }));
  const { result } = renderHook(() => useLiveCameraSession(o));
  let pending!: Promise<void>;
  act(() => { pending = result.current.start(settings); });
  await act(async () => { result.current.cancel(); await pending; opened(true); });
  expect(o.closeCamera).toHaveBeenCalled();
  expect(o.connection.action).not.toHaveBeenCalled();
  expect(result.current.error).toMatch(/cancelled/);
});
it("times out stale tracking and never arms or takes another owner's connection", async () => {
  vi.useFakeTimers();
  const o = options(); o.trackingFresh = () => false;
  const { result } = renderHook(() => useLiveCameraSession(o));
  let pending!: Promise<void>;
  act(() => { pending = result.current.start(settings); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10050); await pending; });
  expect(o.connection.action).not.toHaveBeenCalledWith("arm");
  expect(result.current.error).toMatch(/not ready/);
});
it("coalesces double clicks and releases a cancelled arming response", async () => {
  const o = options();
  let finish!: (value: boolean) => void;
  o.connection.action = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(true);
  const { result } = renderHook(() => useLiveCameraSession(o));
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.start(settings); });
  act(() => { void result.current.start(settings); result.current.cancel(); });
  await act(async () => { finish(true); await pending; });
  expect(o.connection.action).toHaveBeenCalledTimes(2);
  expect(o.connection.action).toHaveBeenLastCalledWith("disarm");
});
