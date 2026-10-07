# Responsive camera teaching and live G1 arm control

This decision supersedes the manual camera-recovery behavior and preparation-only
transport restriction in ADR 0003. The operator requested actual DDS support for
a G1 EDU with 29 DOF and seven-DOF arms, with physical testing left to them.

## Responsive preview

Live observation sampling defaults to 30 fps. Preview defaults to 3 rad/s at 60 updates/second, with choices of 1, 2, 3 and 5
rad/s. Positive URDF velocity limits still reduce that value. Hardware motion
uses independent backend limits; changing preview speed does not change them.
Missing observations hold the current pose. Abrupt image-space torso changes or
tracking gaps cause a short automatic reacquisition: 100 ms of mutually
consistent observations resumes bounded motion. Rapid mapped joint changes use
the speed limiter directly and do not pause. Missing torso landmarks no longer
interrupt arm-only teaching. There is no Resume button or permanent pause.

Single-camera continuity remains a heuristic, not person identity. A different
person who settles into view can be acquired automatically. Persistent identity
is not promised. Continuous Archive conversion uses the same recovery policy
and identifies the first tracking break in its save message. Demonstrations and
local camera recordings retain their existing ownership.

## Implemented transport

The backend owns one controller with a latest-target slot, a dedicated 50 Hz
thread, and a single operator token. Supported connections are `mock` and
`unitree-sdk2`. ROS2 remains a preparation-only plan, not a live adapter.

The named G1 arm contract maps left motors 15–21 and right motors 22–28, using
limits from the bundled G1 EDU source URDF. Legs and waist never receive motor
PD gains from this controller. The SDK's motor 29 carries the engagement weight.
A selectable G1 23-DOF contract excludes wrist pitch/yaw; the verified intended
configuration for this task is G1 EDU 29 DOF. Model selection is operator-supplied;
the message does not cryptographically identify a particular physical robot.
Only one G1 may be reachable on the chosen DDS network/domain.

`POST /api/robot-transport/connect` returns an ownership token but does not arm or
publish motor commands. The owner authenticates `/api/robot-transport/stream` in
its first WebSocket message, keeping tokens out
of URLs. Named finite target packets carry a strictly increasing sequence and a send
timestamp aligned to the backend clock during the stream handshake. Targets
older than the watchdog bound, or implausibly in the future, are rejected; delayed
network packets cannot become fresh movement just because they arrive later.
Unknown joints, invalid packets, competing streams, or stream disconnect close
the stream and disarm its owner. An owned stream closing also disconnects its
adapter, so a browser refresh cannot leave an unreachable connection occupying
the controller. The frontend drops congested streams rather
than replaying buffered camera movement. Recordings never drive the connection.
The API routes also provide status, arm, disarm, and disconnect operations.

Status exposes the fresh camera arm target and accepted camera-frame count even
while disarmed, alongside measured positions and published command counts.
These diagnostics never seed the armed trajectory. The connection panel explains
that visualization remains a preview while disarmed and identifies ownership,
camera, stream-handshake, and measured-state blockers before explicit arming.

Arming requires fresh measured positions inside the G1 arm limits. It initializes
the commanded trajectory from those positions, clears pre-arm targets, and ramps
engagement from zero to one over two seconds. Commands encode the measured
`mode_machine`, PR mode, named q/dq, zero feedforward torque, configurable PD
gains, and the official SDK's CRC. State packets require valid CRC and increasing
32-bit ticks; duplicate/old feedback cannot refresh the watchdog. The SDK's
process-global channel factory cannot change its interface/domain without a
backend restart, which is reported explicitly instead of silently reusing it.

