// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Joint, LandmarkFrame } from "@/types";
import { CameraTeachingPage } from "./CameraTeachingPage";

const live = vi.hoisted(() => ({ submit: vi.fn(), joints: null as Joint[] | null, frame: null as null | ((frame: LandmarkFrame) => void) }));
vi.mock("@/domain/cameraArchive", () => ({ listCameraRecordings: async () => [] }));
vi.mock("@/components/camera/useRobotTransport", () => ({ useRobotTransport: () => ({ submit: live.submit, controlJoints: live.joints, status: null, busy: false }) }));
vi.mock("@/components/camera/RobotConnectionPanel", () => ({ RobotConnectionPanel: () => null }));
vi.mock("@/components/camera/CameraCapturePanel", () => ({ CameraCapturePanel: () => null }));
vi.mock("@/components/camera/CameraSourcePanel", () => ({ CameraSourcePanel: () => null }));
vi.mock("@/components/camera/useSafeCameraMotion", () => ({ useSafeCameraMotion: () => ({ observe: () => [.1, -.1, .2, .3, .4, .5], status: "" }) }));
vi.mock("@/components/camera/useMultiCameraCapture", () => ({ useMultiCameraCapture: (options: { onFrame: (frame: LandmarkFrame) => void }) => {
  live.frame = options.onFrame;
  return { rig: { inputs: [{ kind: "local", address: "" }] }, connected: true, status: "Ready" };
} }));
afterEach(() => { cleanup(); live.submit.mockClear(); live.joints = null; });

const joints = ["waist_yaw_joint", "waist_roll_joint", "waist_pitch_joint", "left_elbow_joint", "right_elbow_joint", "left_knee_joint"]
  .map(name => ({ name, controllable: true, lower: -3, upper: 3 } as Joint));
function frame(): LandmarkFrame {
  const pose = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
  for (const [index, x, y] of [[11, .65, .2], [12, .35, .2], [13, .65, .4], [14, .35, .4], [15, .65, .6],
    [16, .35, .6], [23, .6, .5], [24, .4, .5]]) pose[index] = { x, y, z: 0, visibility: 1 };
  return { timestamp: 0, confidence: 1, pose, pose_world: pose.map(point => ({ ...point })), left_hand: [], right_hand: [] };
}
function open() {
  render(<CameraTeachingPage robot={{ id: "robot" } as never} state={null} joints={joints} neutral={joints.map(() => 0)} onPreview={vi.fn()} onSave={vi.fn()} />);
}
it("passes all visible torso axes through the actual live camera callback without leg targets", async () => {
  open();
  await act(async () => live.frame!(frame()));
  expect(live.submit).toHaveBeenLastCalledWith({ waist_yaw_joint: .1, waist_roll_joint: -.1, waist_pitch_joint: .2,
    left_elbow_joint: .3, right_elbow_joint: .4 });
  const hiddenHips = frame();
  hiddenHips.pose[23].visibility = hiddenHips.pose[24].visibility = 0;
  await act(async () => live.frame!(hiddenHips));
  expect(live.submit).toHaveBeenLastCalledWith({ left_elbow_joint: .3, right_elbow_joint: .4 });
});
it("single-arm camera mapping passes only the selected side even when both arms and hips are visible", async () => {
  open();
  fireEvent.change(screen.getByLabelText("Mapping scope"), { target: { value: "single" } });
  await act(async () => live.frame!(frame()));
  expect(live.submit).toHaveBeenLastCalledWith({ right_elbow_joint: .4 });
  fireEvent.change(screen.getByLabelText("Arm selection"), { target: { value: "g1-left-arm" } });
  await act(async () => live.frame!(frame()));
  expect(live.submit).toHaveBeenLastCalledWith({ left_elbow_joint: .3 });
});
it("maps the connected hardware waist even when the preview model lacks roll and pitch", async () => {
  live.joints = joints.filter(joint => !joint.name.includes("knee"));
  const preview = joints.filter(joint => !["waist_roll_joint", "waist_pitch_joint"].includes(joint.name));
  render(<CameraTeachingPage robot={{ id: "basic-preview" } as never} state={null} joints={preview} neutral={preview.map(() => 0)} onPreview={vi.fn()} onSave={vi.fn()} />);
  await act(async () => live.frame!(frame()));
  expect(live.submit).toHaveBeenLastCalledWith(expect.objectContaining({ waist_yaw_joint: expect.any(Number),
    waist_roll_joint: expect.any(Number), waist_pitch_joint: expect.any(Number) }));
  expect(live.submit.mock.lastCall![0]).not.toHaveProperty("left_knee_joint");
});
