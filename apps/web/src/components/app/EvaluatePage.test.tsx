// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvaluatePage } from "./EvaluatePage";

vi.mock("@/RobotScene", () => ({
    RobotScene: () => <div data-testid="robot-scene" />,
}));

afterEach(cleanup);

function renderEvaluate(
        overrides: Partial<React.ComponentProps<typeof EvaluatePage>> = {},
    ) {
        return render(
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
                {...overrides}
            />,
        );
    }

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

    it("disables Play rollout until a full trajectory exists", () => {
        renderEvaluate({ rolloutFrames: [] });
        expect(screen.getByRole("button", { name: "Play rollout" })).toBeDisabled();
        cleanup();
        renderEvaluate({
            rolloutFrames: [
                { timestamp: 0, positions: [0], expected: [0] },
            ],
        });
        expect(screen.getByRole("button", { name: "Play rollout" })).toBeDisabled();
    });

    it("enables replay and reset behavior for a complete rollout", () => {
        const onReplay = vi.fn();
        renderEvaluate({
            rolloutFrames: [
                { timestamp: 0, positions: [0], expected: [0] },
                { timestamp: 120, positions: [0.5], expected: [0.5] },
                { timestamp: 240, positions: [1], expected: [1] },
            ],
            onReplay,
        });
        const playButton = screen.getByRole("button", { name: "Play rollout" });
        expect(playButton).toBeEnabled();
        playButton.click();
        expect(onReplay).toHaveBeenCalledTimes(1);
        cleanup();
        renderEvaluate({
            rolloutFrames: [
                { timestamp: 0, positions: [0], expected: [0] },
                { timestamp: 120, positions: [1], expected: [1] },
            ],
            replaying: true,
            onReplay,
        });
        expect(screen.getByRole("button", { name: "Replaying" })).toBeEnabled();
    });
});
