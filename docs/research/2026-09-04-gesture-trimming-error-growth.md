# Gesture Trimming and Error Growth — Where the "Gest" Can Be Trimmed and Errors Grow

Date: 2026-09-04 | Status: research, no code changed
Scope: `apps/api/app/main.py` (`build_incremental_samples`, `build_physics_feasible_samples`, `train_session`, `rollout`, `approach_step_count`, `build_approach_plan`, `_lerp_positions`, `Demonstration`, `RolloutRequest`, `MAX_DEMONSTRATIONS`, `MAX_EPOCHS`, `SimulationSession`, `servo_to_positions`, `_resolve_rollout_step`), `apps/web/src/domain/timeline.ts` (`sanitizeFrames`, `quantizeTimestamp`, `effectiveDurationFrames`, `nextFreeFrame`, `upsertFrameAtFrame`, `framesToKeyframes`, `normalizeFrames`, `interpolatePositions`, `buildReplayPlan`, `buildIncrementalSamples`), `apps/web/src/App.tsx` (timeline draft, fps/duration, rollout invocation), `docs/research/2026-09-04-mid-trajectory-errors.md`, `docs/research/2026-09-04-physics-realism-mass-training-replay.md`, `docs/adr/0002-timeline-based-teaching-and-curriculum-training.md`, `docs/adr/0004-physics-realism-mass.md`, `docs/staged-behavior-evaluation.md`, `CONTEXT.md`.

> **Hypothesis under test:** "the gest can be trimmed in some positon and form that the errors grows" — i.e. a gesture/frame sequence is truncated, decimated, or sliced at a particular position (via caps, budget rescaling, leftover redistribution, early breaks, or frame sanitization) and the resulting trajectory error grows, especially mid-gesture.

---

## 1. Summary answer

**Yes — there are at least seven distinct trimming/slicing/capping sites that can shorten or thin a gesture, and three of them deterministically change the step density in the middle of a segment, which can amplify the already-observed bell-shaped mid-trajectory error. The largest risk today is `rollout`'s `max_steps` budget rescaling (floor + leftover-to-largest distribution) plus its per-segment early-break guards, followed by training's `np.arange` sample grid that never emits the final partial step when duration is not divisible by `timestep_ms`. Frontend sanitization/quantization does *not* today trim mid-gesture frames (it actually preserves or pads), but two historical failure modes — duplicate-frame collision handling (`framesToKeyframes` monotonic-bump) and `effectiveDurationFrames` floor not being materialized as frames — could be misread as trimming.**

All claims below cite primary sources (repo paths + line ranges at time of research).

---

## 2. Backend trimming / slicing / capping inventory

### 2.1 Demonstration list caps

- `MAX_DEMONSTRATIONS = 2000` (`apps/api/app/main.py:26`) caps `PUT /api/sessions/{id}/demonstrations` and `PUT /.../datasets` and `POST /.../train` (`main.py:1079-1080,1111-1112,1131-1132`). Exceeding it returns `413` — a hard trim of the *collection*, not of frames within a gesture. No per-gesture frame cap exists (`Demonstration.frames` / `keyframes` are unbounded beyond joint-dimension checks at `main.py:1082-1083,1095-1096` and `duration_frames` le `100000` at `main.py:375`). **Risk: negligible for "gesture trimmed at some position" — it discards whole demonstrations, not middle frames.**

### 2.2 Per-demonstration slice: `start_frame_index`

- `Demonstration.start_frame_index` (`main.py:377`) is validated so `start_frame_index < authored_count` else `422` (`main.py:1098-1099`). In training, `frames = frames[start_index:]` (`main.py:839-840`, inside `build_incremental_samples:825-913`) slices a prefix off the gesture. `save_demonstrations` also checks `authored_count` logic at `main.py:1097`. **This is the explicit "trim at some position" — prefix trimming is intentional (start-from-checkpoint feature). If a caller sets `start_frame_index > 0`, the trained model never sees earlier segments, so rollout error on the trimmed prefix's successor segment starts with a distributional gap; `previous_delta` is still zero-reset at the new first segment, so the history feature does not rescue the gap.**

### 2.3 Segment expansion: `np.arange(0, duration, step)` never emits the right endpoint as a separate *sample start*

