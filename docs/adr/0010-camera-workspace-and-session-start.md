# Live-first Camera workspace and explicit one-click sessions

## Decision

Implement the approved Camera workspace plan with Live, Camera setup, Calibration
and Recordings views. A coordinator above these views owns camera streams,
detectors, recording and robot connection. Subtab navigation retains resources.
The setup has an explicit one/two/three-camera selector, stable slot IDs and
independent USB/IP sources. Calibration binds to the arrangement and dimensions;
source changes invalidate that binding rather than silently reassigning cameras.

Live processing is the initial default. Unitree DDS is the initial physical
transport, with the existing direct-Ethernet settings. Settings restoration never
opens cameras or commands hardware. Browser permissions remain browser-owned.

Run on physical robot is an explicit request to start motor control. It opens the
configured cameras, initializes perception, connects and authenticates the owned
target stream, waits for current tracking and measured robot state, and explicitly
calls the arm endpoint. This supersedes ADR 0004's separate Arm-button requirement;
opening a camera, connecting a robot, restoring settings or recovering from a fault
does not independently authorize arming. Cancellation invalidates the attempt,
including any delayed completion, and releases only its owned partial connection.

Stop robot releases control while the preview can continue. A fault or stop requires
a new Run action. Existing ownership, measured initialization, engagement ramp,
limits, process isolation, latest-target delivery and watchdogs remain required.
Recordings never feed hardware control. Calibration runs with hardware disarmed.
Finishing a Local recording preserves live capture and does not navigate away.

Calibrated multi-camera reconstruction keeps explicit timing quality and provenance.
Body-aligned fusion remains approximate and is never silently substituted for
calibrated depth. Perception adapters are separate from the behavior-model MLP.
The URDF remains the motion reference; measured feedback exposes physical tracking
differences. Candidate hardware speed profiles do not prove physical acceptance.

## Verification

Track implementation and acceptance evidence in `docs/camera-workspace-tasks.md`.
Protect startup cancellation, ownership, stale tracking, configuration changes,
subtab navigation and uninterrupted recording with component and browser tests.
Validate actual motion matching and calibrated rig accuracy separately on hardware.
