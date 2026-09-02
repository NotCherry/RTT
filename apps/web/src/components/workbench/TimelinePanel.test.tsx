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
    recording: false,
    fps: 30,
    selectedFrameIndex: 1,
    playheadFrame: 12,
    editorPositions: [0.25],
    dirty: false,
    hasSelection: true,
    onCapture: () => {},
    onTargetFrame: () => {},
    onSelectFrame: () => {},
    onScrubFrame: () => {},
    onUpdateFrame: () => {},
    onUpdateTimestamp: () => {},
    onDeleteFrame: () => {},
    onDuplicateFrame: () => {},
    onPreviewFrame: () => {},
    onSave: () => {},
    onDiscard: () => {},
    onStartRecording: () => {},
    onStopRecording: () => {},
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
      recording={false}
      fps={30}
      selectedFrameIndex={selectedIndex}
      playheadFrame={playheadFrame}
      editorPositions={displayedPositions}
      dirty
      hasSelection
      onTargetFrame={(frame) => {
        if (frame === frameNumberAt(selectedIndex)) {
          setInsertFrame(null);
          setPendingPositions(null);
          return;
        }
        setInsertFrame(frame);
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
      onUpdateTimestamp={() => {}}
      onDeleteFrame={() => {}}
      onDuplicateFrame={() => {}}
      onPreviewFrame={() => {}}
      onSave={() => {}}
      onDiscard={() => {}}
      onStartRecording={() => {}}
      onStopRecording={() => {}}
    />
  );
}

describe("TimelinePanel selected keypose flow", () => {
  afterEach(() => cleanup());
  it("displays frame 12 and its pose inputs, forwards edits, inserts, and validates input", () => {
    const onCapture = vi.fn();
    const onUpdateFrame = vi.fn();
    renderTimeline({ onCapture, onUpdateFrame });

    expect(screen.getByText(/Frame 12 \/ 60/)).toBeInTheDocument();
    expect(screen.getByLabelText("Selected keyframe frame")).toHaveValue(12);
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
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a value between -1 and 1 for shoulder.",
    );
    expect(onUpdateFrame).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Insert full-pose key" }),
    );
    expect(onCapture).toHaveBeenCalledTimes(1);
  });

  it("inserts at the typed frame after scrubbing elsewhere", () => {
    render(<TimelineStateHarness />);

    fireEvent.change(screen.getByLabelText("Scrub keyframes"), {
      target: { value: "12" },
    });
    expect(screen.getByText(/Frame 12 \/ 201/)).toBeInTheDocument();

    const frameInput = screen.getByLabelText("Selected keyframe frame");
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
    fireEvent.change(screen.getByLabelText("Selected keyframe frame"), {
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

  it("updates the frame field for a selected key but preserves typed targets on empty scrubs", () => {
    const onScrubFrame = vi.fn();
    const { rerender } = renderTimeline({ onScrubFrame });
    const frameInput = screen.getByLabelText("Selected keyframe frame");

    fireEvent.change(frameInput, { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Scrub keyframes"), {
      target: { value: "4" },
    });
    expect(frameInput).toHaveValue(30);

    rerender(
      <TimelinePanel
        frames={frames}
        joints={[joint]}
        recording={false}
        fps={30}
        selectedFrameIndex={0}
        playheadFrame={0}
        editorPositions={[0]}
        dirty={false}
        hasSelection
        onCapture={() => {}}
        onTargetFrame={() => {}}
        onSelectFrame={() => {}}
        onScrubFrame={onScrubFrame}
        onUpdateFrame={() => {}}
        onUpdateTimestamp={() => {}}
        onDeleteFrame={() => {}}
        onDuplicateFrame={() => {}}
        onPreviewFrame={() => {}}
        onSave={() => {}}
        onDiscard={() => {}}
        onStartRecording={() => {}}
        onStopRecording={() => {}}
      />,
    );
    expect(frameInput).toHaveValue(0);
  });
});
