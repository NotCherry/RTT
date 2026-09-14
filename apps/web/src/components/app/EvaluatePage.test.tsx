// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
            evaluationStepBudget={160}
            replaying={false}
            onReplay={() => {}}
            onEvaluate={() => {}}
            onEvaluationStepBudgetChange={() => {}}
            {...overrides}
        />,
    );
}

describe("EvaluatePage identity", () => {
    it("describes the rollout budget as an evaluation cap, not a quality control", () => {
        const onEvaluationStepBudgetChange = vi.fn();
        renderEvaluate({ onEvaluationStepBudgetChange });

        const budget = screen.getByRole("spinbutton", {
            name: "Evaluation step budget",
        });
        expect(budget).toHaveValue(160);
        expect(screen.getByText(/does not retrain or improve model quality/i)).toBeInTheDocument();
        fireEvent.change(budget, { target: { value: "800" } });
        expect(onEvaluationStepBudgetChange).toHaveBeenCalledWith("800");
    });

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
                evaluationStepBudget={160}
                replaying={false}
                onReplay={() => {}}
                onEvaluate={() => {}}
                onEvaluationStepBudgetChange={() => {}}
            />,
        );
        expect(screen.getByText("Evaluating “Wave”")).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent(
            "gesture · 3 authored checkpoints",
        );
    });

    it("disables Play rollout until a full trajectory exists", () => {
        renderEvaluate({ rolloutFrames: [] });
        expect(
            screen.getByRole("button", { name: "Play rollout" }),
        ).toBeDisabled();
        cleanup();
        renderEvaluate({
            rolloutFrames: [{ timestamp: 0, positions: [0], expected: [0] }],
        });
        expect(
            screen.getByRole("button", { name: "Play rollout" }),
        ).toBeDisabled();
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
        expect(onReplay).toHaveBeenCalledTimes(1);
        playButton.click();
        expect(onReplay).toHaveBeenCalledTimes(2);
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

    it("automatically plays a newly completed neural-network rollout", () => {
        const onReplay = vi.fn();
        const view = renderEvaluate({ onReplay });

        view.rerender(
            <EvaluatePage
                robot={null}
                state={null}
                trained
                busy={false}
                demonstrationsLength={1}
                demonstrationName="Wave"
                demonstrationKind="gesture"
                checkpointCount={3}
                rolloutFrames={[
                    { timestamp: 0, positions: [0], expected: [0] },
                    { timestamp: 120, positions: [0.5], expected: [0.4] },
                    { timestamp: 240, positions: [1], expected: [0.9] },
                ]}
                evaluation={{ target: [0.9], positions: [1], error: 0.1 }}
                evaluationStepBudget={160}
                replaying={false}
                onReplay={onReplay}
                onEvaluate={() => {}}
                onEvaluationStepBudgetChange={() => {}}
            />,
        );

        expect(onReplay).toHaveBeenCalledTimes(1);
    });

    it("distinguishes a derived pose preview from the model prediction", () => {
        renderEvaluate({
            demonstrationKind: "pose",
            checkpointCount: 1,
            rolloutFrames: [
                {
                    timestamp: 0,
                    positions: [0],
                    expected: [0],
                    source: "derived-preview",
                },
                {
                    timestamp: 60,
                    positions: [0.5],
                    expected: [0.4],
                    source: "model-prediction",
                },
            ],
            evaluation: { target: [0.4], positions: [0.5], error: 0.1 },
        });

        expect(
            screen.getByRole("button", { name: "Play prediction preview" }),
        ).toBeEnabled();
        expect(screen.getByRole("status")).toHaveTextContent(
            "1 derived preview frame · 1 model prediction",
        );
        expect(screen.getByText(/Derived preview 1/)).toBeInTheDocument();
        expect(screen.getByText(/Model prediction 2/)).toBeInTheDocument();
        expect(screen.queryByText(/Physics:/)).not.toBeInTheDocument();
    });
});
