# DDS diagnostics and G1 control through a Linux gateway

## Evidence

On 2026-10-10, the robot was unavailable. A plain UDP size probe reproduced
packet loss on this mirrored WSL host, both directly and in host-network Podman:
in the latest run, tested payloads through 1,472 bytes arrived; tested larger
payloads through 4,096 bytes did not. An earlier container run delivered
2,092-byte payloads, so the threshold is not established universally. The same local
probe on native Windows received every tested size. This isolates a networking
failure below DDS and outside RTT. It does not identify the exact
Windows/Hyper-V/kernel component or prove the physical failure had only this cause.

Two pinned SDK processes on WSL discovered each other but did not receive the
approximately 2 KiB G1 state datagrams. Limiting generated UDP payloads to
1,400 bytes and DDS fragments to 1,200 bytes made the same controller/simulator
pass motion, return, CRC, release, and state-loss checks. Receiver configuration
cannot force an existing robot publisher to fragment its packets.

The SDK constructs its Domain with explicit XML, bypassing CYCLONEDDS_URI as a
configuration source. Its default trace path also prevented native Windows
initialization. Native Windows CycloneDDS 11.0.1 passed a harmless DDS round trip,
but G1 DDS interoperability with this unpinned version was not established.

## Decision

Retain direct DDS, with explicit interface/domain/discovery configuration and
smaller packets. Expose IPv4 peers and multicast selection in the backend
contract. Changing these process-global settings requires restart. Supply the
pinned SDK's XML template during initialization under the existing factory lock,
restoring the original afterward. Keep SDK/DDS versions pinned.

Add `unitree-rosbridge` as an arm adapter using the existing native Linux Jetson
gateway in `infra/unitree-rosbridge/`. RTT exchanges `/lowstate` and `/arm_sdk`
over a WebSocket while DDS stays on Linux. Camera exposes this choice alongside
mock and direct DDS. No automatic fallback occurs.

The adapter requires complete ROS messages, exact array sizes, finite values,
official CRC and advancing ticks. It shares direct DDS's command builder,
motor mapping, mode fields, engagement and CRC. Ownership, explicit arming,
speed/acceleration limits, latest-target handling and watchdog remain in the
existing controller. Connect subscribes/advertises without motor commands.
Receive buffering is limited and publication has a bounded deadline.
Connection loss invalidates measured state and the controller disarms.

Gateway acceptance does not prove physical motor acceptance. A network/backend
failure may prevent release delivery, as with direct DDS. There is no new
robot-side motion watchdog. Robot mode, local stop behavior, one intended robot
and absence of competing controllers still require on-site verification.

## Verification scope

Protocol simulators use official Unitree types and CRC, without physics,
firmware, balance or collision behavior. The DDS lab defaults to loopback and
refuses domain zero. The WebSocket simulator has no DDS motor publisher.
Tests cover missing/corrupt/repeated state, ignored commands, connection loss,
measured simulated motion and release. A native Windows simulator exercised
the complete controller across the Windows/WSL boundary over WebSockets.

See [the DDS lab guide](../unitree-dds-lab.md) for evidence and hardware acceptance.

## Sources

- [Microsoft mirrored networking and Hyper-V firewall](https://learn.microsoft.com/en-us/windows/wsl/networking)
- [Pinned Unitree channel factory](https://github.com/unitreerobotics/unitree_sdk2_python/blob/814556d15970dd2ecf1c9984e845ca02ab07e206/unitree_sdk2py/core/channel.py)
- [CycloneDDS packet and fragment configuration](https://github.com/eclipse-cyclonedds/cyclonedds/blob/0.10.5/src/core/ddsi/include/dds/ddsi/ddsi_cfgelems.h)
- [ROS bridge protocol](https://github.com/RobotWebTools/rosbridge_suite/blob/ros2/ROSBRIDGE_PROTOCOL.md)
