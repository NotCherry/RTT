import { expect, it } from "vitest";
import { coherentCameraViews, nearestCameraFrame, TRIANGULATION_SYNC_MS } from "./cameraViewAlignment";
import type { LandmarkFrame } from "@/types";
const frame = (timestamp: number) => ({ timestamp } as LandmarkFrame);
it("uses a bounded history to select the nearest exposure observation", () => {
  expect(nearestCameraFrame([frame(950),frame(985),frame(1020)], 1000, TRIANGULATION_SYNC_MS)?.timestamp).toBe(985);
  expect(nearestCameraFrame([frame(960)], 1000, TRIANGULATION_SYNC_MS)).toBeNull();
});
it("never combines opposite offsets into a two-frame-wide time slice", () => {
  const result = coherentCameraViews([{ frame: frame(1000) }, { frame: frame(970) }, { frame: frame(1030) }], TRIANGULATION_SYNC_MS);
  expect(result).toHaveLength(2);
  const stamps = result.map(v => v.frame!.timestamp);
  expect(Math.max(...stamps)-Math.min(...stamps)).toBeLessThanOrEqual(TRIANGULATION_SYNC_MS);
});
