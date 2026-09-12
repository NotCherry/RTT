# Middle-frame skip revalidation — reproducible root causes & fix plan

**Date:** 2026-09-09
**Question:** User reports the middle-frame problem is back: training skips middle frames even though the reported error is low; the trained robot replays first→last without the timeline's multiframe gesture. Revalidate the 2026-09-08 fixes (`docs/research/training-middle-frame-skip-fix.md`) against the current tree and find what remains broken.

**Method:** End-to-end repros through the real HTTP endpoints (train → rollout), mirroring the frontend flow exactly: timeline keyframes with `timeline_fps=60`, default `TrainConfig` (epochs 300, timestep 120 ms, `rollout_steps` 160, `physics=true`, random_starts 4), scripted approach. Repro scripts: `tmp/repro_middle_skip_revalidate.py` (2-joint demo arm, 4 checkpoints), `tmp/repro_long_gesture.py` (8 checkpoints / 7 s), `tmp/repro_multijoint*.py` (generated 6-joint primitive URDF, velocity limit 1.0 rad/s, 5 checkpoints / 4 s).

---

## 1. Revalidation verdict on the committed fixes

The 2026-09-08 fixes are present and work as claimed (`d3252f9`, `720b2a7`):

- `build_incremental_samples` iterates **all** segments, carries `previous_delta` across boundaries, and emits per-step samples toward each segment goal (verified via goal distribution in repro 1: all three segment endpoints appear as goals).
- Rollout carries `rollout_prev_delta` across segments, computes per-segment diagnostics, and the missed-checkpoint check is time-aligned to segment-end frames.
- The interior-checkpoint warning **does fire**: `Interior checkpoints missed: [2, 3] (MAE >0.12)` on the 6-joint repro.
- The 2-joint demo arm with a short 4-checkpoint gesture trains and **does** hit middle checkpoints (MAE 0.027–0.055) with defaults.

So sample generation and checkpoint bookkeeping no longer collapse to endpoints. **The remaining failure is downstream: convergence, physics feasibility, budget decimation, and error reporting.** On a realistic multi-joint robot the full symptom reproduces.

## 2. Reproduced failure (6-joint primitive URDF, 5 checkpoints over 4 s)

| Scenario | density | clipped steps | Checkpoint MAEs (time-aligned) |
| --- | --- | --- | --- |
| defaults: physics, 300 epochs, max_steps=160 | 1.5x | 959 | **0.028 / 0.644 / 0.462 / 0.283** ← middle checkpoints skipped |
| same, kinematic (physics off) | 1.5x | 0 | 0.028 / 0.184 / 0.329 / 0.121 ← **model itself misses middles** |
| physics, 300 epochs, max_steps=300 (full density) | 1.0x | 1440 | 0.028 / 0.334 / 0.311 / 0.165 |
| **kinematic, 1500 epochs** | 1.0x | 0 | **0.011 / 0.060 / 0.069 / 0.010** ← middles learned |
| kinematic, 1500 epochs, [128,128,64] | 1.0x | 0 | 0.004 / 0.050 / 0.036 / 0.006 |
| physics, 1500 epochs, max_steps=160 | 1.5x | 960 | 0.022 / **0.663** / 0.314 / 0.248 |

## 3. Root causes (validated, ordered)

### RC1 — Under-convergence at the default 300 epochs (primary "robot not learning the gesture")

The 6-joint gesture with direction reversals does not converge in 300 epochs: kinematic checkpoint MAEs 0.18–0.33 (missed) at 300 epochs vs 0.06–0.07 at 1500 epochs. The MLP is sufficient — `[64,64]` reaches 0.06 given epochs; `[128,128,64]` reaches 0.04. Training loss (teacher-forced per-step deltas) is low long before autoregressive replay fidelity is achieved, which is why "error is low" while the robot cuts through middles.
Sources: `apps/api/app/main.py:340-351` (TrainConfig defaults), `train_session` loss loop.

### RC2 — Physics-infeasible authored timing clips every middle step (primary "replay skips middles" under `physics=true`)

The demo robot's joints move fast enough, but a realistic URDF (velocity limit 1.0 rad/s) cannot execute 1.3–1.8 rad/s segment demands. Even the converged model misses middles under physics (MAE 0.33–0.66, 959–1440 clipped steps, max tracking error 0.71). Physics-realistic replay is *supposed* to reflect limits (CONTEXT.md), but nothing tells the user their checkpoint timing exceeds joint velocity limits — the failure is silent except for a generic `Interior checkpoints missed` warning that blames epochs ("increase epochs or check segment timing") when epochs are not the problem.
Sources: `servo_to_positions`, `build_physics_feasible_samples`, rollout delta scaling.

### RC3 — Rollout budget decimation/truncation (max_steps=160 default)

At `timeline_fps=60` a 4 s gesture needs ~240 grid steps; the default budget 160 decimates to density 1.5x (7 s gesture: 2.6x) and amplifies per-step deltas via `effective_scale` (up to 2.7x in repro 2), which pushes more steps into velocity clipping. Longer gestures additionally get their tail truncated (`if total_steps >= request.max_steps: break`). The frontend always sends `config.rollout_steps` (160) — there is no auto mode.
Sources: `compute_rollout_density`, `compute_effective_scale`, rollout loop break, `apps/web/src/domain/evaluate.ts` (`maxSteps: config.rollout_steps`).

