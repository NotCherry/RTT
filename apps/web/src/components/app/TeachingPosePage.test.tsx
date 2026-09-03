// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeachingPosePage } from "./TeachingPosePage";
import type { Joint } from "@/types";

vi.mock("@/components/workbench/RobotViewport", () => ({
  RobotViewport: () => <div data-testid="robot-viewport" />,
}));

const joints: Joint[] = [
  {
    name: "shoulder",
    type: "revolute",
    parent: "base",
    child: "arm",
    origin: { xyz: [0, 0, 0], rpy: [0, 0, 0] },
    axis: [0, 0, 1],
    lower: -1,
    upper: 1,
    controllable: true,
  },
];

afterEach(cleanup);

// Minimal robot stub: only used as a non-null guard for the capture button.
const robotStub = { id: "sample-arm", name: "Sample arm" } as never;

function renderPage(props?: Partial<Parameters<typeof TeachingPosePage>[0]>) {
  return render(
    <MemoryRouter>
      <TeachingPosePage
        robot={robotStub}
        state={null}
        controllableJoints={joints}
        positions={[0]}
        busy={false}
        onUpload={() => {}}
        onDemo={() => {}}
        onReset={() => {}}
        onUpdateJoint={() => {}}
        onCapture={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
}

describe("TeachingPosePage save UX", () => {
  it("captures with the typed pose name", () => {
    const onCapture = vi.fn();
    renderPage({ onCapture });
    fireEvent.change(screen.getByLabelText("Pose name"), {
      target: { value: "Home pose" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Capture pose" }));
    expect(onCapture).toHaveBeenCalledWith("Home pose");
  });

  it("falls back to the default name when the field is blank", () => {
    const onCapture = vi.fn();
    renderPage({ onCapture });
    fireEvent.click(screen.getByRole("button", { name: "Capture pose" }));
    expect(onCapture).toHaveBeenCalledWith(undefined);
  });

  it("confirms the saved pose by name", () => {
    renderPage({ savedPoseName: "Home pose" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Saved “Home pose” to the archive.",
    );
  });
});
