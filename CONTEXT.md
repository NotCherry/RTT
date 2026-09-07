# Robot Teaching Environment

This project is a pose and gesture teaching environment for recording, inspecting, replaying, and archiving expected robot behavior. Model training supports those demonstrations, but the archive of demonstrations is the primary product artifact.

## Demonstrations

**Pose**:
A static configuration of the robot's controllable joints.
_Avoid_: Target-only sample, random pose

**Frame**:
A timestamped robot state captured as one point in an expected behavior.
_Avoid_: Prediction, training sample

**Checkpoint**:
An authored Keyframe in the gesture timeline. A checkpoint stores the complete controllable-joint state at a deliberate timeline frame; motion between checkpoints is derived for preview, training, and evaluation.
_Avoid_: Individual slider change, sampled playback frame, model prediction

**Keyframe**:
An authored time-position pair in a gesture animation. Keyframes appear as selectable channel markers and are the source of truth for the expected behavior; derived timestep samples are never promoted to keyframes.
_Avoid_: Fixed-rate recorder sample, prediction

**Gesture**:
An ordered sequence of frames that describes a motion or behavior over time.
_Avoid_: Pose, trajectory label

**Demonstration**:
A recorded pose or gesture that expresses expected robot behavior and can be archived or used for training.
_Avoid_: Random test, model output

**Archive**:
The durable collection of robot context, demonstrations, annotations, and related experiment records.
_Avoid_: Dataset-only, model checkpoint

**Dataset**:
A named, robot-scoped collection inside an Archive used to organize compatible pose and gesture demonstrations for a teaching or training workflow.
_Avoid_: Entire archive, model checkpoint

## Training and Evaluation

**Training run**:
One attempt to derive a behavior model from archived demonstrations, including its configuration and progress metrics.
_Avoid_: Demonstration, evaluation

**Evaluation**:
A deliberate inspection of how a trained model reproduces or responds to an expected demonstration.
_Avoid_: Random pose generation, loss display

**Prediction**:
A model-produced robot state or action for an evaluation case.
_Avoid_: Expected behavior, demonstration frame

**Training metric**:
Diagnostic information about a training run, such as progress or loss, shown to help understand the model rather than define the teaching workflow.
_Avoid_: Demonstration quality

## Physics Realism

**Mass**:
Per-link inertial mass in kilograms from URDF `<inertial><mass value>`. Zero-mass links are kinematic and ignore gravity; positive-mass links respond to gravity and effort limits.
_Avoid_: Visual-only weight, mesh mass

**Inertia**:
The 3×3 rotational inertia (ixx, ixy, ixz, iyy, iyz, izz) for a link, in kg·m², from URDF `<inertial><inertia>`. Must be positive-definite; may be synthesized from primitive geometry via `calculateLocalInertia` when not authored.
_Avoid_: Joint limit, collision shape

**Dynamics**:
Joint-level physical properties from URDF `<joint><limit effort velocity>` and `<dynamics damping friction>` that bound feasible motion. Effort maps to `setJointMotorControl2(force)`, velocity to `maxVelocity`.
_Avoid_: Training hyperparameter, visual damping

**Physics-realistic replay**:
Execution of a predicted gesture through PyBullet `POSITION_CONTROL` + `stepSimulation` substeps + `getJointState` read-back, so the achieved pose reflects mass, gravity, effort/velocity clipping, and contact response rather than teleport (`resetJointState`).
_Avoid_: Kinematic teleport replay, pure visual interpolation

**Tracking error**:
The per-step difference between a model-predicted target position and the physics-achieved position after stepping, reported alongside contact count and clip count as a realism diagnostic.
_Avoid_: Training loss, native MAE vs expected

## Coordination

**Simultaneous motion**:
A gesture where two or more controllable joints must move together (diagonal in joint space) rather than sequentially (L-shaped, one joint then the other). Coordination is measured per step via direction alignment (cosine between predicted and expected deltas) and simultaneity (fraction of expected active joints that actually move).
_Avoid_: Sequential one-joint-at-a-time execution, final-pose-only evaluation

**Coordination weight**:
A scalar multiplier (TrainConfig `coordination_weight`) that emphasizes training samples where several joints must move together. Weighting raises the loss of the sequential shortcut without moving the optimum (zero at exact fit) and keeps the model MLP-simple (no recurrence, no new inputs).
_Avoid_: Additive penalty term, recurrent architecture

## Model Exploration

**MLP**:
The initial and default behavior-model family for this environment, suitable for the first simple pose and gesture experiments.
_Avoid_: Universal model architecture

**Model editor**:
A future capability for exploring different network shapes, layers, activations, and model families.
_Avoid_: Current MVP requirement

**Architecture exploration**:
Future experimentation with alternative network topologies or search methods, including genetic algorithms, without committing the MVP to those methods.
_Avoid_: Required training path
