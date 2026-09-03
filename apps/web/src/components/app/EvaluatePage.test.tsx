// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvaluatePage } from "./EvaluatePage";

vi.mock("@/components/workbench/RobotViewport", () => ({
    RobotViewport: () => <div data-testid="robot-viewport" />,
}));

afterEach(cleanup);

describe("EvaluatePage identity", () => {
    it("labels which demonstration and checkpoints are playing", () => {
        render(
            <EvaluatePage
                robot={null}
                state={null}
                trained
                busy={false}
                demonstrationsLength={1}
                demonstrationName="Wave"
                demonstrationKind="gesture"
                checkpointCount={3}
                rolloutFrames={[]}
                evaluation={null}
                replaying={false}
                onReplay={() => {}}
                onEvaluate={() => {}}
            />,
        );
        expect(screen.getByText("Evaluating “Wave”")).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent(
            "gesture · 3 authored checkpoints",
        );
    });
});