### RC4 — Headline evaluation error is final-frame only

`testModel` reports `error = frameError(finalFrame)` — the end pose — as the evaluation error. A trajectory that cuts through middles and lands on the final pose reports a tiny error. The gesture max error appears only in a toast message; the persistent evaluation summary uses the final-frame number. This is the "error stays low" the user sees.
Sources: `apps/web/src/App.tsx` `testModel` (`setEvaluation({..., error})`).

### RC5 — Evaluation gate ignores keyframes

`testModel` gates the gesture rollout on `demonstration.frames.length > 1` while `buildRolloutArgs` prefers keyframes. A gesture whose `frames` array is stale/empty but whose `keyframes` hold the authored checkpoints silently falls back to `predictPose(target)` — an endpoint-only evaluation with a low error, and `rolloutFrames` is cleared so the viewport shows a single move to the last pose. This is a literal first→last replay.
Sources: `apps/web/src/App.tsx` `testModel`.

### Minor findings

- Degenerate condition in the `is_step` branch of `build_incremental_samples` (`current = A if progress < 1.0 else A` — both arms identical). Harmless (step-hold semantics are right) but confusing.
- Random-starts approach samples (default 4) dilute gesture samples; `random_starts=0` at 300 epochs performed *worse* (0.27–0.37) than 4 in one trial — approach samples are not the dominant factor here, convergence is.
- `start_frame_index` still silently slices leading checkpoints (unchanged from 2026-09-07 finding; guardrail exists in validation only).

## 4. Fix plan (MLP-simple, demonstration-first; none regress URDF/MLP guardrails)

**P1 — Auto-converge gesture training (fixes RC1, the direct cause).**
In `train_session`, when the batch contains multi-segment gesture demonstrations, raise the effective epoch budget (e.g., `effective_epochs = max(config.epochs, 1200)` for gestures; poses stay at the user value) and/or add plateau early-stopping so long training isn't wasted. Emit a train-end event with a cheap **kinematic checkpoint probe** (no physics): roll the model through the checkpoints kinematically and report per-checkpoint MAE + a `interior_checkpoints_missed` warning. This gives the user a real "did it learn the full gesture" signal instead of per-step loss.
Tests: 6-joint 5-checkpoint repro trained with defaults must reach kinematic checkpoint MAE < 0.12 for every checkpoint; warning path test for an intentionally under-trained config.

**P2 — Velocity-feasibility pre-check with actionable warning (fixes RC2's silence).**
Before rollout/training with physics, compute per-segment demanded joint speed `|Δpos|/segment_ms` vs the URDF velocity limit; warn: "Checkpoint 2 timing needs 1.4 rad/s on shoulder_joint (limit 1.0) — the robot cannot be there on time; slow the gesture or raise the joint velocity limit." Consider an optional `time_stretch` rollout mode that stretches segment durations to feasible times so checkpoints are actually reached (physically honest playback).
Tests: repro gesture (1.3 rad/s demand, 1.0 limit) must produce the warning naming the segment/joint.

**P3 — Auto-size the rollout budget (fixes RC3).**
Treat `max_steps <= 0` as "auto": `min(approach_steps + sum(raw_steps), 2000)`; frontend default sends auto for gestures. This removes decimation, `effective_scale` amplification, and tail truncation for authored gestures that fit the cap.
Tests: 4 s @ 60 fps gesture rolls out at density 1.0 with no decimation warning; long gesture hits the 2000 cap with a clear warning.

**P4 — Honest evaluation error (fixes RC4 + RC5).**

- Gate the gesture rollout on the keyframes-aware frame list: `buildRolloutArgs(demonstration).frames.length > 1`.
- Report the evaluation error as the **max over gesture frames** (or worst checkpoint MAE), keep the final-frame number as a secondary line, and render the per-checkpoint worst error in EvaluatePage.
Tests: unit tests for the evaluate domain + a component test asserting the summary shows the gesture-wide max, not the final frame.

**P5 — Cleanups (low risk).**

- Simplify the degenerate `is_step` branch in `build_incremental_samples`.
- Surface `Interior checkpoints missed` warnings in the TrainingPage/Training metric flow (currently only EvaluatePage shows rollout warnings; the train-end probe from P1 covers the training side).

**Deferred (only if P1 is insufficient for complex gestures):** global-progress + final-goal conditioning inputs (Task 2 of `docs/research/training-full-gesture-investigation.md`, still unimplemented). The 1500-epoch result (MAE 0.06 with plain conditioning) shows conditioning is not currently the bottleneck.

## 5. Verification loop for the fixes

- `cd apps/api && python -m pytest -q tests` (new tests per fix above)
- `cd apps/web && npm run test:unit && npm run build`
- Manual/e2e: author a 5-checkpoint gesture on a multi-joint robot in the timeline, train with defaults, evaluate — expect: train-end probe reports all checkpoints hit (kinematic), physics rollout shows a feasibility warning only if timing truly exceeds limits, evaluation headline shows gesture-wide max error, and no decimation warning at default settings.

No code changes made in this pass — research and revalidation only.
