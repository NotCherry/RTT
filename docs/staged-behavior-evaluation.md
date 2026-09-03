# Staged behavior evaluation: randomized start → first frame → gesture

Status: evaluation spec for training/demonstration goal. Demonstration-first language applies:
pose, frame, checkpoint/keyframe, gesture, demonstration, training run, evaluation, prediction.

## Staged behavior

1. **Approach phase:** from a randomized starting pose, move toward the first authored
   checkpoint/frame in timely increments.
2. **Gesture phase:** from the first frame, follow the authored keyframe/checkpoint
   sequence through intermediate states to the final frame.

No teleportation is allowed in either phase. Each incremental motion must respect
per-joint position limits and a bounded per-step displacement derived from velocity
limits and `timestep_ms`.

## Reproducible scenarios

- Use the 2-joint sample arm plus one primitive 3+ joint URDF when available.
- Seeded randomized starts: `random_seed` fixed, `random_starts >= 2` for evaluation.
- Authored gesture: at least 3 checkpoints, e.g. frames at 0 ms, 240 ms, 480 ms.
- Time budget: approach phase gets `approach_steps = ceil(max_joint_distance / max_step) + margin`;
  gesture phase uses the existing `timestep_ms` / `rollout_steps` path.
- `max_step` per joint per increment comes from the URDF `velocity` limit when present,
  otherwise from a conservative default documented in code/tests.

## Metrics

- **Approach success:** final approach position within `0.05` rad (revolute) or native
  units (prismatic) of the first checkpoint, within the time budget.
- **Safety:** every incremental `|Δjoint| <= max_step + 1e-6`; joint limits never exceeded.
  Self-collision and obstacle avoidance are NOT implemented in this iteration: safety here
  means joint-limit clamping plus velocity-bounded increments. A scripted stage-1 is preferred
  partly because a learned approach can still cut across the body; explicit collision checking
  remains future work.
- **No teleport:** no single increment covers more than `max_step`; random-start samples
  must expand approach motion over multiple increments, not one jump.
- **Trajectory following:** mean and maximum absolute error at intermediate checkpoints
  and final frame, reported separately for approach vs gesture phases.
- **Timing:** number of increments used vs budget; preview/replay advances visibly through
  intermediate frames rather than assigning only the final pose.

## Scripted vs learned initialization decision

- Keep the two-stage deployment interface: `stage-1 initialization` → `stage-2 gesture policy`.
- Default to a **simple programmed (scripted) bounded interpolation controller** for stage 1
  on low-DOF arms when it meets the approach/safety metrics: it is predictable, cheap,
  and avoids teaching a one-step teleport.
- Choose a **learned stage-1 model** only when scripted interpolation cannot satisfy safety
  (for example self-collision/hand-into-body risk on a more complex robot, obstacles, or
  non-trivial approach dynamics). That decision requires a failing scripted baseline plus a
  learned candidate that passes the same metrics.
- The gesture-following stage remains learned behavior cloning from authored checkpoints.

## Deployment composition (selected)

- **Stage 1 — initialization (scripted default):** `build_approach_plan(start, first_checkpoint, joints, timestep_ms)`
  in `apps/api/app/main.py`. Bounded linear interpolation honoring URDF velocity limits;
  use it to drive the robot from any start to the gesture's first frame before engaging
  the learned policy. It is predictable, needs no training, and cannot teleport.
- **Stage 2 — gesture following (learned):** temporal MLP trained by `build_incremental_samples`
  on authored checkpoints, executed via `POST /rollout`, which now stages
  approach frames before checkpoint following and returns per-frame `expected` values.
- **Learned stage 1 only by exception:** when scripted approach cannot satisfy safety
  (self-collision risk, obstacles, complex dynamics), train a stage-1 model on the same
  bounded approach samples and gate it behind the identical metrics above.
- **Two-model merge:** keep the interface `pose[] -> stage1 -> first_frame -> stage2(goal, progress) -> delta`;
  the two stages may be two networks or scripted+network, but callers see one deployment
  that always passes through the first frame.

## Verification evidence required

- Frontend: archived gesture preview/replay visibly traverses intermediate frames;
  evaluation viewport starts from rollout start, not pasted final pose.
- Backend: randomized-start training samples respect multi-step bounded approach;
  rollout from a randomized start reaches the first checkpoint before following keyframes.
- Tests: focused frontend playback test + backend bounded-approach/rollout test;
  existing `npm run test:unit`, `npm run build`, `python -m pytest -q tests`, `git diff --check`.
