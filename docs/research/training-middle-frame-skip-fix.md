# Middle-frame skip — split-second drift with low error: research & fix

**Date:** 2026-09-08  
**Question:** User reports: "middle frame position is still skip report for split second go into direction then fall straining into the end and error stays low". Why does the gesture briefly move toward the middle checkpoint then drift to the end while training loss / reported error stays low, and how to fix without leaving MLP-simple guardrails?

Primary sources only — file:line citations.

## Summary

Root causes were three-fold, all in `apps/api/app/main.py`:

1. **Momentum loss at segment boundaries** — `previous_delta` zeroed at each segment start (`build_incremental_samples:1011`, rollout: `previous_delta = [0.0]*` per segment) erased history through interior waypoints. Model saw identical `(current, goal, progress=0, prev=0)` at every segment start, so it could only learn an average rather than a continuous path. Symptom: brief nudge toward middle then fall.

2. **Time-unaligned hit test hid drift** — rollout `missed` check used `best = min over all gesture frames distance to checkpoint` (`main.py:1765-1790` old). A single-frame hit (split-second) made `best <0.12` even when the trajectory drifted at the checkpoint's scheduled time, so `error stays low` and no warning surfaced.

3. **Step interpolation mismatch** — frontend `interpolatePositions` respects `interpolation="step"` (timeline.ts:212-214) but backend `authored_frames` and `build_incremental_samples` ignored it and always lerped (`main.py:886-889` old). Training and rollout interpolated differently from preview, hiding shape collapse for step-held gestures.

Fix (MLP-simple, no recurrence, preserves primitive URDF gate):

- **Carry `previous_delta` across segments** — `build_incremental_samples` now keeps `carry_delta` across `route` segments (`main.py:1072-1085`) and rollout keeps `rollout_prev_delta` across gesture segments (`main.py:1748+`). Only gesture start resets to zero.

- **Time-aligned missed-checkpoint warning** — instead of `min`, map each checkpoint to its segment-end gesture frame (`raw_steps` scaled steps) and compare achieved vs expected at that exact scheduled frame (`main.py:1820-1865`). Details `1:0.128` now surfaces even when `min` would have hidden it.

- **Preserve step interpolation end-to-end** — `DemonstrationFrame.interpolation` added (`main.py:354-357`), `authored_frames` forwards `Keyframe.interpolation` (`main.py:889`), `_interpolate_frame_positions` holds previous on `step` (`main.py:872`), training branching handles `is_step` holds (`main.py:1079`), rollout holds `expected` on `step` (`main.py:1772-1777`), frontend `types.ts` adds `interpolation?` and `evaluate.ts` sends keyframe-derived frames with interpolation (`evaluate.ts:14-27`).

Result verified against primary tests.

## Primary sources traced

- `CONTEXT.md:8-22` Frame/Checkpoint/Keyframe/Gesture definitions — source of truth, derived samples never promoted.
- `apps/api/app/main.py:354-357` DemonstrationFrame — now includes `interpolation`.
- `apps/api/app/main.py:862-890` authored_frames &_interpolate_frame_positions — step handling.
- `apps/api/app/main.py:949-1050` build_incremental_samples — per-segment loop `range(len(route)-1)` (all segments, not just endpoints); previous_delta carry fix at `carry_delta`.
- `apps/api/app/main.py:747-844` RolloutBudget/density/effective_scale — decimation path that can sparsify interior waypoints, now capped 3.0 and reported via segment_diagnostics.
- `apps/api/app/main.py:1748-1780` rollout gesture loop — previous_delta carry + step expected.
- `apps/api/app/main.py:1815-1865` missed check — time-aligned vs old min.
- `apps/web/src/domain/timeline.ts:212-214` interpolatePositions step hold — frontend reference for backend parity.
- `apps/web/src/types.ts:13-16` DemonstrationFrame — frontend now optional interpolation.
- `apps/web/src/domain/evaluate.ts:8-27` framesWithInterpolation — mirrors backend authored_frames preference.
- `apps/api/tests/test_main.py:152-244` teacher-forced probe — before fix max auto 0.05, after fix 0.004 (this doc's repro).

## Verification

- Repro `tmp/repro_middle_skip.py` — 3-checkpoint `[0,0]->[0.6,-0.4]->[0,0.4]` at 500 epochs physics: max MAE 0.05 → 0.014 after fix; good vs poor model split verified with new warning `Interior checkpoints missed: [1] 0.128`.
- `apps/api: python -m pytest -q tests` — 46 passed.
- `apps/web: npm run test:unit` — 11 files, 54 tests passed.
- `apps/web: npm run build` — tsc + vite ok.
- Specific: `test_rollout_teacher_forced_vs_autoregressive_diagnoses_mid_peak` — auto profile  [0.0,0.001,0.001,0.002,0.004] teacher 0.014, guardrail <0.06 holds with margin.

## Risks / guardrails preserved

- MLP-simple: only feature carry and interpolation branching, no recurrent layers (`AGENTS.md:36`, `docs/adr/*`).
- Primitive URDF gate retained (`parse_geometry` mesh rejection).
- `expected_input_size` unchanged (`joint_count*3+1`), so old `model.pt` still loads via `build_features` backward compat.
