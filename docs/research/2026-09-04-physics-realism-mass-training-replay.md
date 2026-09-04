# Physics Realism: Mass, Training, and Replay

Date: 2026-09-04 | Status: research, no code changed
Scope: `apps/api/app/main.py` (`SimulationSession`, `_apply_positions` via `resetJointState`, `p.stepSimulation`, `count_contacts_at`, `build_incremental_samples`, `train_session`, `rollout`), `apps/api/app/main.py` `parse_urdf`, PyBullet, URDF spec (wiki.ros.org/urdf), PyTorch docs, Three.js rendering in `apps/web`.

## 1. Question

User: "the model needs mass now — training and replay need to be realistic." Investigate how URDF mass/inertia/collision, PyBullet dynamics, and the current kinematic training/rollout would need to change to make training and replay physics-realistic.

## 2. How URDF mass/inertia/collision are defined (primary source)

URDF `<link>` may contain `<inertial>`, `<collision>`, `<visual>` children. Per the URDF spec (wiki.ros.org/urdf/XML/link):

- `<inertial>`:
  - `<mass value="..."/>` — link mass in kg.
  - `<inertia ixx, ixy, ixz, iyy, iyz, izz/>` — 3x3 rotational inertia matrix (kg·m²), symmetric. Spec requires `ixx,iyy,izz` positive; off-diagonals may be zero for axis-aligned primitives.
  - `<origin xyz rpy/>` — pose of inertial frame relative to link frame; `<inertial><origin>` is the center-of-mass offset.
  - Spec URL: http://wiki.ros.org/urdf/XML/link

- `<collision>` and `<visual>` each contain `<geometry>` (`box`, `cylinder`, `sphere`, `mesh`) plus `<origin>`. Collision geometry is what the physics engine uses; visual is rendering only. Same spec page.

- Joint `<limit effort velocity>` and `<dynamics damping friction>` are part of `<joint>` (wiki.ros.org/urdf/XML/joint): `effort` = max force/torque (N or Nm), `velocity` = max velocity (m/s or rad/s), `damping`, `friction`. Spec: http://wiki.ros.org/urdf/XML/joint

- Defaults if missing (spec + PyBullet behavior):
  - If `<inertial>` is absent, URDF parsers and Bullet treat mass as 0 for that link (floating/kinematic). In PyBullet, links with zero mass are effectively static/kinematic within the multibody — they do not respond to gravity/torques. Source: Bullet docs / PyBullet `loadURDF` behavior noted at https://pybullet.org/Bullet/phpBB3/viewtopic.php?t=12592 and https://docs.google.com/document/d/10sXEhzFRSnvFcl3XxNGhnD4N2SedqwdAvK3dsihxVv8/preview — "if no inertial element mass defaults to 0".
  - If `<inertia>` missing but `<mass>` present, many importers synthesize inertia (or use identity scaled); Bullet's `btCompoundShape` will compute local inertia via `calculateLocalInertia` if inertia not supplied. PyBullet's URDF loader does this when `inertial` is incomplete. Source: pybullet `UrdfParser` — https://github.com/bulletphysics/bullet3/blob/master/examples/SharedMemory/UrdfParser.cpp and docs at https://pybullet.org/Bullet/phpBB3/viewtopic.php?f=18&t=12776
  - If `<collision>` absent, no collision shape → no contacts, even if `<visual>` exists. Current repo `parse_urdf` in `apps/api/app/main.py:70-130` only parses `<visual>` and ignores `<inertial>`/`<collision>`/`<dynamics>`, so mass and collision are currently discarded.

- Primitive inertia formulas (for validation): box `ixx=(1/12)m(y²+z²)`, cylinder `izz=(1/2)mr²`, sphere `i=(2/5)mr²`. Not in URDF spec itself but in Bullet docs (`btBoxShape`, `btCylinderShape`, `btSphereShape` calculateLocalInertia): https://pybullet.org/Bullet/BulletFull/classbtCollisionShape.html

## 3. What PyBullet does with mass (primary sources)

