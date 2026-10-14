// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSafeCameraMotion } from "./useSafeCameraMotion";
import type { Joint, LandmarkFrame } from "@/types";
afterEach(cleanup);
it("accepts live tracking when the initial state vector has not arrived yet", () => {
  const joints = [{ name: "right_shoulder_roll_joint", lower: -3, upper: 3, controllable: true }] as Joint[];
  const pose = Array.from({ length: 33 }, (_, i) => ({ x: i % 2 ? .7 : .3, y: i <= 12 ? .2 : i <= 14 ? .4 : .6, z: 0, visibility: 1 }));
  const frame: LandmarkFrame = { timestamp: 0, confidence: 1, pose, left_hand: [], right_hand: [] };
  const { result } = renderHook(() => useSafeCameraMotion(joints, [.2], "g1-upper-body", vi.fn(), []));
  let target: number[] | null = null;
  act(() => { target = result.current.observe(frame); });
  expect(target).toHaveLength(1);
  expect(result.current.reference()).toEqual([.2]);
});
