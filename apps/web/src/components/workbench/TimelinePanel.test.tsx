// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  frameToTimestamp,
  timestampToFrame,
  upsertFrameAtFrame,
} from "@/domain/timeline";
import type { DemonstrationFrame, Joint } from "@/types";
import { TimelinePanel } from "./TimelinePanel";

const joint: Joint = {
  name: "shoulder",
  type: "revolute",
  parent: "base",
  child: "arm",
  origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
  axis: [0, 0, 1],
  lower: -1,
  upper: 1,
  controllable: true,
};

const frames: DemonstrationFrame[] = [
  { timestamp: 0, positions: [0] },
  { timestamp: frameToTimestamp(12, 30), positions: [0.25] },
];

const renderTimeline = (
  overrides: Partial<React.ComponentProps<typeof TimelinePanel>> = {},
) => {
  const props: React.ComponentProps<typeof TimelinePanel> = {
    frames,
    joints: [joint],
    fps: 30,
    selectedFrameIndex: 1,
    playheadFrame: 12,
    durationFrames: 60,
    editorPositions: [0.25],
    dirty: false,
    hasSelection: true,
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
    ...overrides,
  };
  return render(<TimelinePanel {...props} />);
};

/**
 * Mirrors the App-level staging logic: pose edits go to the selected keyframe
 * unless a new target frame is staged, in which case they accumulate in a
 * pending pose that only commits when Insert (onCapture) runs.
 */
