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

const savedMessage = "Saved 3 keyframes.";

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

  it("confirms a successful save without duplicating the panel save row", () => {
    render(
      <TeachingTimelinePage
        {...baseProps}
        timelineDirty
        hasSelection
        gestureName="Wave"
        onRenameGesture={() => {}}
        saveConfirmation={savedMessage}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(savedMessage);
  });

  it("disables rename when nothing is selected", () => {
    render(
      <TeachingTimelinePage
        {...baseProps}
        timelineDirty={false}
        hasSelection={false}
        gestureName=""
        onRenameGesture={() => {}}
        saveConfirmation={null}
      />,
    );
    expect(screen.getByLabelText("Gesture name")).toBeDisabled();
  });
});
