# Robot Teaching Environment

This project is a pose and gesture teaching environment for recording, inspecting, replaying, and archiving expected robot behavior. Model training supports those demonstrations, but the archive of demonstrations is the primary product artifact.

## Demonstrations

**Pose**:
A static configuration of the robot's controllable joints.
_Avoid_: Target-only sample, random pose

**Frame**:
A timestamped robot state captured as one point in an expected behavior.
_Avoid_: Prediction, training sample

**Gesture**:
An ordered sequence of frames that describes a motion or behavior over time.
_Avoid_: Pose, trajectory label

**Demonstration**:
A recorded pose or gesture that expresses expected robot behavior and can be archived or used for training.
_Avoid_: Random test, model output

**Archive**:
The durable collection of robot context, demonstrations, annotations, and related experiment records.
_Avoid_: Dataset-only, model checkpoint

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