function TimelineStateHarness() {
  const [currentFrames, setCurrentFrames] = useState([
    { timestamp: 0, positions: [0] },
    { timestamp: frameToTimestamp(189, 30), positions: [0.75] },
  ]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [playheadFrame, setPlayheadFrame] = useState(0);
  const [pendingPositions, setPendingPositions] = useState<number[] | null>(
    null,
  );
  const [insertFrame, setInsertFrame] = useState<number | null>(null);

  const frameNumberAt = (index: number) =>
    timestampToFrame(currentFrames[index]?.timestamp ?? 0, 30);
  const displayedPositions = pendingPositions ??
    currentFrames[selectedIndex]?.positions ?? [0];

  return (
    <TimelinePanel
      frames={currentFrames}
      joints={[joint]}
      fps={30}
      selectedFrameIndex={selectedIndex}
      playheadFrame={playheadFrame}
      durationFrames={201}
      editorPositions={displayedPositions}
      dirty
      hasSelection
      onTargetFrame={(frame) => {
        setInsertFrame(frame);
        if (frame === playheadFrame) return;
        setPlayheadFrame(frame);
        setPendingPositions((current) => current ?? [...displayedPositions]);
      }}
      onCapture={(targetFrame) => {
        const stagedFrame = targetFrame ?? insertFrame ?? playheadFrame;
        const next = upsertFrameAtFrame(
          currentFrames,
          stagedFrame,
          pendingPositions ?? displayedPositions,
          30,
        );
        setCurrentFrames(next);
        setPlayheadFrame(stagedFrame);
        setInsertFrame(null);
        setPendingPositions(null);
        setSelectedIndex(
          next.findIndex(
            (frame) => timestampToFrame(frame.timestamp, 30) === stagedFrame,
          ),
        );
      }}
      onSelectFrame={(index) => {
        setSelectedIndex(index);
        setPlayheadFrame(frameNumberAt(index));
        setPendingPositions(null);
        setInsertFrame(null);
      }}
      onScrubFrame={(frame) => {
        setPlayheadFrame(frame);
        setInsertFrame(null);
        const occupiedIndex = currentFrames.findIndex(
          (item) => timestampToFrame(item.timestamp, 30) === frame,
        );
        if (occupiedIndex >= 0) {
          setSelectedIndex(occupiedIndex);
          setPendingPositions(null);
        } else {
          setPendingPositions([...displayedPositions]);
        }
      }}
      onUpdateFrame={(frameIndex, jointIndex, value) => {
        if (pendingPositions) {
          setPendingPositions(
            pendingPositions.map((position, index) =>
              index === jointIndex ? value : position,
            ),
          );
          return;
        }
        setCurrentFrames((current) =>
          current.map((item, index) =>
            index === frameIndex
              ? {
                  ...item,
                  positions: item.positions.map((position, positionIndex) =>
                    positionIndex === jointIndex ? value : position,
                  ),
                }
              : item,
          ),
        );
      }}
      onDeleteFrame={() => {}}
      onDuplicateFrame={() => {}}
      onPreviewFrame={() => {}}
      onSave={() => {}}
      onDiscard={() => {}}
      onFpsChange={() => {}}
      onDurationChange={() => {}}
    />
  );
}

describe("TimelinePanel selected keypose flow", () => {
  afterEach(() => cleanup());
  it("displays frame 12 and lets a pose value be cleared and replaced", () => {
    const onCapture = vi.fn();
    const onUpdateFrame = vi.fn();
    renderTimeline({ onCapture, onUpdateFrame });

    expect(screen.getByText(/Frame 12 \/ 60/)).toBeInTheDocument();
    expect(screen.getByLabelText("Insert frame")).toHaveValue(12);
    const poseInput = screen.getByRole("spinbutton", {
      name: "shoulder at selected keyframe",
    });
    expect(poseInput).toHaveValue(0.25);
    expect(document.querySelector(".keyframe-diamond.selected")).toBeTruthy();

    fireEvent.change(poseInput, { target: { value: "0.5" } });
    expect(onUpdateFrame).toHaveBeenCalledWith(1, 0, 0.5);

    fireEvent.click(
      screen.getByRole("button", { name: "Insert full-pose key" }),
    );
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith(12);

    fireEvent.change(poseInput, { target: { value: "" } });
    expect(poseInput).toHaveValue(null);
    expect(onUpdateFrame).toHaveBeenCalledTimes(1);

    fireEvent.change(poseInput, { target: { value: "-0.4" } });
    expect(onUpdateFrame).toHaveBeenLastCalledWith(1, 0, -0.4);
  });

  it("rejects an out-of-range pose value", () => {
    const onUpdateFrame = vi.fn();
    renderTimeline({ onUpdateFrame });

    fireEvent.change(
      screen.getByRole("spinbutton", {
        name: "shoulder at selected keyframe",
      }),
      { target: { value: "2" } },
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a value between -1 and 1 for shoulder.",
    );
    expect(onUpdateFrame).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Insert full-pose key" }),
    ).toBeDisabled();

    fireEvent.blur(
      screen.getByRole("spinbutton", {
        name: "shoulder at selected keyframe",
      }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Insert full-pose key" }),
    ).toBeEnabled();
  });

  it("inserts at the typed frame after scrubbing elsewhere", () => {
    render(<TimelineStateHarness />);

    fireEvent.change(screen.getByLabelText("Scrub keyframes"), {
      target: { value: "12" },
    });
    expect(screen.getByText(/Frame 12 \/ 201/)).toBeInTheDocument();

    const frameInput = screen.getByLabelText("Insert frame");
    fireEvent.change(frameInput, { target: { value: "30" } });

    const poseInput = screen.getByRole("spinbutton", {
      name: "shoulder at selected keyframe",
    });
    fireEvent.change(poseInput, { target: { value: "0.5" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Insert full-pose key" }),
    );

    expect(screen.getByText(/Frame 30 \/ 201/)).toBeInTheDocument();
    expect(frameInput).toHaveValue(30);
    expect(
      screen.getByRole("button", {
        name: "Keyframe 2 at frame 30 for shoulder",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "shoulder at selected keyframe" }),
    ).toHaveValue(0.5);
    expect(document.querySelector(".keyframe-diamond.selected")).toBeTruthy();
  });

  it("stages pose edits at a typed target frame without touching the selected keyframe", () => {
    render(<TimelineStateHarness />);

    // Selection starts on frame 0 with pose 0.
    const poseInput = screen.getByRole("spinbutton", {
      name: "shoulder at selected keyframe",
    });
    expect(poseInput).toHaveValue(0);

    // Type a new target frame, then author the pose for it.
    fireEvent.change(screen.getByLabelText("Insert frame"), {
      target: { value: "45" },
    });
    fireEvent.change(poseInput, { target: { value: "0.5" } });

    // Insert commits the staged pose at frame 45.
    fireEvent.click(
      screen.getByRole("button", { name: "Insert full-pose key" }),
    );

    expect(screen.getByText(/Frame 45 \/ 201/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Keyframe 2 at frame 45 for shoulder",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "shoulder at selected keyframe" }),
    ).toHaveValue(0.5);

    // Frame 0 keeps its original pose — edits never leaked into it.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Keyframe 1 at frame 0 for shoulder",
      }),
    );
    expect(
      screen.getByRole("spinbutton", { name: "shoulder at selected keyframe" }),
    ).toHaveValue(0);
  });

  it("scrubbing to an empty frame and inserting keys at the playhead, never frame 0", () => {
    render(<TimelineStateHarness />);

    // Scrub to empty frame 12 — the playhead pose becomes the staged pose.
    fireEvent.change(screen.getByLabelText("Scrub keyframes"), {
      target: { value: "12" },
    });

    // Author the pose for frame 12.
    const poseInput = screen.getByRole("spinbutton", {
      name: "shoulder at selected keyframe",
    });
    fireEvent.change(poseInput, { target: { value: "0.5" } });

    fireEvent.click(
      screen.getByRole("button", { name: "Insert full-pose key" }),
    );

    expect(screen.getByText(/Frame 12 \/ 201/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Keyframe 2 at frame 12 for shoulder",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "shoulder at selected keyframe" }),
    ).toHaveValue(0.5);

    // Frame 0 keeps its original pose.
    fireEvent.click(
      screen.getByRole("button", {
        name: "Keyframe 1 at frame 0 for shoulder",
      }),
    );
    expect(
      screen.getByRole("spinbutton", { name: "shoulder at selected keyframe" }),
    ).toHaveValue(0);
  });

  it("edits apply to the selected keyframe when no new target frame is staged", () => {
    render(<TimelineStateHarness />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Keyframe 2 at frame 189 for shoulder",
      }),
    );
    const poseInput = screen.getByRole("spinbutton", {
      name: "shoulder at selected keyframe",
    });
    expect(poseInput).toHaveValue(0.75);

    fireEvent.change(poseInput, { target: { value: "-0.5" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Insert full-pose key" }),
    );

    // The unchanged frame field replaces the selected key in place.
    expect(screen.getByText(/Frame 189 \/ 201/)).toBeInTheDocument();
    expect(
      screen.getByRole("spinbutton", { name: "shoulder at selected keyframe" }),
    ).toHaveValue(-0.5);
  });

  it("keeps the frame field synced to the insert target (playhead) and stages typed frames", () => {
    const onTargetFrame = vi.fn();
    const { rerender } = renderTimeline({ onTargetFrame });
    const frameInput = screen.getByLabelText("Insert frame");

    // Typing a frame stages it as the insert target via onTargetFrame.
    fireEvent.change(frameInput, { target: { value: "30" } });
    expect(onTargetFrame).toHaveBeenCalledWith(30);
    // The typed value holds until the playhead (insert target) prop moves.
    expect(frameInput).toHaveValue(30);

    // Scrubbing elsewhere moves the insert target; the field follows it.
    rerender(
      <TimelinePanel
        frames={frames}
        joints={[joint]}
        fps={30}
        selectedFrameIndex={0}
        playheadFrame={4}
        durationFrames={60}
        editorPositions={[0]}
        dirty={false}
        hasSelection
        onCapture={() => {}}
        onTargetFrame={onTargetFrame}
        onSelectFrame={() => {}}
        onScrubFrame={() => {}}
        onUpdateFrame={() => {}}
        onDeleteFrame={() => {}}
        onDuplicateFrame={() => {}}
        onPreviewFrame={() => {}}
        onSave={() => {}}
        onDiscard={() => {}}
        onFpsChange={() => {}}
        onDurationChange={() => {}}
      />,
    );
    expect(frameInput).toHaveValue(4);
  });
});
