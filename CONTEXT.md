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

**Camera capture**:
A device-local sequence of body and hand landmarks used as the source for a camera-derived demonstration. The source video may be retained as a Local recording but is never part of the Archive.
_Avoid_: Uploaded video, robot frame

**Local recording**:
A robot-scoped camera video retained on the current device for later extraction and inspection. Deleting a local recording does not delete robot demonstrations already saved to the Archive.
_Avoid_: Archived video, uploaded video

**Landmark frame**:
A timestamped stick-figure observation from a camera capture. It becomes a robot Frame only after retargeting.
_Avoid_: Robot state, authored Keyframe

**Multi-camera capture**:
A device-local camera capture with two or three views of the same person. A pose estimator combines sufficiently close observations into one Landmark frame; source videos remain Local recordings.
_Avoid_: Multiple people, uploaded camera feed

**Camera calibration**:
Measured camera intrinsics, lens distortion, and relative camera transforms for a fixed arrangement and capture resolution. Calibration enables triangulated landmarks and must be repeated when the arrangement changes.
_Avoid_: Neutral robot pose, behavior-model training

**Pose estimator**:
A perception model and optional multi-view geometry that produce human landmarks from camera observations. It supplies a Demonstration source; the behavior-model MLP still learns from robot demonstrations.
_Avoid_: Trained robot behavior, guaranteed person identity

**Retargeting profile**:
A versioned mapping from observable human landmarks to a robot's controllable joints, including neutral-pose preservation and joint-limit clamping.
_Avoid_: Model prediction, training configuration

**Camera target**:
The latest visible upper-body joint positions retargeted from a live landmark frame and accepted by the robot backend. It can be inspected while disarmed; publishing a motor command requires explicit arming and applies independent motion limits.
_Avoid_: Measured robot state, published motor command

**Single-arm control**:
Live camera mapping of the selected left or right arm. The other arm and available waist joints hold their measured positions from the most recent explicit arming.
_Avoid_: Released torso, full-body control

**Upper-body control**:
Live camera mapping of both arms and the physically movable waist axes. Unobserved channels hold the last commanded position; legs remain under the robot's local controller.
_Avoid_: Locomotion, balance controller

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
A block-oriented workspace for composing, validating, and configuring behavior-model architectures without writing Python.
_Avoid_: Arbitrary code executor, demonstration editor

**Architecture exploration**:
Comparing model specifications and training parameters through bounded experiment runs, including evolutionary search, while keeping demonstrations as the primary artifact.
_Avoid_: Training a single configured model, evaluation rollout

**Model specification**:
A versioned, declarative description of a behavior model's blocks and their settings. It is validated and compiled by the backend and never contains executable user code.
_Avoid_: PyTorch state dictionary, arbitrary Python

**Experiment run**:
A bounded comparison of candidate model specifications or training parameters against the same immutable demonstration snapshot and scoring rule.
_Avoid_: Individual candidate training run, final evaluation
