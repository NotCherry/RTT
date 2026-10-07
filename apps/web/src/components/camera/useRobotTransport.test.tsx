// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRobotTransport } from "./useRobotTransport";
const api = vi.hoisted(() => ({ connect: vi.fn(), action: vi.fn(), status: vi.fn(), socket: vi.fn() }));
vi.mock("@/domain/robotTransport", () => ({ connectRobotTransport: api.connect, robotTransportAction: api.action, getRobotTransportStatus: api.status, createRobotTargetSocket: api.socket }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("authenticates its stream, sends latest tracking targets, and drops congestion", async () => {
  const status = { connected: true, armed: false, state_fresh: true, transport: "mock", reason: "Connected", packets_sent: 0 };
  const stream = { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn(), onopen: null, onmessage: null, onclose: null };
  vi.stubGlobal("WebSocket", { OPEN: 1 });
  api.status.mockResolvedValue(status);
  api.connect.mockResolvedValue({ ...status, token: "owner" });
  api.action.mockResolvedValue({ ...status, connected: false });
  api.socket.mockReturnValue(stream);
  const { result, unmount } = renderHook(() => useRobotTransport());
  await act(async () => { await result.current.connect({ transport: "mock", robot_model: "g1-29", network_interface: "lo", domain_id: 0, max_joint_speed: 1, max_joint_acceleration: 3 }); });
  act(() => { (stream.onopen as unknown as () => void)(); (stream.onmessage as unknown as (event: { data: string }) => void)({ data: '{"ready":true}' }); });
  expect(JSON.parse(stream.send.mock.calls[0][0])).toEqual({ token: "owner" });
  act(() => result.current.submit({ left_elbow_joint: .2 }));
  expect(JSON.parse(stream.send.mock.calls[1][0])).toEqual({ sequence: 0, sent_at_ms: expect.any(Number), tracking: true, positions: { left_elbow_joint: .2 } });
  act(() => result.current.submit(null));
  expect(JSON.parse(stream.send.mock.calls[2][0])).toEqual({ sequence: 1, sent_at_ms: expect.any(Number), tracking: false, positions: {} });
  stream.bufferedAmount = 100;
  act(() => result.current.submit({ left_elbow_joint: 1 }));
  expect(stream.close).toHaveBeenCalledTimes(1);
  expect(stream.send).toHaveBeenCalledTimes(3);
  unmount();
  expect(api.action).toHaveBeenCalledWith("disconnect", "owner");
});

it("releases controller ownership when the socket cannot be created", async () => {
  api.status.mockResolvedValue({ connected: false });
  api.connect.mockResolvedValue({ connected: true, token: "failed-stream-owner" });
  api.action.mockResolvedValue({ connected: false });
  api.socket.mockImplementationOnce(() => { throw new Error("Socket unavailable"); });
  const { result } = renderHook(() => useRobotTransport());
  await act(async () => { await result.current.connect({ transport: "mock", robot_model: "g1-29", network_interface: "lo", domain_id: 0, max_joint_speed: 1, max_joint_acceleration: 3 }); });
  expect(api.action).toHaveBeenCalledWith("disconnect", "failed-stream-owner");
  expect(result.current.owned).toBe(false);
  expect(result.current.status?.connected).toBe(false);
  expect(result.current.error).toBe("Socket unavailable");
});
