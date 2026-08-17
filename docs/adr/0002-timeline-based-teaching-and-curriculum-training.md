# ADR 0002: Timeline-Based Teaching and Curriculum Training

- Status: Accepted
- Date: 2026-02-14
- Scope: Demonstration authoring, temporal training, evaluation, and dataset organization

## Context

The initial workbench captured static poses and passively sampled gestures. That model was insufficient for robots with many controllable joints: users could not conveniently author complete multi-joint checkpoints, inspect timing, or evaluate movement through intermediate states. The first behavior-cloning model also learned only a final-pose regression and had no temporal rollout.

## Decision

The workbench will use full-robot snapshots as authored gesture keyframes. A keyframe is persisted with an integer timeline frame, derived timestamp, interpolation mode, and all controllable joint positions. The timeline editor is a dedicated routed animation page with a time ruler, playhead, per-joint channels, diamond markers, keyframe insertion, selection, time movement, deletion, scrubbing, and interpolation-based preview. Existing timestamped frames remain a compatibility representation while demonstrations migrate to authored keyframes.

The default temporal MLP will receive:

```text
current normalized joint state
+ goal checkpoint normalized joint state
+ normalized segment progress
```

It will predict a small normalized joint-position delta for the next timestep. Authored segments are expanded into incremental samples using a configurable timestep. Training can add seeded, bounded randomized starting poses. Evaluation rolls the model through the checkpoint sequence and reports intermediate and final errors.

Named datasets are robot-scoped collections within the session archive. Demonstrations can be assigned to a dataset and exported together with the robot, demonstrations, keyframes, dataset metadata, and model configuration. Training, archive management, and evaluation are separate routed pages rather than content squeezed into a shared panel.

## Consequences

### Positive

- Complex multi-joint behavior can be authored as complete, inspectable checkpoints.
- Timing becomes explicit rather than being hidden in a fixed recording interval.
- Training and evaluation can inspect intermediate movement, not just final pose error.
- Seeded randomized starts provide a controlled robustness experiment.
- Dataset membership gives captured demonstrations a durable organizational unit.

### Negative

- Temporal training and rollout add configuration and validation complexity.
- The MLP remains a small controller rather than a general sequence model.
- Session persistence is still local and archive-oriented; a future durable catalog may need a separate storage layer.
- Initial interpolation is intentionally limited to linear and hold/step modes; full Bezier/F-curve handles remain a future extension.

## Rejected alternatives

- **Final-pose-only regression**: retained only as the compatibility path for static prediction; it cannot teach checkpoint-by-checkpoint motion.
- **Fixed-rate recorder samples as the authoring model**: rejected because sampled telemetry does not communicate deliberate teaching intent.
- **Full Bezier/F-curve editing in the first timeline release**: deferred; Blender-style channels and keyframes are included first, with linear and hold interpolation providing a smaller stable interface.
- **Unseeded randomization**: rejected because evaluation must be repeatable and debuggable.
- **Global cross-robot datasets**: deferred until robot compatibility and versioning rules are mature.
