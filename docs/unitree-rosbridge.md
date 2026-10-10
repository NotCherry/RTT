# Jetson ROS2 WebSocket bridge

This separate diagnostic gateway runs ROS Humble and rosbridge in an ARM64 Docker
container on `unitree@192.168.123.164`. CycloneDDS uses `enP8p1s0`, domain 0 and
host networking to reach the G1. Clients use `ws://192.168.123.164:9090` instead
of participating in DDS discovery. RTT now offers **Unitree ROS bridge** in Camera.
Select it and enter the reachable Jetson WebSocket URL to use this gateway for
live arm control. Starting the gateway alone does not switch RTT's selected
transport or arm the robot. See [the acceptance guide](unitree-dds-lab.md).

The image builds Unitree's `unitree_hg` interfaces from revision
`668d1ec5a05d1c38d3306bdca7d59f2ba3581a88`. The launch allows reading `/lowstate`
and `/arm_sdk`, publishing `/arm_sdk`, and a harmless `/rtt/bridge_probe` String
topic used for transport checks. Services are limited to `/rosapi/*`; parameter
access is restricted. Starting the bridge publishes no motor commands and makes
no robot mode transitions. Host networking makes Docker port publishing unnecessary.

Copy `infra/unitree-rosbridge/` to `/home/unitree/rtt-rosbridge` on the Jetson:

```bash
cd /home/unitree/rtt-rosbridge
docker build --platform linux/arm64 -t rtt/unitree-rosbridge:humble .
docker compose up -d
docker logs --tail 30 rtt-unitree-rosbridge
```

For installations without Docker Compose:

```bash
docker run -d --name rtt-unitree-rosbridge --network host \
  --restart unless-stopped rtt/unitree-rosbridge:humble
```

The container binds the WebSocket server to the robot Ethernet address. Set
`ROSBRIDGE_ADDRESS` to another Jetson interface address when access over that
interface is needed. The CycloneDDS XML remains bound to the robot Ethernet.

From the SDK-enabled RTT backend environment, verify ten changing state ticks
and a harmless String round trip:

```bash
python tools/rosbridge_smoke_probe.py --url ws://192.168.123.164:9090
```

This probe sends no motor commands. `/arm_sdk` uses `unitree_hg/msg/LowCmd` and
`/lowstate` uses `unitree_hg/msg/LowState`. RTT's bridge adapter supplies the same
CRC, named motor encoding, ownership, bounded trajectory and watchdog as direct
DDS. Robot commands still require a valid
CRC, the correct G1 motor mapping, engagement weight, bounded movement initialized
from fresh measured state, and an appropriate robot control mode. Rosbridge is a
transport gateway; it does not provide RTT's controller ownership, trajectory
limits or watchdog. Keep motor execution in a controller that supplies those
checks. Stopping the gateway is not a motor-control release or emergency stop.

```bash
docker stop rtt-unitree-rosbridge
docker start rtt-unitree-rosbridge
```

The separate native SDK probe remains in `/home/unitree/rtt-arm-probe-20261007`.
Its previous direct test reported FSM 0 and refused movement. A working bridge
does not establish motor acceptance or resolve that physical mode discrepancy.

Sources: [ROS2 rosbridge launch parameters](https://github.com/RobotWebTools/rosbridge_suite/blob/humble/rosbridge_server/launch/rosbridge_websocket_launch.xml),
[Unitree ROS2 interfaces](https://github.com/unitreerobotics/unitree_ros2/tree/668d1ec5a05d1c38d3306bdca7d59f2ba3581a88/cyclonedds_ws/src/unitree/unitree_hg).

## Verified deployment

The Jetson container `rtt-unitree-rosbridge` is ARM64, running and healthy, with
restart policy `unless-stopped`. A PC-side WebSocket test received ten distinct
robot state ticks, measured the right elbow at 1.2930 rad, and verified String
publish/subscribe. A separate `ros2 topic echo` process inside the container also
received the PC's test message, confirming publication reaches another ROS node.
No motor commands were sent by these checks.

The backend's 118 tests passed. Shell syntax, CycloneDDS XML parsing and
`git diff --check` passed. The requested code-review skill was unavailable;
manual review covered the deployment configuration and diagnostic tool.
Glob launch arguments are deliberately quoted as YAML strings: bare bracketed
lists are inferred as arrays and prevent rosbridge startup.