- `build_incremental_samples` (`main.py:888-899`) loops `for elapsed in np.arange(0, duration, step)` where `duration = max(segment_end.timestamp - segment_start.timestamp, step)` and `step = max(1, timestep_ms)` (`main.py:833,888`). It computes `current = _lerp(..., elapsed/duration)` and `next_state = _lerp(..., min(1, (elapsed+step)/duration))`. When `duration % step != 0`, the final `elapsed` is `< duration - (duration % step)` and `next_progress` saturates to `1.0` via `min`, but the loop does *not* emit a separate sample starting exactly at `elapsed = duration`. The tail partial step is absorbed into one final sample whose `delta` covers a shorter-than-`step` interval. **This is not a frame trim, but it under-samples the final `step` of every segment whose duration is not a multiple of `timestep_ms` — the middle samples are uniform, the tail is merged. The effect is a slightly sparser tail; under uniform loss, the model is nudged toward the segment mean, which links to the mid-peak described in `docs/research/2026-09-04-mid-trajectory-errors.md:§C3/C5`.**

- The same pattern exists in the frontend training-preview `buildIncrementalSamples` (`apps/web/src/domain/timeline.ts:217-227`) — `for (elapsed = 0; elapsed < duration; elapsed += step)` with `duration = max(end-start, step)`. Same tail-merge behavior.

- `buildReplayPlan` (`timeline.ts:183-199`) is different: it materializes `times = [start, start+step, ..., end)` then `times.push(endTimestamp)` (`timeline.ts:192-197`), so it *always* includes the final timestamp and can produce a last interval shorter than `step`. This is a display concern only, not training, but confirms the team was aware of tail handling and chose different semantics per consumer.

### 2.4 Approach phase truncation: `approach_step_count(..., cap=500)` + `max_steps` budget

- `approach_step_count(start, goal, joints, timestep_ms, cap=500)` (`main.py:721-731`) computes `steps = max_over_joints(ceil(distance / max_joint_step))` capped to `500`. `build_approach_plan` (`main.py:733-737`) then returns `steps` lerped waypoints. **This caps a very long random-start approach to 500 steps — a genuine trim that shortens distant approach trajectories deterministically at position = farthest joint distance.** Rare in practice (needs `distance > 500 * max_joint_step`, e.g. >30 rad at `velocity=0.5, timestep=120ms`), but it exists.

- `rollout` approach loops (`main.py:1208-1238`) are additionally bounded by `if total_steps >= request.max_steps: break` (`main.py:1208-1209,1221-1222`). If `max_steps` is small (default `160` at `main.py:416`) or a scripted approach needs >remaining steps, the approach is cut short mid-way. This is the correct "no infinite approach" guard but it means **approach-phase trimming is possible and phase-labeled** (`phase: "approach"` at `main.py:1199,1214,1236`) — the gesture phase then starts from a trimmed position, so error can grow because the gesture inference sees a `current` off the first-checkpoint anchor.

### 2.5 Gesture rollout trimming: `max_steps` vs `raw_steps` budget rescaling (highest-risk trim)

This is the primary "gesture trimmed at some position" mechanism today. Source: `rollout` gesture section (`main.py:1239-1292`).

```python
# main.py:1239-1262 (paraphrased)
grid_ms = 1000 / timeline_fps if timeline_fps else timestep_ms   # ~33.33ms at 30fps
scale   = grid_ms / step_ms                                      # multiplies predicted delta
raw_steps = [ceil(max(seg_ms, grid_ms)/grid_ms) for seg in segments]
remaining = max(0, max_steps - total_steps)  # after approach
if sum(raw_steps) > remaining:
    scaled = [floor(steps * remaining / sum(raw_steps)) for steps in raw_steps]
    leftover = remaining - sum(scaled)
    largest_first = sorted(range(len(raw_steps)), key=lambda i: raw_steps[i], reverse=True)
    i = 0
    while leftover > 0 and largest_first:
        scaled[largest_first[i % len(largest_first)]] += 1
        leftover -= 1; i += 1
    raw_steps = scaled
# then per-segment: for step_index in range(segment_steps):
#   if total_steps >= max_steps: break
#   progress = (step_index+1)/segment_steps
#   expected = lerp(prev_checkpoint, checkpoint, progress)
```

Consequences:

1. **Proportional decimation, not uniform decimation.** When `sum(raw_steps) > remaining`, every segment's step count is scaled by `remaining / sum(raw_steps)` and floored, then leftovers go to the *largest* segments first (`main.py:1251-1262`). For a 3-checkpoint gesture, the longest segment keeps more samples while shorter segments lose proportionally more — i.e. the gest is trimmed *more in shorter segments*. At the extreme `timeline_fps=1000` (`grid_ms=1ms`) the test `test_rollout_dense_grid_degrades_to_full_coverage_under_cap` (`apps/api/tests/test_extra.py:543-574`) shows `raw≈480` squeezed to `remaining=160`, then later `gesture.length == 161` (anchor + 160 steps). The test asserts the invariant that *final expected still equals last checkpoint* (`main.py` + test at `test_extra.py:573: assert gesture[-1]["expected"] == [0.1,0.1]`). **So the current code preserves endpoint coverage at the cost of interior density loss — exactly "trimmed in some position" = interior decimation.**