Default hardware bounds are 1 rad/s and 3 rad/s² (configurable up to 3 and 10,
respectively). They are application defaults requiring hardware validation,
not manufacturer-certified safe limits. The backend clips targets to joint
limits and bounds trajectory speed/acceleration, including automatic recovery.
Camera silence beyond 250 ms freezes the last commanded position and zeros dq;
new camera observations can resume automatically. These exceptional holds (including occluded channels) can
interrupt the normal acceleration bound. Missing channels hold their previous
command rather than going to browser neutral. Loss of fresh measured robot state,
publication faults, or tracking error over 1 rad disarm and send weight zero.
Browser disconnect, stop/disarm, process shutdown, and navigation away also
release the arm controller. This is SDK control release, not a certified robot
emergency stop. A remote/backend failure cannot guarantee delivery of a release
packet. Use the robot's local stop and validate its behavior during hardware tests.

The Python thread is a watchdog, not a hard real-time controller. Collision,
balance, workspace, temperature/torque limits, and robust subject identity are
not implemented here. Full-body/locomotion control remains outside this stage.

## Running on the robot network

The default stack includes physical DDS support on a Linux host:

```bash
./start-local.sh
```

Then open Camera, choose Live preview processing, open the camera, and select
Unitree DDS in Robot connection. Select G1 EDU 29 DOF, enter the Linux host's
robot-facing interface, then Connect physical robot.
Once measured state is fresh, Arm live control enables publication. Stop / disarm
releases SDK arm control; Disconnect robot closes the adapter. The UI does not
arm automatically. Speed is chosen when connecting; disconnect to change it.
The transport API accepts `domain_id` (default zero), PD gains and acceleration
settings for users needing explicit tuning.

Internet access is needed to download dependencies during the first build.
DDS then needs local reachability to the robot, the matching domain, and working
discovery/data traffic; it does not connect through an arbitrary robot IP or
through the public internet. The SDK-enabled backend uses host networking.
The frontend proxies to the host backend through `host.containers.internal`.
On Windows/WSL or a Podman virtual machine, “host” means that Linux environment;
it does not automatically expose a Windows Ethernet adapter. Run on the
robot-connected Linux machine or validate the VM's bridged/mirrored networking.
Use an isolated network containing one verified robot, with the local stop ready.

The `robot` Docker target installs SDK commit
`814556d15970dd2ecf1c9984e845ca02ab07e206` and CycloneDDS Python 0.10.2. Debian's
native CycloneDDS is used with its multiarch library exposed at the SDK installer's
expected prefix. Editable SDK installation preserves its native CRC libraries;
the upstream wheel omits them. A build-time command/CRC smoke test catches this.
`requirements-robot.txt` is also available for an existing Linux Python environment
with native CycloneDDS installed. Ordinary simulation images do not install DDS.

## Verification

Frontend unit tests cover automatic camera recovery, preview limits, connection
controls and failed-stream cleanup. Backend tests cover command bounds, ownership,
disconnect/reconnect serialization, target freshness, feedback CRC/ticks and DDS
packet fields. The browser camera journey exercises actual mock connect, arm,
publication, disarm and disconnect alongside recording and expanded preview.

The frontend suite (161 tests), backend suite (104 tests), camera browser journey
(five tests), production build and SDK-enabled image build passed. The installed official SDK serialized a 1004-byte
arm command and verified its CRC in a container with networking disabled. No
physical robot was connected or commanded. The requested code-review skill was
unavailable; manual diff review and desktop/mobile layout inspection were used.

## Sources

- [Pinned official G1 arm example](https://github.com/unitreerobotics/unitree_sdk2_python/blob/814556d15970dd2ecf1c9984e845ca02ab07e206/example/g1/high_level/g1_arm7_sdk_dds_example.py)
- [Pinned SDK channel implementation](https://github.com/unitreerobotics/unitree_sdk2_python/blob/814556d15970dd2ecf1c9984e845ca02ab07e206/unitree_sdk2py/core/channel.py)
- [Pinned SDK CRC implementation](https://github.com/unitreerobotics/unitree_sdk2_python/blob/814556d15970dd2ecf1c9984e845ca02ab07e206/unitree_sdk2py/utils/crc.py)
- [CycloneDDS 0.10.2 installer library discovery](https://github.com/eclipse-cyclonedds/cyclonedds-python/blob/0.10.2/buildhelp/cyclone_search.py)
