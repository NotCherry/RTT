import { useEffect, useRef } from "react";
import {
        Button,
        Panel,
        PanelHeader,
        PanelLabel,
        StatusPill,
} from "@/components/ui";
import { H2, H3, IntroCopy, Kicker } from "@/components/ui/typography";
import { RobotViewport } from "@/components/workbench/RobotViewport";
import { Progress } from "@/components/ui/progress";
import type { Robot, SimulationState, RolloutFrame } from "@/types";
import { meanAbsoluteError as meanError } from "@/domain/metrics";

type EvaluationResult = {
        target: number[];
        positions: number[];
        error: number;
};

type EvaluatePageProps = {
        robot: Robot | null;
        state: SimulationState | null;
        trained: boolean;
        busy: boolean;
        demonstrationsLength: number;
        demonstrationName: string | null;
        demonstrationKind: string | null;
        checkpointCount: number;
        rolloutFrames: RolloutFrame[];
        rolloutDiagnostics?: {
                density_ratio?: number;
                warnings?: { type: string; message: string }[];
                segment_diagnostics?: {
                        segment_index: number;
                        raw_steps: number;
                        scaled_steps: number;
                        density_ratio: number;
                }[];
                coordination?: {
                        simultaneity: number;
                        direction_alignment: number;
                        multi_joint_steps: number;
                        sequential: boolean;
                } | null;
        } | null;
        evaluation: EvaluationResult | null;
        replaying: boolean;
        onReplay: () => void;
        onEvaluate: () => void;
};