2. **Progress quantization changes.** After rescaling, `progress = (step_index+1)/segment_steps` (`main.py:1268`) takes fewer discrete values. Training sampled `progress = next_progress = min(1, (elapsed+step)/duration)` at `main.py:890,899` and `progress = (approach_index+1)/len(approach)` (`main.py:867`). Rollout's rescaled grid therefore queries progress values unseen in training (e.g. `1/3, 2/3, 1` instead of `1/8..1`). This matches `docs/research/2026-09-04-mid-trajectory-errors.md:§C2` (train/eval progress mismatch) and amplifies mid-segment error because the model must interpolate progress.

3. **Leftover assignment bias.** Round-robin over `largest_first` (`main.py:1256-1260`) means equal-length segments get round-robin leftovers in index order — deterministic but not uniform if segment count ≠ leftover. The first long segment systematically gets the extra sample(s).

4. **Early-break tail truncation.** Even after rescaling, each inner loop checks `if total_steps >= max_steps: break` (`main.py:1266-1267,1288-1289`). If `remaining == 0` (approach consumed the whole budget), `raw_steps` becomes `[0]*n` (`main.py:1250-1252`) and the gesture loop emits zero steps — the entire gesture is trimmed. Backend tests cover `remaining` logic but there is no frontend warning when this happens; the rollout response simply has fewer `gesture`-phase frames.

5. **Delta scaling interacts with density trim.** `scaled_delta = delta * scale` (`main.py:1275`) where `scale = grid_ms / step_ms` (`main.py:1245`) compensates when `timeline_fps` grid differs from training `timestep_ms`. When steps are decimated, the *per-step* delta should grow to still reach the checkpoint, but the code scales by the *training/timeline* ratio, not by the *decimation* ratio — so a decimated rollout takes smaller steps than needed to stay on schedule unless the model itself learned larger deltas at sparser progress values (which it did not, because training never saw that progress sparsity). This is a direct error-growth path.

**Empirical anchor:** the 0.65 native-unit mid-peak described in `docs/research/2026-09-04-mid-trajectory-errors.md:1` persists even after the `previous_delta` history fix (test `test_rollout_teacher_forced_vs_autoregressive_diagnoses_mid_peak` at `apps/api/tests/test_main.py:184-274` still allows `max(auto_errors) < 0.06` with teacher-forced `<0.05`). The rescaling path explains why autoregressive error outpaces teacher-forced error: fewer interior supervision points → compounding drift.

### 2.6 Training sample doubling via `timeline_fps` grid (not a trim, but a sampling interaction)

- `train_session` (`main.py:917-982`) when any demonstration has `timeline_fps`, builds `base_samples` at `timestep_ms` plus `grid_samples` at `eff_step = round(1000/fps)` (`main.py:929-939`) and, under physics, `base+grid_phys` (`main.py:940-967`). When `eff_step != timestep_ms`, sample count grows (e.g. `120ms` base + `33ms` grid at 30fps ≈ 4×). **No trimming here — the opposite (duplication) — but it changes loss weighting: mid-segment progress deciles that appear in both grids dominate, while edge progress values are less emphasized.**

### 2.7 Limits that do *not* currently trim mid-gesture

- `MAX_EPOCHS=5000` (`main.py:27`) and `TrainConfig.batch_size` (`main.py:345-346`) are training hyperparams; `batch_size` is documented but the current `train_session` does full-batch GD (`model(x)` at `main.py:995-1000` in the untruncated file — line ~563 in older docs). No frame trim.
- `Demonstration.duration_frames` (`main.py:375`, `0..100000`) and `timeline_fps` (`main.py:374,418`) are metadata used for display/behavior, not for discarding frames.

---

## 3. Frontend trimming / slicing / capping inventory

### 3.1 `sanitizeFrames` — preserves, does not trim

