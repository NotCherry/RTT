// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RecordingLibrary } from "./RecordingLibrary";
vi.mock("./RecordingPlayer", () => ({ RecordingPlayer: ({ locked }: { locked: boolean }) => <div>{locked ? "Replay locked" : "Replay ready"}</div> }));
afterEach(cleanup);
const recording = {
  id: "clip", name: "Clip", created_at: "", duration_ms: 1000, sample_rate: 10 as const,
  source: { kind: "local-media-stream" as const, stream_count: 1 as const }, frames: [], video: new Blob(), processed: true,
};
const props = {
  recordings: [{ ...recording, frame_count: 0, has_video: true }], selected: recording, locked: false, extracting: false, progress: 0,
  robot: null, state: null, joints: [], neutral: [], profile: "g1-upper-body" as const,
  onPreview: vi.fn(), onSelect: vi.fn(), onExtract: vi.fn(), onCancel: vi.fn(), onSave: vi.fn(), onRetry: vi.fn(), onDelete: vi.fn(),
};
it("only offers retry saving after a storage failure and displays empty extraction quality", () => {
  const { rerender } = render(<RecordingLibrary {...props} />);
  expect(screen.queryByRole("button", { name: "Retry saving recording" })).not.toBeInTheDocument();
  expect(screen.getByText("No confident pose")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save robot gesture" })).toBeDisabled();
  rerender(<RecordingLibrary {...props} storageFailed locked extracting progress={42} />);
  expect(screen.getByRole("button", { name: "Retry saving recording" })).toBeDisabled();
  expect(screen.getByText("Replay locked")).toBeInTheDocument();
  expect(screen.getByLabelText("Extraction progress")).toHaveAttribute("value", "42");
  expect(screen.getByRole("button", { name: "Cancel extraction" })).toBeEnabled();
});
