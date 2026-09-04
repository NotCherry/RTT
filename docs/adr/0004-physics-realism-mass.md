# ADR 0004: Physics Realism with Mass for Training and Replay

- Status: Accepted
- Date: 2026-09-04
- Scope: URDF parsing, simulation session physics, training sampling, rollout replay, evaluation UX

## Context

The training and replay loops were kinematic teleports (`p.resetJointState` in `apps/api/app/main.py` `SimulationSession._apply_positions`). URDF `<inertial>`, `<collision>`, and `<dynamics>` were discarded, the demo URDF had zero mass, and the model predicted normalized joint deltas that were applied directly without respecting mass, gravity, effort, velocity, or contacts. The product request is "phisic in the training step and in the replay of finished model ... the model needs mass now" — both loops must be realistic, staged, with a deep physics seam and configurable gravity/fixed base.

Key constraints: preserve MLP-simple and demonstration-first guardrails (`AGENTS.md`, `CONTEXT.md`, ADR-0002), keep old archived robots (`apps/api/data/*/robot.urdf`) loadable, surface physics failures inline rather than blocking, and keep a fast kinematic fallback for training.

## Decision

- **URDF domain terms** (`CONTEXT.md` Physics Realism): `Mass`, `Inertia`, `Dynamics`, `Physics-realistic replay`, `Tracking error`. `parse_urdf` now parses `<inertial><mass>` + `<inertia ixx/iyy/izz/...>` + `<origin>`, `<collision>` geometry with fallback to `<visual>` when `<collision>` is missing, and `<joint><limit effort velocity>` + `<dynamics damping friction>`. Missing `<inertial>` synthesizes `mass=1.0 kg` and inertia via `calculateLocalInertia` formulas for box/cylinder/sphere; negative or non-finite mass/inertia is rejected with 422. Synthesized links emit a session warning event.

- **Robot physics config**: `Robot` gains `gravity`, `use_fixed_base`, `physics_timestep` (240 Hz). `SimulationSession` gains `gravity`, `use_fixed_base`, `PHYSICS_TIMESTEP`, `setGravity`, `servo_to_positions` (POSITION_CONTROL with `force=effort`, `maxVelocity=velocity`, auto substeps `substeps = timestep_ms/1000 / PHYSICS_TIMESTEP` capped 1–200), and `set_gravity`. Session creation (`POST /api/sessions`) and rollout (`POST /api/sessions/{id}/rollout`) accept optional `gravity` overrides.

- **Training — both with fallback**: `TrainConfig.physics` (default true). When true and a PyBullet body exists, `build_physics_feasible_samples` replays each kinematic sample through `servo_to_positions` and replaces the delta with the achieved physics-feasible delta; on failure it warns and falls back to kinematic. When false, training stays kinematic and fast. Choice matches "Both from start, with fallback" product decision.

- **Replay — physics-stepped with metrics**: `RolloutRequest.physics` (default true). When true, approach (scripted and learned) and gesture steps execute via `servo_to_positions` with auto substeps; otherwise they assign kinematically as before. Each frame carries `tracking_error` and `clipped`; the response carries `max_tracking_error`, `clipped_steps`, `collisions` (now counted on achieved positions via `count_contacts_at`), and `physics`. The rollout restores saved gravity and positions in a `finally` block and scales model deltas by `grid_ms/step_ms` as before.

- **Deep seam**: Physics behavior concentrates in `SimulationSession.servo_to_positions` and helpers (`synthesize_inertia`, `build_physics_feasible_samples`); callers cross one small interface (`servo_to_positions(target, timestep_ms) -> {achieved, tracking_error, clipped}`), giving depth and locality per `codebase-design` skill.

- **Frontend**: `TrainingPage` exposes a physics checkbox, `EvaluatePage` shows max tracking error / clipped steps per frame, `api.ts` `rolloutSession` forwards `physics`, `App.tsx` forwards `config.physics` and surfaces the rollout message with physics label, tracking error and clipped steps.

## Consequences

- Robots with proper `<inertial>` now exhibit gravity, effort/velocity clipping, and contact response; old robots synthesize plausible mass and warn without blocking archival access.
- Rolled-out gestures report realism diagnostics (tracking error, clipped steps, collisions) inline on the evaluation page, satisfying "all effects staged" without blocking errors.
- Training and replay are both physics-aware by default but can be toggled off for iteration speed; physics training is ~10–30x slower due to per-sample sim steps and is mitigated by the fallback.
- Gravity and fixed-base are configurable per session and per rollout, enabling tabletop (`useFixedBase=True`) and future mobile-base experiments without proliferating robot variants.

## Alternatives Considered

- Strict rejection of URDFs without `<inertial>` — would have invalidated ~60 archived robots.
- Torque or velocity action spaces with inverse dynamics — most realistic for mass but breaks MLP-simple and needs new labeled demonstrations; deferred.
- Shallow inline physics in `main.py` rollout/training duplicates — rejected for lack of depth and test locality.

## References

- URDF spec: <http://wiki.ros.org/urdf/XML/link> , <http://wiki.ros.org/urdf/XML/joint>
- PyBullet: `resetJointState`, `setJointMotorControl2(POSITION_CONTROL)`, `stepSimulation`, `setGravity`, `loadURDF(useFixedBase, URDF_USE_SELF_COLLISION)`, `changeDynamics/getDynamicsInfo` (<https://pybullet.readthedocs.io>)
- Repo: `apps/api/app/main.py` (`parse_urdf`, `SimulationSession`, `build_incremental_samples`, `rollout`), `docs/research/2026-09-04-physics-realism-mass-training-replay.md`, `CONTEXT.md`