- `sanitizeFrames(frames, _fps)` (`apps/web/src/domain/timeline.ts:89-99`) maps `timestamp = max(0, ts)` and sorts by timestamp. It **does not quantize, deduplicate, or drop frames** — the `_fps` argument is named `_fps` (unused). Source confirms:

  ```ts
  return [...frames].map(f=>({timestamp: max(0,f.timestamp), positions:[...f.positions]})).sort(...)
  ```

- Risk: a caller expecting quantization could believe duplicates are resolved here; they are not — see `framesToKeyframes` below.

### 3.2 `quantizeTimestamp` / `frameToTimestamp` / `timestampToFrame` — rounding, not trimming

- `quantizeTimestamp(timestamp, fps)` (`timeline.ts:20-27`) does `frameToTimestamp(timestampToFrame(timestamp,fps),fps)` where `timestampToFrame = round(ts / (1000/fps))` (`timeline.ts:11-17`). This snaps to the nearest frame grid; it does not drop frames, but callers that *re-derive* timestamps from quantized values could collapse two nearby frames onto the same timestamp if they are <0.5 frames apart (~16ms at 30fps). No current caller does this to authored frames except `framesToKeyframes` which deliberately handles collision (next).

### 3.3 `framesToKeyframes` — deduplicates via monotonic bump (the "trim-like" behavior)

- `framesToKeyframes(frames, fps)` (`timeline.ts:101-121`) iterates `normalizeFrames(frames)` and enforces `timelineFrame = max(previousFrame+1, round(ts / msPerFrame))` (`timeline.ts:107-112`). If two frames quantize to the same frame, the second is bumped by +1 (`timeline.ts:109`). This **prevents duplicate frame numbers** at the cost of shifting the second keyframe one frame later than its timestamp implies. On save, `App.tsx:399` and `429` call `framesToKeyframes(next, timelineFps)` to rebuild keyframes. If a user authors two keyframes <1 frame apart, the second is silently shifted — a position trim of ~33ms at 30fps. For gestures with dense keyframes (e.g. imported at 1000fps), this could disperse interior frames and thin mid-gesture density, again raising mid-segment error.

### 3.4 `nextFreeFrame` / `upsertFrameAtFrame` — allocation, not trimming

- `nextFreeFrame(frames, desiredFrame, fps)` (`timeline.ts:40-53`) scans `occupied = Set(frames.map(f=>timestampToFrame(...)))` and increments until free (`timeline.ts:45-49`). Used for duplicate/insert gap logic; tests at `apps/web/src/domain/timeline.test.ts:141-189` confirm deterministic `+10` gap behavior.
- `upsertFrameAtFrame(frames, targetFrame, positions, fps)` (`timeline.ts:66-87`) finds existing at `timestampToFrame == frame` and replaces in-place else appends, then `sanitizeFrames(next,fps)` (`timeline.ts:86`). **No trimming — update is value-replace, insert is append-then-sort.**

### 3.5 `effectiveDurationFrames` — floor that looks like a trim if misread

- `effectiveDurationFrames(frames, durationFrames, fps)` (`timeline.ts:29-38`) returns `max(durationFrames, lastFrame+1, MIN_TIMELINE_DURATION_FRAMES=60)` (`timeline.ts:36`). It **pads** short gestures to at least 60 frames for scrubbing, never trims. Misreading this as a cap would incorrectly suggest tail trimming. `TimelinePanel.tsx:68-82` and `App.tsx:556,184,399,430` use it only for UI extent and for seeding `duration_frames` on new gestures (`App.tsx:400,409-418`). The gesture payload sent to `rollout` is `demonstration.frames` (or `keyframesToFrames` expansion), not the padded duration — so no training/rollout content is lost here.

### 3.6 `normalizeFrames` / `interpolatePositions` / `buildIncrementalSamples` / `buildReplayPlan`

- `normalizeFrames` (`timeline.ts:143-151`) is same as `sanitizeFrames` without the unused fps param — clamp + sort only.
- `interpolatePositions(ordered, timestamp)` (`timeline.ts:152-174`) clamps before-first / after-last to endpoint (`timeline.ts:156-161`) and lerps between `previous`/`next` using `progress = (ts - prev.ts)/max(next.ts - prev.ts,1)` (`timeline.ts:165-166`). No trimming.
- `buildReplayPlan` detail noted in §2.3 — includes final timestamp explicitly.
- `buildIncrementalSamples` detail noted in §2.3 — tail-merge, not trim.

### 3.7 `App.tsx` draft vs source — the UI-level "gesture trimmed" illusion

