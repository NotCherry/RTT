# ADR 0002: Timeline-Based Teaching and Curriculum Training

- Status: Accepted
- Date: 2026-02-14
- Scope: Demonstration authoring, temporal training, evaluation, and dataset organization

## Context

The initial workbench captured static poses and passively sampled gestures. That model was insufficient for robots with many controllable joints: users could not conveniently author complete multi-joint checkpoints, inspect timing, or evaluate movement through intermediate states. The first behavior-cloning model also learned only a final-pose regression and had no temporal rollout.

## Decision

The workbench will use full-robot snapshots as gesture checkpoints. A checkpoint is persisted as a `Frame` with a timestamp and all controllable joint positions. The timeline editor allows checkpoint capture, editing, reordering through timestamp normalization, deletion, scrubbing, and interpolation-based preview.

The default temporal MLP will receive:

```text
current normalized joint state
+ goal checkpoint normalized joint state
+ normalized segment progress
```

It will predict a small normalized joint-position delta for the next timestep. Authored segments are expanded into incremental samples using a configurable timestep. Training can add seeded, bounded randomized starting poses. Evaluation rolls the model through the checkpoint sequence and reports intermediate and final errors.

Named datasets are robot-scoped collections within the session archive. Demonstrations can be assigned to a dataset and exported together with the robot, demonstrations, dataset metadata, and model configuration.

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
- Interpolation is intentionally simpler than per-joint curve editing and does not represent every possible gesture shape.

## Rejected alternatives

- **Final-pose-only regression**: retained only as the compatibility path for static prediction; it cannot teach checkpoint-by-checkpoint motion.
- **Continuous per-joint curves in the first timeline release**: deferred because snapshot checkpoints provide a smaller authoring surface with clearer training semantics.
- **Unseeded randomization**: rejected because evaluation must be repeatable and debuggable.
- **Global cross-robot datasets**: deferred until robot compatibility and versioning rules are mature.