- Loading: `p.loadURDF(file, useFixedBase, flags=p.URDF_USE_SELF_COLLISION, physicsClientId=...)` — `useFixedBase=True` makes base mass 0 and fixed in world (current code `main.py:314`); `URDF_USE_SELF_COLLISION` enables self-collision (current code passes it). Docs: https://docs.google.com/document/d/10sXEhzFRSnvFcl3XxNGhnD4N2SedqwdAvK3dsihxVv8/preview#heading=h.2ye70wns7io3 and https://pybullet.readthedocs.io/en/latest/pybullet.html#loadurdf

- Gravity: `p.setGravity(0,0,-9.81, physicsClientId=...)` sets world gravity (`main.py:312`). Zero-mass links ignore gravity; positive-mass links fall/accelerate at 9.81 m/s² unless constrained. Docs: https://pybullet.readthedocs.io/en/latest/pybullet.html#setGravity

- Teleport vs control:
  - `p.resetJointState(body, jointIndex, targetValue, targetVelocity=0, physicsClientId=...)` instantly teleports joint position/velocity, bypasses dynamics, no effort/velocity limit, no inertia, no collision response during the teleport (current `_apply_positions` at `main.py:336-338` and `set_positions`/`count_contacts_at:405-411`). Docs: https://pybullet.readthedocs.io/en/latest/pybullet.html#resetJointState — "instantly set the joint state, ignoring physics".
  - `p.setJointMotorControl2(body, jointIndex, controlMode=p.POSITION_CONTROL, targetPosition, force=maxForce, maxVelocity=..., positionGain, velocityGain, physicsClientId=...)` — PID position servo that respects `force` (effort) and produces dynamics-consistent motion over subsequent `stepSimulation` calls. Docs: https://pybullet.readthedocs.io/en/latest/pybullet.html#setJointMotorControl2
  - `p.setJointMotorControl2(..., VELOCITY_CONTROL, targetVelocity, force=...)` and `TORQUE_CONTROL` (force/torque directly) are the other modes. Docs: same page, controlMode enum.
  - `p.changeDynamics(body, linkIndex, mass, localInertiaDiagonal, lateralFriction, restitution, ...)` — override mass/inertia/friction at runtime. Docs: https://pybullet.readthedocs.io/en/latest/pybullet.html#changeDynamics
  - `p.getDynamicsInfo(body, linkIndex)` — returns `(mass, lateralFriction, localInertiaDiagonal, ...)` — for inspection. Docs: https://pybullet.readthedocs.io/en/latest/pybullet.html#getDynamicsInfo
  - `p.stepSimulation(physicsClientId=...)` — advances one fixed timestep (default 1/240 s = 4.166ms, configurable via `p.setTimeStep` and `p.setPhysicsEngineParameter`). Current `SimulationSession.step()` at `main.py:340-351` calls it and then reads back `getJointState()[0]`. Docs: https://pybullet.readthedocs.io/en/latest/pybullet.html#stepSimulation and https://docs.google.com/document/d/10sXEhzFRSnvFcl3XxNGhnD4N2SedqwdAvK3dsihxVv8/preview#heading=h.o2qdonfasflt

- Fixed base & self-collision: `useFixedBase=True` matches current code; to make base dynamic (falling robot), set False and ensure base `<inertial>` mass >0. `p.URDF_USE_SELF_COLLISION` flag is already used (`main.py:315`). Docs: same loadURDF doc.

- Contact query: `p.getContactPoints(bodyA=...)` used in `count_contacts_at` (`main.py:411`) probes contacts after one `stepSimulation`; with `resetJointState` teleport the contacts are for the teleported pose, not for a dynamically-reached pose. Docs: https://pybullet.readthedocs.io/en/latest/pybullet.html#getContactPoints

## 4. Current repo: kinematic teleport, not physics

- `parse_urdf` (`main.py:70-130`) extracts `<visual>` geometry + joint `axis/lower/upper/velocity` but discards `<inertial>`, `<collision>`, `<dynamics>`. Demo URDF (`main.py:30-56`) has no `<inertial>` or `<collision>` at all — all masses are implicitly 0.

- `SimulationSession.__init__` (`main.py:301-339`) connects `p.DIRECT`, sets gravity, loads URDF with `useFixedBase=True` + `URDF_USE_SELF_COLLISION`, builds `pybullet_indices` mapping, and calls `_apply_positions`.