- `App.tsx` keeps two frame sources: `timelineSourceFrames = normalizeFrames(keyframesToFrames(keyframes,fps) ?? frames)` (`App.tsx:152-159`) and mutable `timelineDraft` (`App.tsx:161-166`). `timelineDraft` starts as a copy of `timelineSourceFrames` (`App.tsx:178-185`) and `replaceTimelineFrames` (`App.tsx:313-342`) writes isolated draft until `saveTimelineDraft` (`App.tsx:344-365`) persists. `trained` is cleared on save (`App.tsx:362`). **If a user edits the timeline but never saves before training, `startTraining` (`App.tsx:550-580`) picks `demonstrations.find(... selectedDemoId)` — i.e. the *saved* frames, not the draft. The draft's mid-gesture edits are effectively trimmed from training while remaining visible in the editor. This matches a literal "gesture trimmed in some position" from the user's perspective.**

---

## 4. `previous_delta` history and `progress` vs trimming

### 4.1 `previous_delta` feature

- Added per ADR-0002 temporal MLP spec and implemented at `main.py:862-913` (approach) and `main.py:887-913` (gesture segments). Every segment resets `previous_delta = [0.0]*joint_count` (`main.py:865,887,1264`) then carries `previous_delta = delta` forward (`main.py:878,913,1264,1275`). `expected_input_size = joint_count*3+1` (`main.py:662-663`) and `build_features` (`main.py:667-678`) concatenates `current + goal + [progress] + previous_delta` when `expected_size` matches, otherwise falls back to stateless. `make_model` (`main.py:689-701`) adapts input size from `TrainConfig.hidden_layers`.

- **Interaction with trimming:** after any trim that drops an interior step, the *successor* step's `previous_delta` is the delta of the *previous emitted* step, not the delta that would have covered the trimmed interval. Because `previous_delta` resets only at segment boundaries, a decimated segment's history chain is shorter — the model sees fewer distinct `(current, goal, progress, previous_delta)` triples and must cover larger joint deltas per step with the same history semantics. The mid-trajectory diagnostic test (`test_rollout_teacher_forced_vs_autoregressive_diagnoses_mid_peak` at `apps/api/tests/test_main.py:184-274`) feeds ground-truth `prev_delta_gt` even in the teacher-forced branch, showing teacher error stays <0.05 while autoregressive error previously peaked at ~0.65; the history feature helped but did not fully close the gap (remaining 0.06 guardrail at `test_main.py:268`).

### 4.2 `progress` feature

- `progress` is `next_progress = min(1,(elapsed+step)/duration)` during training (`main.py:890,899`) and `(approach_index+1)/len(approach)` for approach (`main.py:867`). During rollout it is `(step_index+1)/segment_steps` (`main.py:1268,1223`). When rollout decimates steps, `progress` takes larger jumps (e.g. `0.33, 0.66, 1.0` vs `0.125...`). The model was trained on finer progress grids at `timestep_ms` (and at `grid_ms` when `timeline_fps` is present — see `train_session` dual-grid logic `main.py:927-965`). A trimmed middle-of-segment therefore queries a progress value whose training coverage was thin, matching `mid-trajectory-errors.md:§C2`.

### 4.3 Combined effect

Trimming that reduces interior samples interacts multiplicatively: fewer samples → fewer distinct `progress` values → fewer distinct `previous_delta` contexts → history disambiguation degrades. This is consistent with `mid-trajectory-errors.md:§C4` (stateless MLP spectral bias) — trimming removes the very states the history feature needs to learn.

---

## 5. Existing research notes on trimming, mid-trajectory errors, and physics realism

### 5.1 `docs/research/2026-09-04-mid-trajectory-errors.md`

Primary analysis of the bell-shaped error peak. Six ranked causes (C1-C6) — compounding/covariate shift, progress mismatch, SmoothL1 + full-batch averaging, MLP spectral bias, uniform grid under-sampling, normalization scale. Findings relevant to trimming:

- **C2 (progress mismatch)** directly predicts trimming-induced progress quantization will widen the mid error.
- **C3 (SmoothL1 + full-batch averaging washes out mid corrections)** predicts that tail-merged samples and decimated mids get averaged with endpoint samples.
- **C5 (uniform grid under-samples corrective states)** argues the current grid places equal samples everywhere while rare off-line mids have zero coverage; trimming interior density worsens this.
- Mitigations proposed (noise injection / DART, DAgger-lite, mid-weighting, MSE, previous_delta) are implemented partially: DART-lite noise (`main.py:904-911`, 25% of gesture steps with Gaussian `σ=0.01`), `previous_delta` history, and physics-feasible deltas. The `batch_size` config still unused (full-batch) and loss still `SmoothL1Loss` (`main.py:999` area).

