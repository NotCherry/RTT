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
      joints={[]}
      neutral={[]}
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
      pose: Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0 })),
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
      joints={[]}
      neutral={[]}
      onPreview={vi.fn()}
      onSave={save}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Recordings" }));
  fireEvent.click(await screen.findByRole("button", { name: /Processed movement/ }));
  expect(await screen.findByRole("button", { name: "Play" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Save robot gesture" }));
  expect(await screen.findByText(/Save failed: Storage quota exceeded/)).toBeInTheDocument();
  expect(screen.queryByText(/Saved to Archive/)).not.toBeInTheDocument();
  expect(save.mock.calls[0][0].frames).toHaveLength(2);
});