- `_apply_positions` (`main.py:333-338`) loops `p.resetJointState(body, index, position)` — pure teleport. `set_positions` clamps to joint limits and calls `_apply_positions`. `step()` does `p.stepSimulation` then `getJointState()[0]` read-back, but since joints were teleported, the simulation has not integrated forces; positions are just the teleported values (drift only from collision resolution).

- `count_contacts_at` (`main.py:395-419`) teleports, steps once, counts contacts — kinematic probe, not dynamic.

- `build_incremental_samples` (`main.py:471-579`) expands authored checkpoints via `_lerp_positions` linear interpolation at `timestep_ms` grid, producing normalized `(current, goal, progress, previous_delta) -> delta` samples. No physics: no gravity, no inertia, no effort/velocity enforcement beyond `max_joint_step`/`build_approach_plan` clamping (`main.py:419-452`) which is a kinematic velocity cap, not a dynamics constraint.

- `train_session` (`main.py:582-622`) trains a temporal MLP (`make_model:229-247`) via `SmoothL1Loss` (`main.py:601`) on full-batch `(x,y)` to predict normalized delta per step. No physics loss, no simulator in the loop. Model input size `joint_count*3+1` (`main.py:422`), output `joint_count` deltas (`main.py:599`).

- `rollout` (`main.py:689-830`) autoregressively predicts deltas, denormalizes, and appends frames. Approach phase is either scripted bounded lerp (`build_approach_plan`) or learned (same model). Gesture phase optionally scales deltas by `grid_ms/step_ms` (`main.py:767-808`). No `setJointMotorControl2`, no `stepSimulation` integration of predicted torques/positions — positions are directly assigned. Collisions counted post-hoc on `expected` poses only (`main.py:826-828`).

- Frontend `apps/web` renders via Three.js from joint positions (visual geometry only); no physics sync needed yet because positions are kinematic.