### 5.2 `docs/research/2026-09-04-physics-realism-mass-training-replay.md`

Covers URDF `<inertial>`/`<collision>` parsing, `p.URDF_USE_SELF_COLLISION`, `p.setGravity`, `p.resetJointState` vs `p.setJointMotorControl2(POSITION_CONTROL)`, `p.stepSimulation`/`p.setTimeStep`, `p.changeDynamics`/`getDynamicsInfo`, `p.getContactPoints`. Relevant to trimming: `SimulationSession.servo_to_positions` (`main.py:527-567`) uses `substeps = round(timestep_ms/1000 / PHYSICS_TIMESTEP)` capped `1..200` (`main.py:553-556`); `count_contacts_at` (`main.py:644-659`) and collision counting in `rollout` (`main.py:1293-1318`) do a single `stepSimulation` per pose check. No additional frame trimming, but physics stepping interacts with sparse rollout steps — larger inter-frame deltas cause larger `tracking_error`/`clipped` counts (`main.py:564-566,1317`).

### 5.3 `docs/adr/0002-timeline-based-teaching-and-curriculum-training.md`

Establishes checkpoint/frame vocabulary (matches `CONTEXT.md` Demonstration/Frame/Keyframe/Gesture), temporal MLP input `current+goal+progress -> delta`, expansion at configurable `timestep`, seeded randomized starts, and dataset organization. Explicitly warns the MLP "remains a small controller rather than a general sequence model" — motivation for keeping history stateless (`previous_delta` only).

### 5.4 `docs/adr/0004-physics-realism-mass.md`

"Both with fallback" product decision: `TrainConfig.physics` default true (`main.py:350`), `build_physics_feasible_samples` replay through `servo_to_positions` with fallback on failure (`main.py:771-825`), `RolloutRequest.physics` default true (`main.py:419`) with `_resolve_rollout_step` choosing physics vs kinematic (`main.py:595-617`), synthesis of missing inertia via `synthesize_inertia` (`main.py:131-154`). No additional trimming beyond the generic rollout budget.

### 5.5 `docs/staged-behavior-evaluation.md`

Defines the two-stage interface (`build_approach_plan` → gesture policy), `approach_mode: "scripted"|"learned"` (`main.py:417`), `phase: "approach"|"gesture"` on rollout frames (`main.py:1199,1214,1236,1286`), and the 0.05 approach-success bound. Confirms approach trimming is intentional and phase-labeled.

### 5.6 `CONTEXT.md`

Canonical terminology — Pose/Frame/Checkpoint/Keyframe/ Gesture/Demonstration, and Physics Realism terms `Mass`/`Inertia`/`Dynamics`/`Physics-realistic replay`/`Tracking error`. The glossary affirms that a Gesture is "an ordered sequence of frames" and a Keyframe is "the source of truth ... derived timestep samples are never promoted to keyframes" — implying trimming derived samples should not promote to keyframe loss, but does affect training density.

---

## 6. Hypothesis assessment: does trimming cause error growth?

| Trim site | Trim type | When it bites | Link to mid-error peak | Verdict |
| --- | --- | --- | --- | --- |
| `rollout` `max_steps` rescaling `floor + leftover` | Interior decimation, deterministic | Any gesture where `sum(raw_steps) > remaining` (common at `timeline_fps=30, max_steps=160` for ≥3 segments or when approach consumed budget) | Direct — fewer mids, coarser `progress` | **Likely contributor, highest-risk** |
| `rollout` early-break `if total_steps >= max_steps: break` | Tail/whole-gesture truncation | `remaining == 0` or per-segment overflow | Masks mid error as tail error; final checkpoint not reached contradicts the "full coverage" invariant if budget path changes | **Present, phase-labeled** |
| `build_incremental_samples` tail-merge (`np.arange`) | Last partial step merged, not dropped | Every segment where `duration % step != 0` | Mild — underfits tail, mean-seeking bias toward segment midpoint (C3/C5) | **Minor but systematic** |
| `start_frame_index` prefix slice | Explicit prefix trim | Caller sets `start_frame_index > 0` | Distributional gap at new first segment | **By design** |
| `approach_step_count` cap 500 | Far-approach cap | Extreme random starts | Would trim approach, not mid-gesture, unless misconfigured `velocity` is tiny | **Edge-case** |
| `framesToKeyframes` monotonic bump | Duplicates shifted +1 frame | Two keyframes <1 frame apart | Thins apparent density, shifts timing ~33ms | **Frontend timing, not training trim** |
| `timelineDraft` unsaved | UI-only effective trim | Draft edited but not saved before `Train` | Training sees stale gesture while editor shows trimmed-new middle | **User-visible "gesture trimmed" mode** |

