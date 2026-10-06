# Camera motion guard and preparation for robot transport

The manual recovery and preparation-only restriction below are superseded by
[ADR 0004](./0004-live-arm-dds-control.md).

## Decision

Keep this stage simulation-only. Camera observations are desired joint targets;
preview commands approach them at a bounded speed rather than resetting joints
to each observation. Demonstrations remain the primary artifact. Raw camera
landmarks are retained locally; saving a continuous gesture derives guarded robot
frames using the original timestamps. Static camera poses remain static poses.

The guard uses a maximum 0.5 rad/s per joint, reduced by any positive URDF
velocity limit. These are conservative preview defaults, not validated G1
hardware limits. Each preview tick spends at most 100 ms of elapsed time. Missing
or nonfinite observations hold the last position. Observations older than 250 ms
stop movement. A gap beyond 250 ms, an image-space torso displacement over 0.18,
or a mapped joint target change over 0.8 rad latches a pause. A fresh observation
and the explicit “Resume checked person” action release a preview pause. Resume
retains the current position and continues through the speed limiter.

Image-space torso continuity requires at least two shared visible torso points.
It is deliberately conservative. This is not persistent person identity: a
similar person in the same place can evade the heuristic, and fast legitimate
motion can trigger it. A production controller needs an operator-selected subject,
identity continuity, an explicit re-acquisition procedure, and confidence gating
per commanded joint. Occluded joints currently use the retargeting profile's
neutral target and approach it at bounded speed; complete tracking loss holds.

Continuous Archive conversion starts at the entry neutral pose and holds after
a discontinuity for the rest of that conversion, because offline conversion
cannot ask an operator to authorize a new subject. This can shorten reproduced
motion; inspect the result or re-record a continuous take. Long detection gaps
never grant extra movement time. Future conversion should offer an inspected
repair timeline with explicit bounded transitions and an auditable subject choice.
Preview guards do not retroactively modify existing Archive demonstrations.
A selected recorded frame remains an intentional preview target even when playback
is paused, so the preview can finish its bounded approach to that frame.

## Preview layout

Live “Expand robot” hides the source panel using CSS while leaving the video,
detector, and recording resources mounted. “Show camera” restores it. Recording
inspection already offers a Robot view; that view now uses a taller viewport.
Camera expansion, source fit, mobile layout, recording controls, and mapping
inspection retain their existing ownership.

## Backend preparation

`POST /api/robot-transport/plan` validates a preparation-only configuration:

```json
{
  "transport": "unitree-sdk2",
  "robot_model": "g1-29",
  "network_interface": "eth0",
  "domain_id": 0,
  "max_joint_speed": 0.5,
  "stale_after_ms": 250
}
```

The response always has `transmission_enabled: false`. It does not persist a
connection, create DDS participants, install an SDK, or publish commands.
`ros2` is an alternative planned adapter; its topic names omit the SDK's `rt/`
prefix. Topic namespaces/remapping, firmware compatibility, and QoS must be
verified when that adapter is implemented. No browser connection UI is exposed
until a stateful backend transport exists.

## Next implementation stage

1. Create an owning backend transport module outside simulation sessions. Keep
   browser Archive ownership unchanged. Define a transport interface for measured
   state, command publication, health, and shutdown; implement a mock first.
2. Pin the SDK version, actual robot model/firmware, and explicit URDF-name to
   hardware-motor-index map. Validate joint scopes independently of URDF order.
   Initially allow arms only; waist and legs need separate authorization.
3. Run DDS on the backend host with an explicit network interface and domain.
   Ordinary SDK discovery has no robot-IP parameter. Matching DDS domain and
   reachable discovery/data traffic are necessary; being on the same LAN alone
   is insufficient. Use an isolated network with exactly one verified robot:
   a DDS domain is not a robot identity or authentication boundary. For routed
   networks, configure CycloneDDS peers/discovery rather than adding an IP to
   every command. Desktop container NAT/bridge networks may block discovery;
   run the adapter on the connected Linux host or validate a host-network setup.
4. Subscribe to `rt/lowstate`, require fresh measured state, verify robot/model
   context and initialize the command trajectory from measured positions. Never
   initialize a real robot from a browser neutral pose or remembered command.
5. Use `rt/arm_sdk` with `unitree_hg` LowCmd for the verified G1 arm configuration.
   Encode named motors' q/dq/tau/kp/kd, correct mode fields and CRC using the
   pinned official SDK. Confirm control ownership and the special motor 29
   engagement weight. Ramp engagement from zero. Never substitute `rt/lowcmd`
   casually: it takes full-body responsibility.
6. Enforce joint limits, calibrated speed, acceleration, and jerk limits on the
   backend's independent fixed-rate command loop (the official example uses
   20 ms). Latest target replaces older targets; never replay queued camera
   packets. Reject nonfinite, wrong-sized, old/out-of-order packets. Scope each
   stream to a single explicitly armed operator and robot; expire authorization.
7. On camera loss, hold a bounded commanded trajectory and require confirmation
   before reacquisition. On state loss, network faults, browser disconnect,
   process exit, or emergency stop, use a separately validated robot-specific
   stop/disengagement procedure. Do not assume that publisher silence stops
   hardware or that holding q is physically safe. Add a watchdog independent
   of HTTP/WebSocket request processing. Validate collision/workspace constraints
   and stop distance before activation.
8. Expose connection state, measured vs commanded pose, current guard reason,
   speed setting, Arm/Disarm, and emergency stop in the UI. Keep a dry-run option.
   Verify the adapter in simulation, fault-injection tests, then a supervised
   isolated hardware test before enabling transmission by default.

## Sources checked on 2026-10-06

DeepWiki was used to locate the SDK examples; decisions were checked against the
primary Unitree source:

- [Official G1 seven-DOF arm example](https://github.com/unitreerobotics/unitree_sdk2_python/blob/master/example/g1/high_level/g1_arm7_sdk_dds_example.py)
- [Official Python DDS channel initialization](https://github.com/unitreerobotics/unitree_sdk2_python/blob/master/unitree_sdk2py/core/channel.py)
- [Official CycloneDDS configuration](https://github.com/unitreerobotics/unitree_sdk2_python/blob/master/unitree_sdk2py/core/channel_config.py)
- [DeepWiki example index](https://deepwiki.com/unitreerobotics/unitree_sdk2_python/7.2-low-level-examples)

## Verification

Frontend unit tests: 154 passed. Backend tests: 87 passed. Frontend build and
`git diff --check` passed. All five camera Cypress journeys passed, including
landscape/portrait sources, robot expansion and camera restoration, mobile
layout, recording, real video/WASM extraction, playback, and Archive saving.
The complete Cypress suite passed 14 of 17 tests. The three failures reproduced
on an isolated unchanged HEAD snapshot: two navigation assertions still expect
“Train from keyframe motion.” and one timeline assertion cannot find
“Robot animation channels”. They are outside this change. Cypress desktop checks
used a 1280×900 viewport; camera journeys also exercised a 390×844 mobile view.

The requested code-review skill was unavailable in the installed skills. A manual
diff and layout review was performed instead. No hardware motion was tested;
DDS publication remains unimplemented and disabled.