- PyTorch relevance: `torch.nn.SmoothL1Loss` (https://pytorch.org/docs/stable/generated/torch.nn.SmoothL1Loss.html), `torch.optim.Adam` (https://pytorch.org/docs/stable/generated/torch.optim.Adam.html), `torch.nn.Sequential`/`Linear` (https://pytorch.org/docs/stable/nn.html) — all used kinematically; none enforce physics.

## 5. How to make training and replay physics-realistic with mass (options)

### Option A — Keep kinematic training, make replay physics-stepped (lowest cost, recommended first step)

- Parse `<inertial>` + `<collision>` in `parse_urdf`; reject or synthesize invalid inertia (zero/negative mass, non-positive-definite inertia) with clear 422 errors. LoadURDF will then create dynamic links (mass>0) while `useFixedBase=True` keeps base fixed.
- Keep `build_incremental_samples`/`train_session` unchanged (still delta regression).
- Change `rollout` (and optionally a new `POST /simulate` endpoint) to execute predictions through PyBullet: for each predicted delta, compute `targetPosition = denormalized(current+delta)` then `p.setJointMotorControl2(..., POSITION_CONTROL, targetPosition, force=effortLimit, maxVelocity=velocityLimit)` + `p.stepSimulation` (with `setTimeStep = timestep_ms/1000` or substeps) + `getJointState` read-back as the next `current`. Cache `jointVelocityLimit`/`effort` from URDF `limit`.
- `count_contacts_at` and collision counting then reflect dynamic contacts; add `p.getContactPoints` filtering for self vs environment.
- Pros: training unchanged; replay shows gravity/inertia/effort effects; effort/velocity limits from URDF now matter.
- Cons: training still unaware of dynamics — model may command infeasible deltas that the controller clips.
- Effort: small (parse + rollout control loop). Risk: low.
- Sources: PyBullet `setJointMotorControl2` POSITION_CONTROL + `force`/`maxVelocity`, `setTimeStep` docs above; URDF `limit effort velocity` spec.

### Option B — Physics-aware training (simulator-in-the-loop imitation)

- Same parsing as A, plus during `build_incremental_samples` or a new `build_physics_samples` generate samples by stepping the simulator: for each `(current, next_expected)` pair, set motor target to `next_expected`, step, record achieved `next_achieved` and use `delta_achieved` as target, or add a physics-consistency loss term. Alternatively add DAgger-style corrective data collected from physics rollouts.
- Train same MLP architecture but on dynamics-feasible deltas; optionally add auxiliary loss penalizing effort/velocity violation.
- Pros: model learns feasible motions; better sim-to-real.
- Cons: training 10-100x slower (sim steps per sample), nondeterministic, needs `setTimeStep` tuning and substeps; couples training to PyBullet version.
- Effort: medium. Risk: medium (reproducibility, speed).

### Option C — Torque/velocity action space (most realistic, largest change)

- Change model to predict `TORQUE_CONTROL` or `VELOCITY_CONTROL` commands instead of position deltas, with `p.setJointMotorControl2(..., TORQUE_CONTROL, force=predictedTorque)` or `VELOCITY_CONTROL`. Requires URDF `effort` (torque limit) and tuning PID gains (`positionGain`/`velocityGain`) or exposing them.
- Training via behavior cloning on torques (needs inverse dynamics to derive expert torques from kinematic demos) or via RL/differentiable sim — out of scope for MLP-simple MVP.
- Pros: physically correct actuation; handles mass/inertia natively.
- Cons: needs inverse dynamics (`p.calculateInverseDynamics` — https://pybullet.readthedocs.io/en/latest/pybullet.html#calculateInverseDynamics) or torque labels not in current demonstrations; breaks demo-first simplicity; product guardrail "MLP-oriented and simple" (`AGENTS.md`, `CONTEXT.md`) strained.
- Effort: large. Risk: high. Defer unless product explicitly pivots to dynamics.

### Option D — Hybrid: kinematic training + physics validation gate

- Keep A, but add a post-rollout physics validation pass that replays `result.frames[].positions` through `POSITION_CONTROL` + `stepSimulation` and reports tracking error, contact count, and effort clipping. Fail or warn if error > threshold. No training change.
- Pros: minimal code, gives "realism score" without changing model.
- Cons: model still kinematic.
- Effort: very small.

## 6. Trade-offs matrix

| Dimension | Kinematic (today) | Physics-stepped replay (A) | Physics-in-loop training (B) | Torque prediction (C) |
|---|---|---|---|---|
| Realism | None (teleport) | Medium (respects mass, gravity, effort, collision) | High (learns feasible) | Highest |
| Training cost | Fast, deterministic | Same as today | Slow, sim-dependent | Very high, needs torque labels |
| Replay fidelity | Exact to prediction | Clipped/settled by dynamics; needs substeps | Same as A | Most faithful |
| Change surface | — | `parse_urdf` + `rollout` + `SimulationSession` control helpers | Above + `build_incremental_samples`/`train_session` | Above + model I/O + data pipeline |
| Product fit | Contradicts "needs mass" | Fits MLP-simple, demo-first | Fits but heavier | Conflicts with MLP-simple guardrail |

- Predicting deltas vs positions vs torques: deltas (today) are small and normalized, stable for MLP; absolute positions drift; torques are mass-dependent and need inverse dynamics — prefer deltas for Cloning, torques only if pivoting to dynamics (see `p.calculateInverseDynamics`).
- Effort/velocity limits: URDF `<limit effort velocity>` should map to `setJointMotorControl2(force=effort, maxVelocity=velocity)` and to `max_joint_step`/`approach_step_count` already in `main.py:419-452`; today those are kinematic caps only.
- Inertia/mass validation: reject `mass <=0` (except fixed base), reject non-finite or non-positive-definite inertia, warn if `<inertial>` missing (mass 0 → kinematic link), optionally synthesize inertia from primitive geometry via `calculateLocalInertia` formulas; expose via `getDynamicsInfo` check after load.
- Gravity/fixed base/self-collision: keep `setGravity(0,0,-9.81)` (`main.py:312`); keep `useFixedBase=True` for tabletop arms, add config to allow `useFixedBase=False` for mobile bases; keep `URDF_USE_SELF_COLLISION` flag already used.
- Three.js sync: physics does not affect rendering except joint positions change via `getJointState` read-back; ensure frontend animates `positions` array at `timeline_fps`/`timestep_ms` without assuming teleport — add interpolation between physics steps if `setTimeStep` < `timestep_ms`.

## 7. Recommendation (product decision outcome)

1. **Immediate (next sprint): Option A + D.** Parse `<inertial>`/`<collision>`/`<limit effort>`/`<dynamics>` in `parse_urdf` (`main.py:70-130`), validate mass/inertia, surface `mass`/`inertia`/`effort`/`velocity` in `serializable_robot` and `GET /api/robots/demo`; change `rollout` to `POSITION_CONTROL` + `stepSimulation` + `getJointState` loop with `force`/`maxVelocity` from URDF and `setTimeStep` derived from `timestep_ms` (substeps if needed); keep training kinematic; add physics validation gate reporting tracking error and `getContactPoints` collisions. This satisfies "model needs mass now" for training and replay realism with minimal risk and preserves MLP-simple/demo-first (`AGENTS.md`, `CONTEXT.md`, `docs/adr/0002`).

2. **Next if realism still insufficient: Option B** — generate physics-feasible deltas in `build_incremental_samples` via sim stepping; measure mid-trajectory error (cf. `docs/research/2026-09-04-mid-trajectory-errors.md`) under physics.

3. **Defer Option C** until product explicitly requires torque control or RL; it breaks the MLP-simple guardrail and needs new demonstration data (torques).

## 8. Validation checklist for implementation (no code changed here)

- Unit: `parse_urdf` rejects mesh, accepts box/cylinder/sphere + `<inertial>`; `getDynamicsInfo` after `loadURDF` confirms mass>0; `changeDynamics` override test.
- Integration: `rollout` with `POSITION_CONTROL` + `stepSimulation` reaches `expected` within tolerance on demo URDF with mass; contacts detected via `getContactPoints`.
- Perf: `setTimeStep`/`setPhysicsEngineParameter(numSubSteps)` tuning so 120ms `timestep_ms` does not require 30 substeps per rollout step.

## Sources

- Repo: `apps/api/app/main.py:30-56,70-130,196-247,301-351,382-452,471-622,689-830`, `CONTEXT.md`, `AGENTS.md`, `docs/adr/0002-timeline-based-teaching-and-curriculum-training.md`.
- URDF spec: link/inertial/mass/inertia http://wiki.ros.org/urdf/XML/link, joint/limit/dynamics http://wiki.ros.org/urdf/XML/joint
- PyBullet: loadURDF/useFixedBase/URDF_USE_SELF_COLLISION https://docs.google.com/document/d/10sXEhzFRSnvFcl3XxNGhnD4N2SedqwdAvK3dsihxVv8/preview, setGravity https://pybullet.readthedocs.io/en/latest/pybullet.html#setGravity, resetJointState https://pybullet.readthedocs.io/en/latest/pybullet.html#resetJointState, setJointMotorControl2 (POSITION_CONTROL/VELOCITY_CONTROL/TORQUE_CONTROL, force, maxVelocity, positionGain) https://pybullet.readthedocs.io/en/latest/pybullet.html#setJointMotorControl2, changeDynamics/getDynamicsInfo https://pybullet.readthedocs.io/en/latest/pybullet.html#changeDynamics / #getDynamicsInfo, stepSimulation/setTimeStep https://pybullet.readthedocs.io/en/latest/pybullet.html#stepSimulation, getJointState https://pybullet.readthedocs.io/en/latest/pybullet.html#getJointState, getContactPoints https://pybullet.readthedocs.io/en/latest/pybullet.html#getContactPoints, calculateInverseDynamics https://pybullet.readthedocs.io/en/latest/pybullet.html#calculateInverseDynamics, Bullet calculateLocalInertia https://pybullet.org/Bullet/BulletFull/classbtCollisionShape.html
- PyTorch: SmoothL1Loss https://pytorch.org/docs/stable/generated/torch.nn.SmoothL1Loss.html, Adam https://pytorch.org/docs/stable/generated/torch.optim.Adam.html, nn.Sequential/Linear https://pytorch.org/docs/stable/nn.html
- Bullet physics: https://pybullet.org/Bullet/phpBB3/viewtopic.php?t=12592, https://pybullet.org/Bullet/phpBB3/viewtopic.php?f=18&t=12776