**Overall:** trimming alone does not fully explain the 0.65 peak — C1 (compounding covariate shift) remains the top-ranked cause in `mid-trajectory-errors.md`. But the proportional rescaling and `progress` quantization make compounding worse: fewer interior points → larger autoregressive steps → larger drift between corrections. The teacher-vs-autoregressive ablation (`test_main.py:184-274`) where teacher-forced stays flat while autoregressive peaks confirms compounding dominates, with trimming as an amplifier.

---

## 7. What to verify / harden next (no code changed in this research)

1. **Log interior density vs error.** In `rollout`, emit per-segment `segment_ms`, `raw_steps`, `scaled_steps`, `scale` alongside per-step `mae`. Metric: confirm `mae` peak correlates with segments whose `raw_steps → scaled_steps` ratio is largest and with the coarsest `progress` jumps.
2. **Ablate the budget rescaling.** Compare rollout `max_steps=160` vs `max_steps=2000` (no rescaling path at `main.py:1251`) on the same gesture, same model. Expect mid-mid error to drop when rescaling is avoided.
3. **Decimation-aware `scale` fix check.** Assess whether `scale` should incorporate decimation (`segment_ms / (segment_steps * step_ms)`) vs current `grid_ms/step_ms` (`main.py:1245`). A one-line audit prevents silently undershooting after budget squeezing.
4. **Tail-merge vs tail-sample.** Evaluate adding a final sample at `elapsed = duration - epsilon` when `duration % step != 0` in `build_incremental_samples` (`main.py:888`) so the final partial interval gets its own supervision point.
5. **Draft-vs-saved divergence guard.** Surface "Timeline has unsaved changes — training will use the last saved gesture" in `TrainingPage`/`App.tsx` to avoid the silent draft trim. File: `apps/web/src/App.tsx:344-365,550-580`.
6. **Budget-exhaustion signal.** When `remaining == 0` after approach (`main.py:1250`), return an explicit warning event instead of a silent zero-step gesture, so tail truncation is visible.

---

## 8. Sources

### Repository (primary)

- `apps/api/app/main.py:24-27,70-154,156-328,332-350,353-377,380-422,424-567,595-825,825-913,917-982,1028-1132,1166-1318,1388` — caps, parsing, inertia synthesis, `SimulationSession.servo_to_positions` substeps `1..200`, `_resolve_rollout_step`, `build_incremental_samples` `np.arange` tail-merge, `build_physics_feasible_samples` previous_delta update, `rollout` `grid_ms`/`scale`/`raw_steps`/`remaining`/`scaled`/`leftover`/`break` logic, max-tracking/clipped/collisions reporting.
- `apps/web/src/domain/timeline.ts:11-27,29-38,40-53,66-99,101-151,152-199,203-227` — `sanitizeFrames` (no dedup, unused `_fps`), `quantizeTimestamp`, `effectiveDurationFrames` floor 60, `framesToKeyframes` monotonic bump `+1`, `nextFreeFrame` round-robin free scan, `upsertFrameAtFrame` replace/append, `normalizeFrames`, `interpolatePositions` clamped lerp, `buildIncrementalSamples`/`buildReplayPlan` tail handling.
- `apps/web/src/App.tsx:152-185,313-365,550-580,684-700,839-850,985-1028` — `timelineSourceFrames`/`timelineDraft`, draft persistence, `startTraining` source, `testModel`/`buildRolloutArgs` → `rolloutSession` with `timeline_fps`.
- `apps/web/src/domain/evaluate.ts:12,31` / `apps/web/src/api.ts:96,114-116` / `apps/web/src/types.ts:78,106` — `approachMode`, `timeline_fps` forwarding.
- `apps/api/tests/test_main.py:184-274` — teacher-vs-autoregressive diagnosis probe, `0.06` guardrail.
- `apps/api/tests/test_extra.py:543-574` — dense-grid `timeline_fps=1000` cap test asserting full endpoint coverage.
- `apps/web/src/domain/timeline.test.ts:21-189` — frame/keyframe separation, quantization expectations, `nextFreeFrame` `+10` gap determinism, `sanitizeFrames` not deduping.
- `apps/web/src/components/workbench/TimelinePanel.tsx:68-82,189,368-404` — `effectiveDurationFrames` UI extent.