export function EvaluatePage({
        robot,
        state,
        trained,
        busy,
        demonstrationsLength,
        demonstrationName,
        demonstrationKind,
        checkpointCount,
        rolloutFrames,
        rolloutDiagnostics,
        evaluation,
        replaying,
        onReplay,
        onEvaluate,
}: EvaluatePageProps) {
        const lastAutoPlayedRollout = useRef<RolloutFrame[] | null>(null);
        const derivedPreviewCount = rolloutFrames.filter(
                (frame) => frame.source === "derived-preview",
        ).length;

        useEffect(() => {
                if (rolloutFrames.length < 2) {
                        lastAutoPlayedRollout.current = null;
                        return;
                }
                if (lastAutoPlayedRollout.current === rolloutFrames) return;
                lastAutoPlayedRollout.current = rolloutFrames;
                onReplay();
        }, [onReplay, rolloutFrames]);

        return (
                <div className="route-page">
                        <div className="route-heading">
                                <div>
                                        <Kicker>EVALUATE / TRAJECTORY</Kicker>
                                        <H2>Inspect the learned motion.</H2>
                                        <IntroCopy>
                                                Watch the model result in the
                                                viewport and compare gesture
                                                rollouts against every authored
                                                keyframe.
                                        </IntroCopy>
                                </div>
                                <StatusPill online={trained}>
                                        {trained
                                                ? "Evaluation ready"
                                                : "Train a model first"}
                                </StatusPill>
                        </div>
                        <div className="route-two-column">
                                <RobotViewport
                                        robot={robot}
                                        state={state}
                                        label="PREDICTED VIEWPORT"
                                        title={robot?.name ?? "Awaiting robot"}
                                        action={
                                                <Button
                                                        size="small"
                                                        variant="secondary"
                                                        onClick={onReplay}
                                                        disabled={
                                                                rolloutFrames.length <
                                                                2
                                                        }
                                                >
                                                        {replaying
                                                                ? "Replaying"
                                                                : demonstrationKind ===
                                                                    "pose"
                                                                  ? "Play prediction preview"
                                                                  : "Play rollout"}
                                                </Button>
                                        }
                                />
                                <Panel className="route-content-panel">
                                        <PanelHeader>
                                                <div>
                                                        <PanelLabel>
                                                                CHECKPOINT
                                                                COMPARISON
                                                        </PanelLabel>
                                                        <H3>
                                                                {demonstrationName
                                                                        ? `Evaluating “${demonstrationName}”`
                                                                        : rolloutFrames.length
                                                                          ? `${rolloutFrames.length} predicted frames`
                                                                          : "No rollout yet"}
                                                        </H3>
                                                        {demonstrationName && (
                                                                <p
                                                                        className="helper-text"
                                                                        role="status"
                                                                >
                                                                        {demonstrationKind ??
                                                                                "demonstration"}{" "}
                                                                        ·{" "}
                                                                        {
                                                                                checkpointCount
                                                                        }{" "}
                                                                        authored{" "}
                                                                        checkpoint
                                                                        {checkpointCount ===
                                                                        1
                                                                                ? ""
                                                                                : "s"}
                                                                        {rolloutFrames.length >
                                                                                0 &&
                                                                                (derivedPreviewCount
                                                                                        ? ` · ${derivedPreviewCount} derived preview frame${derivedPreviewCount === 1 ? "" : "s"} · 1 model prediction`
                                                                                        : ` · ${rolloutFrames.length} model rollout frames`)}
                                                                </p>
                                                        )}
                                                </div>
                                        </PanelHeader>
                                        <div className="evaluation-route-content">
                                                <Button
                                                        variant="primary"
                                                        full
                                                        onClick={onEvaluate}
                                                        disabled={
                                                                !trained ||
                                                                !demonstrationsLength ||
                                                                busy
                                                        }
                                                >
                                                        Evaluate selected
                                                        demonstration
                                                </Button>
                                                {rolloutDiagnostics?.warnings
                                                        ?.length ? (
                                                        <div
                                                                className="warning-pill"
                                                                role="alert"
                                                        >
                                                                {rolloutDiagnostics.warnings
                                                                        .map(
                                                                                (
                                                                                        w,
                                                                                ) =>
                                                                                        w.message,
                                                                        )
                                                                        .join(
                                                                                "; ",
                                                                        )}
                                                        </div>
                                                ) : null}
                                                {rolloutDiagnostics?.coordination ? (
                                                        <div
                                                                className={
                                                                        rolloutDiagnostics
                                                                                .coordination
                                                                                .sequential
                                                                                ? "warning-pill"
                                                                                : "helper-text"
                                                                }
                                                                role={
                                                                        rolloutDiagnostics
                                                                                .coordination
                                                                                .sequential
                                                                                ? "alert"
                                                                                : "status"
                                                                }
                                                                title={`Multi-joint steps: ${rolloutDiagnostics.coordination.multi_joint_steps}`}
                                                        >
                                                                {rolloutDiagnostics
                                                                        .coordination
                                                                        .sequential
                                                                        ? `Sequential motion: joints moved one-at-a-time (simultaneity ${rolloutDiagnostics.coordination.simultaneity.toFixed(2)}, direction ${rolloutDiagnostics.coordination.direction_alignment.toFixed(2)}). Retrain — the gesture needs simultaneous motion.`
                                                                        : `Simultaneous motion: simultaneity ${rolloutDiagnostics.coordination.simultaneity.toFixed(2)}, direction ${rolloutDiagnostics.coordination.direction_alignment.toFixed(2)} over ${rolloutDiagnostics.coordination.multi_joint_steps} multi-joint steps.`}
                                                        </div>
                                                ) : null}
                                                {evaluation ? (
                                                        <>
                                                                <div className="route-metric-grid">
                                                                        <div>
                                                                                <PanelLabel>
                                                                                        FINAL
                                                                                        MEAN
                                                                                </PanelLabel>
                                                                                <strong>
                                                                                        {meanError(
                                                                                                evaluation.target,
                                                                                                evaluation.positions,
                                                                                        ).toFixed(
                                                                                                4,
                                                                                        )}
                                                                                </strong>
                                                                        </div>
                                                                        <div>
                                                                                <PanelLabel>
                                                                                        FINAL
                                                                                        MAX
                                                                                </PanelLabel>
                                                                                <strong>
                                                                                        {evaluation.error.toFixed(
                                                                                                4,
                                                                                        )}
                                                                                </strong>
                                                                        </div>
                                                                        <div>
                                                                                <PanelLabel>
                                                                                        TRAJECTORY
                                                                                        MAX
                                                                                </PanelLabel>
                                                                                <strong>
                                                                                        {(() => {
                                                                                                const gestureFrames =
                                                                                                        rolloutFrames.filter(
                                                                                                                (
                                                                                                                        f,
                                                                                                                ) =>
                                                                                                                        (f.phase ??
                                                                                                                                "gesture") ===
                                                                                                                        "gesture",
                                                                                                        );
                                                                                                const maxErr =
                                                                                                        gestureFrames.length
                                                                                                                ? Math.max(
                                                                                                                          ...gestureFrames.map(
                                                                                                                                  (
                                                                                                                                          f,
                                                                                                                                  ) =>
                                                                                                                                          Math.max(
                                                                                                                                                  ...f.positions.map(
                                                                                                                                                          (
                                                                                                                                                                  p,
                                                                                                                                                                  i,
                                                                                                                                                          ) =>
                                                                                                                                                                  Math.abs(
                                                                                                                                                                          p -
                                                                                                                                                                                  (f
                                                                                                                                                                                          .expected[
                                                                                                                                                                                          i
                                                                                                                                                                                  ] ??
                                                                                                                                                                                          p),
                                                                                                                                                                  ),
                                                                                                                                                  ),
                                                                                                                                          ),
                                                                                                                          ),
                                                                                                                  )
                                                                                                                : evaluation.error;
                                                                                                return maxErr.toFixed(
                                                                                                        4,
                                                                                                );
                                                                                        })()}
                                                                                </strong>
                                                                        </div>
                                                                </div>
                                                                {derivedPreviewCount ===
                                                                0 ? (
                                                                        <div className="physics-metrics helper-text">
                                                                        {(() => {
                                                                                const maxTrack =
                                                                                        Math.max(
                                                                                                0,
                                                                                                ...rolloutFrames.map(
                                                                                                        (
                                                                                                                f,
                                                                                                        ) =>
                                                                                                                f.tracking_error ??
                                                                                                                0,
                                                                                                ),
                                                                                        );
                                                                                const clipped =
                                                                                        rolloutFrames.reduce(
                                                                                                (
                                                                                                        sum,
                                                                                                        f,
                                                                                                ) =>
                                                                                                        sum +
                                                                                                        (f.clipped ??
                                                                                                                0),
                                                                                                0,
                                                                                        );
                                                                                const collisions =
                                                                                        rolloutFrames.length
                                                                                                ? "see rollout message"
                                                                                                : "—";
                                                                                return `Physics: max tracking error ${maxTrack.toFixed(4)}, clipped steps ${clipped}, ${collisions}`;
                                                                        })()}
                                                                        </div>
                                                                ) : null}
                                                                {rolloutDiagnostics?.density_ratio !==
                                                                        undefined &&
                                                                        rolloutDiagnostics.density_ratio >
                                                                                1.01 && (
                                                                                <div
                                                                                        className="helper-text"
                                                                                        title={
                                                                                                rolloutDiagnostics.segment_diagnostics
                                                                                                        ?.map(
                                                                                                                (
                                                                                                                        d,
                                                                                                                ) =>
                                                                                                                        `seg ${d.segment_index}: raw ${d.raw_steps} → scaled ${d.scaled_steps}`,
                                                                                                        )
                                                                                                        .join(
                                                                                                                ", ",
                                                                                                        ) ??
                                                                                                ""
                                                                                        }
                                                                                >
                                                                                        Density:{" "}
                                                                                        {rolloutDiagnostics.density_ratio.toFixed(
                                                                                                2,
                                                                                        )}
                                                                                        ×
                                                                                        (raw
                                                                                        →
                                                                                        scaled
                                                                                        {rolloutDiagnostics.segment_diagnostics
                                                                                                ? ` per seg: ${rolloutDiagnostics.segment_diagnostics.map((d) => `${d.raw_steps}→${d.scaled_steps}`).join(", ")}`
                                                                                                : ""}
                                                                                        )
                                                                                </div>
                                                                        )}
                                                                <div className="keyframe-results">
                                                                        {rolloutFrames.map(
                                                                                (
                                                                                        frame,
                                                                                        index,
                                                                                ) => (
                                                                                        <div
                                                                                                className="keyframe-result"
                                                                                                key={`${frame.timestamp}-${index}`}
                                                                                                title={
                                                                                                        frame.tracking_error
                                                                                                                ? `tracking error ${frame.tracking_error.toFixed(4)}`
                                                                                                                : undefined
                                                                                                }
                                                                                        >
                                                                                                <span>
                                                                                                        {frame.source ===
                                                                                                        "derived-preview"
                                                                                                                ? "Derived preview"
                                                                                                                : frame.source ===
                                                                                                                    "model-prediction"
                                                                                                                  ? "Model prediction"
                                                                                                                  : "Rollout frame"}{" "}
                                                                                                        {index +
                                                                                                                1}{" "}
                                                                                                        ·{" "}
                                                                                                        {frame.phase ??
                                                                                                                "gesture"}
                                                                                                        {frame.tracking_error
                                                                                                                ? ` · track ${frame.tracking_error.toFixed(3)}`
                                                                                                                : ""}
                                                                                                </span>
                                                                                                <Progress
                                                                                                        value={Math.min(
                                                                                                                100,
                                                                                                                meanError(
                                                                                                                        frame.expected,
                                                                                                                        frame.positions,
                                                                                                                ) *
                                                                                                                        40,
                                                                                                        )}
                                                                                                        className="mx-3 h-1 flex-1"
                                                                                                />
                                                                                                <span>
                                                                                                        {meanError(
                                                                                                                frame.expected,
                                                                                                                frame.positions,
                                                                                                        ).toFixed(
                                                                                                                4,
                                                                                                        )}{" "}
                                                                                                        error
                                                                                                </span>
                                                                                        </div>
                                                                                ),
                                                                        )}
                                                                </div>
                                                        </>
                                                ) : (
                                                        <div className="test-empty">
                                                                Select a
                                                                demonstration
                                                                and run
                                                                evaluation to
                                                                inspect the
                                                                complete
                                                                trajectory.
                                                        </div>
                                                )}
                                        </div>
                                </Panel>
                        </div>
                </div>
        );
}
