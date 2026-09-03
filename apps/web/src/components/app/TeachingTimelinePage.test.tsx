// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeachingTimelinePage } from "./TeachingTimelinePage";

vi.mock("@/components/workbench/RobotViewport", () => ({
  RobotViewport: () => <div data-testid="robot-viewport" />,
}));

vi.mock("@/components/workbench/TimelinePanel", () => ({
  TimelinePanel: () => <div data-testid="timeline-panel" />,
}));

afterEach(cleanup);

const baseProps = {
  robot: null,
  state: null,
  timelineFrames: [],
  controllableJoints: [],
  timelineFps: 30,
  selectedFrameIndex: 0,
  playheadFrame: 0,
  durationFrames: 120,
  editorPositions: [],
  onReset: () => {},
  onCapture: () => {},
  onTargetFrame: () => {},
  onSelectFrame: () => {},
  onScrubFrame: () => {},
  onUpdateFrame: () => {},
  onDeleteFrame: () => {},
  onDuplicateFrame: () => {},
  onPreviewFrame: () => {},
  onSave: () => {},
  onDiscard: () => {},
  onFpsChange: () => {},
  onDurationChange: () => {},
};

describe("TeachingTimelinePage save UX", () => {
  it("renames the gesture before saving", () => {
    const onRenameGesture = vi.fn();
    render(
      <TeachingTimelinePage
        {...baseProps}
        timelineDirty={false}
        hasSelection
        gestureName="Wave"
        onRenameGesture={onRenameGesture}
        saveConfirmation={null}
      />,
    );
    fireEvent.change(screen.getByLabelText("Gesture name"), {
      target: { value: "Wave hello" },
    });
    expect(onRenameGesture).toHaveBeenCalledWith("Wave hello");
  });

  it("keeps save visible and confirms a successful save", () => {
    const onSave = vi.fn();
    render(
      <TeachingTimelinePage
        {...baseProps}
        timelineDirty
        hasSelection
        gestureName="Wave"
        onRenameGesture={() => {}}
        saveConfirmation="Saved 3 keyframes to “Wave”."
        onSave={onSave}
      />,
    );
    const saveButton = screen.getByRole("button", { name: "Save gesture" });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);
    expect(onSave).toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved 3 keyframes to “Wave”.",
    );
  });

  it("disables save when the timeline is clean", () => {
    render(
      <TeachingTimelinePage
        {...baseProps}
        timelineDirty={false}
        hasSelection
        gestureName="Wave"
        onRenameGesture={() => {}}
        saveConfirmation={null}
      />,
    );
    expect(screen.getByRole("button", { name: "Save gesture" })).toBeDisabled();
  });
});