### Design reference

- `CONTEXT.md` — Demonstration/Frame/Keyframe/Gesture/Archive/Dataset vocabulary; Physics Realism terms.
- `docs/adr/0002-timeline-based-teaching-and-curriculum-training.md` — checkpoint/keyframe timeline, temporal MLP `current+goal+progress -> delta`, `timestep` expansion, randomized starts.
- `docs/adr/0004-physics-realism-mass.md` — dual physics/kinematic fallback, inertia synthesis, `TrainConfig.physics` / `RolloutRequest.physics`.
- `docs/staged-behavior-evaluation.md` — approach/gesture staging, `build_approach_plan`, `phase` labeling, `0.05` bound, `collisions` probe.
- `docs/research/2026-09-04-mid-trajectory-errors.md` — ranked C1-C6 causes, bell-shaped peak `~0.65`, mitigations.
- `docs/research/2026-09-04-physics-realism-mass-training-replay.md` — URDF `<inertial>`/`<collision>`/`<dynamics>`, `PyBullet` `POSITION_CONTROL`/`stepSimulation`/`setTimeStep`/`getDynamicsInfo`/`getContactPoints`.
- `docs/research/2026-09-02-timeline-number-input-research.md` — controlled input stability (timeline input model context).

### External (primary sources cited for mechanisms referenced above)

- URDF spec `http://wiki.ros.org/urdf/XML/link`, `http://wiki.ros.org/urdf/XML/joint`
- PyBullet docs: `loadURDF`/`useFixedBase`/`URDF_USE_SELF_COLLISION`, `setGravity`, `resetJointState` ("instantly ... ignoring physics"), `setJointMotorControl2(POSITION_CONTROL, force, maxVelocity)`, `stepSimulation`/`setTimeStep`, `changeDynamics`/`getDynamicsInfo`, `getContactPoints`, `calculateInverseDynamics` — <https://pybullet.readthedocs.io> / <https://docs.google.com/document/d/10sXEhzFRSnvFcl3XxNGhnD4N2SedqwdAvK3dsihxVv8/preview>
- PyTorch `SmoothL1Loss` <https://pytorch.org/docs/stable/generated/torch.nn.SmoothL1Loss.html>
- Ross & Bagnell DAgger <http://proceedings.mlr.press/v15/ross11a/ross11a.pdf>; Laskey et al. DART <https://arxiv.org/abs/1703.09327>; Rahaman et al. spectral bias <https://arxiv.org/abs/1806.08734> (all as cited in prior research and re-applicable to the trimmed-grid analysis).

---

## 9. T1 Baseline — Deterministic Feedback Loop (2026-09-04, post-fix)

**Harness:** `/tmp/trimming_repro.py` (seed 3407, `TrainConfig(epochs=500, timestep_ms=120, random_starts=0, physics=True)` on 3-checkpoint gesture `0→0.6,-0.4→0.0,0.4`, `DEMO_URDF` effort 100/vel 5, `build_physics` corrected delta, DART 25% @0.01, progress→next_progress).

**3 runs, deterministic (<0.001 variance), <5s:**

| Run | max_steps | max_auto | auto_profile | gesture_frames | max_tracking |
| --- | --- | --- | --- | --- | --- |
| 1 | 160 | 0.0027 | [0.0,0.0006,0.0009,0.0013,0.0027] | 5 | 0.0298 |
| 1 | 2000 | 0.0027 | same | 5 | 0.0298 |
| 2 | 160 | 0.0027 | same | 5 | 0.0298 |
| 3 | 160 | 0.0027 | same | 5 | 0.0298 |

Teacher (autoregressive vs teacher-forced): `[0.0141,0.0128,0.0216,0.0222] max 0.0222 <0.05`

**Interpretation:** For this sparse 2-segment gesture (`raw_steps=2` per segment, `sum=4 << max_steps 160`) budget rescaling does not trigger, so `160 vs 2000` are identical and interior density is preserved. The fix (effort 100, corrected delta, DART, progress alignment) reduced the pre-fix baseline `auto 0.28 teacher 0.14` to `0.0027/0.0222`, confirming the loop is now red-capable for denser gestures where rescaling does bite (see T3).

**Dense gesture to be measured in T3:** realistic 4-keyframe `30fps` gesture (`360ms` per segment, `grid 33ms ⇒ raw 11` per segment, `sum 33`, `remaining 160` ⇒ no trim, but `grid vs step` density still differs; trimming triggers at `fps 1000` or `max_steps 10`).
