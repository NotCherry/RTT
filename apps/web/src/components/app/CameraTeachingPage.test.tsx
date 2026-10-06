// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CameraTeachingPage } from "./CameraTeachingPage";
const storage = vi.hoisted(() => ({ list: vi.fn(), load: vi.fn() }));
vi.mock("@/domain/cameraArchive", () => ({
  listCameraRecordings: storage.list,
  loadCameraRecording: storage.load,
  saveCameraVideo: vi.fn(),
  saveCameraRecording: vi.fn(),
  deleteCameraRecording: vi.fn(),
}));
vi.mock("@/RobotScene", () => ({ RobotScene: () => <div>Robot scene</div> }));
vi.mock("@/components/workbench/RobotViewport", () => ({ RobotViewport: () => <div>Robot viewport</div> }));
afterEach(cleanup);
it("offers saved recordings and processing without opening a camera", async () => {
  const recording = {
    id: "old",
    name: "Earlier recording",
    created_at: "2026-09-19",
    duration_ms: 2000,
    frames: [],
    source: { kind: "local-media-stream", stream_count: 1 },
    sample_rate: 15,
  };
  storage.list.mockResolvedValue([recording]);
  storage.load.mockResolvedValue({ ...recording, video: new Blob() });
  URL.createObjectURL = vi.fn(() => "blob:recording");
  URL.revokeObjectURL = vi.fn();
  render(
    <CameraTeachingPage
      robot={{ id: "robot" } as never}
      state={null}
      joints={[{ name: "right_shoulder_roll_joint", lower: -3, upper: 3, controllable: true } as never]}
      neutral={[0]}
      onPreview={vi.fn()}
      onSave={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Recordings" }));
  fireEvent.click(await screen.findByRole("button", { name: /Earlier recording/ }));
  expect(await screen.findByRole("button", { name: "Extract stick figure" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Save robot gesture" })).toBeDisabled();
});

it("reopens extracted frames and reports archive save failures without claiming success", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const recording = {
    id: "processed",
    name: "Processed movement",
    created_at: "2026-09-19",
    duration_ms: 100,
    source: { kind: "local-media-stream", stream_count: 1 },
    sample_rate: 10,
    processed: true,
    frames: [0, 100].map((timestamp) => ({
      timestamp,
      pose: Array.from({ length: 33 }, (_, index) => ({ x: index % 2 ? 0.3 : 0.7, y: index <= 12 ? 0.2 : index <= 14 ? 0.4 : index <= 16 ? 0.6 : 0.8, z: 0 })),
      left_hand: [],
      right_hand: [],
      confidence: 1,
    })),
  };
  storage.list.mockResolvedValue([{ ...recording, frame_count: 2 }]);
  storage.load.mockResolvedValue(recording);
  const save = vi.fn().mockRejectedValue(new Error("Storage quota exceeded"));
  render(
    <CameraTeachingPage
      robot={{ id: "robot" } as never}
      state={null}
      joints={[{ name: "right_shoulder_roll_joint", lower: -3, upper: 3, controllable: true } as never]}
      neutral={[0]}
      onPreview={vi.fn()}
      onSave={save}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Recordings" }));
  fireEvent.click(await screen.findByRole("button", { name: /Processed movement/ }));
  expect(await screen.findByRole("button", { name: "Play" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Mapping scope"), { target: { value: "g1-full-body" } });
  fireEvent.click(screen.getByRole("button", { name: "Save robot gesture" }));
  expect(await screen.findByText(/Save failed: Storage quota exceeded/)).toBeInTheDocument();
  expect(screen.queryByText(/Saved to Archive/)).not.toBeInTheDocument();
  expect(save.mock.calls[0][0].frames).toHaveLength(2);
  expect(save.mock.calls[0][0].retargeting_profile_version).toBe(3);
  expect(save.mock.calls[0][0].retargeting_profile).toBe("g1-full-body");
});

it("holds the entry neutral across preview feedback and prevents saving unmappable clips", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const recording = {
    id: "standing", name: "Standing", created_at: "2026-09-19", duration_ms: 100,
    source: { kind: "local-media-stream" as const, stream_count: 1 as const }, sample_rate: 10 as const,
    processed: true, frames: [{ timestamp: 0, confidence: 1, left_hand: [], right_hand: [],
      pose: Array.from({ length: 33 }, (_, index) => ({ x: index % 2 ? 0.3 : 0.7,
        y: index <= 12 ? 0.2 : index <= 14 ? 0.4 : index <= 16 ? 0.6 : 0.8, z: 0 })) }],
  };
  storage.list.mockResolvedValue([{ ...recording, frame_count: 1 }]);
  storage.load.mockResolvedValue(recording);
  const props = { robot: { id: "robot" } as never, state: null,
    joints: [{ name: "right_shoulder_roll_joint", lower: -3, upper: 3, controllable: true } as never],
    neutral: [.2], onPreview: vi.fn(), onSave: vi.fn().mockResolvedValue(undefined) };
  const page = render(<CameraTeachingPage {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Recordings" }));
  fireEvent.click(await screen.findByRole("button", { name: /Standing/ }));
  expect(await screen.findByRole("button", { name: "Play" })).toBeEnabled();
  page.rerender(<CameraTeachingPage {...props} neutral={[1]} />);
  fireEvent.click(screen.getByRole("button", { name: /Standing/ }));
  await screen.findByRole("button", { name: "Save robot gesture" });
  fireEvent.click(screen.getByRole("button", { name: "Save robot gesture" }));
  await screen.findByText(/Saved to Archive/);
  expect(props.onSave.mock.calls[0][1][0][0]).toBeCloseTo(.2);
  fireEvent.change(screen.getByLabelText("Mapping scope"), { target: { value: "single" } });
  fireEvent.change(screen.getByLabelText("Arm selection"), { target: { value: "g1-left-arm" } });
  expect(screen.getByRole("button", { name: "Save robot gesture" })).toBeDisabled();
  expect(screen.getByText(/No joints can be mapped/)).toBeInTheDocument();
});
