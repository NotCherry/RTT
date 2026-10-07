# Standalone G1 arm sequence probe

`apps/api/tools/arm_sequence_probe.py` bypasses the camera, browser and WebSocket.
It uses the same `RobotController`, SDK adapter, measured-state initialization,
CRC, motor mapping, gains and `rt/arm_sdk` command format as RTT.

By default it only reads state and prints a proposed sequence. It sends no motor
commands, including no release packet. For the verified G1 EDU 29 DOF, the default
sequence holds all arm joints at their newly measured positions, ramps engagement
over two seconds, moves the right elbow +0.08 rad at up to 0.05 rad/s and
0.1 rad/s², holds for one second, then returns and disarms. Other arm joints hold
their starting positions; legs and waist receive no PD gains. Starting positions
are always read again for execution; a saved report is never used to initialize
motion.

After `./start-local.sh` has built the current image, read state without movement:

```bash
podman run --rm --network host --entrypoint python localhost/rtt_backend:latest \
  tools/arm_sequence_probe.py --interface eth1
```

Physical execution requires an operator-confirmed clear arm workspace, one
verified G1 EDU 29 DOF, and the local stop ready. Review the read-only sequence
first. Stop RTT's backend to prevent another browser from arming a competing
publisher, then explicitly execute:

```bash
podman stop rtt_backend_1
podman run --rm --network host --entrypoint python localhost/rtt_backend:latest \
  tools/arm_sequence_probe.py --interface eth1 --execute --confirm-g1-29
podman start rtt_backend_1
```

The script refuses physical execution while the backend status endpoint is
reachable. It also queries the locomotion FSM and refuses to arm in FSM 0
(ZeroTorque), FSM 1 (Damp), or when the mode query fails. It never changes the
whole-body mode. Other FSM values still require measured-response validation. Configure `--backend-url` if RTT uses another address. Other DDS
publishers are not detected by this check; stop them separately. The defaults
match the inspected WSL host; on the Jetson the interface is `enP8p1s0`.

Each log row compares target, commanded and measured positions, engagement and
published packet count. A successful SDK write alone does not prove robot
acceptance. The probe aborts if feedback becomes stale, arm tracking error exceeds
0.15 rad, the loop is delayed over 100 ms, a phase takes over eight seconds, or
the selected joint fails to respond/reach its target. Abort/interrupt sends the
backend's weight-zero release; network loss may prevent its delivery.

Use `--mock --execute` to test the complete sequence without physical hardware.
`--report /path/report.json` preserves initial positions, planned sequence,
sample logs and result. Report directories must already exist. After an abort,
the robot may not have returned to its initial posture: use the local stop and
inspect it before retrying. Gains and bounds are application defaults requiring
hardware validation.

## Absolute angle test

For an explicitly authorized nearby angle, use `--target-deg 90 --no-return
--hold-seconds 3` instead of the relative displacement. Absolute targets must
remain within 0.35 rad of the newly measured starting position and within joint
limits. `--no-return` releases control after holding; it does not maintain the
pose after release. Phase time limits include travel time and the requested hold.

The October 7, 2026 physical right-elbow test published 277 packets while the
Jetson's independent DDS subscriber observed 276 packets on `rt/arm_sdk`.
Engagement reached 1. The commanded elbow rose from 1.4093 to 1.5603 rad toward
1.5708 rad, but measured position remained about 1.4094 rad. The 0.15-rad tracking
limit aborted the run and sent weight-zero release before the target/hold was
completed. RTT's backend was restored afterward.

A subsequent read-only locomotion query returned success with FSM ID 0. The
[official G1 client](https://github.com/unitreerobotics/unitree_sdk2_python/blob/master/unitree_sdk2py/g1/loco/g1_loco_client.py)
maps `ZeroTorque()` to ID 0. This is a likely acceptance blocker, rather than
proof of a transport problem.

## Native Jetson SDK test

The same probe was deployed to `/home/unitree/rtt-arm-probe-20261007` on
`192.168.123.164`. It runs with the existing Python SDK environment:

```bash
/home/unitree/Glos/repo/robot/venv/bin/python \
  /home/unitree/rtt-arm-probe-20261007/tools/arm_sequence_probe.py \
  --interface enP8p1s0 --target-deg 90 --no-return --hold-seconds 3
```

This command is read-only. Add `--execute --confirm-g1-29` only for an authorized
physical test with RTT stopped and the robot in an appropriate enabled mode.
The older Jetson SDK lacks a public `GetFsmId` method, so the preflight uses its
registered read-only API 7001. Failure responses never count as a measured mode.

The Jetson scripts `z2_trzymanie_obrot.py` and `z1_lastboss.py` publish to
`rt/arm_sdk` and explicitly set arm motor `mode=1`. RTT now matches that field
only for commanded arm joints; legs and waist remain untouched. A native test
with that correction still failed: 277 packets including releases, engagement
1, starting right elbow 1.2930 rad (74.09°), last command 1.4440 rad (82.74°),
measured elbow still 1.2930 rad. The tracking limit aborted and released control.
The mode correction alone has therefore **not** established physical movement.
The robot again returned FSM ID 0 / FSM mode 0; the balance query failed with
code 7301. No locomotion or whole-body mode transition was sent. RTT was restored.

The operator reported standing with motors enabled. Independent observation of
193 fresh `rt/sportmodestate` samples nevertheless returned FSM 0, FSM mode 0,
task ID 4. Over a subsequent two-second sample, all 1,062 downstream `rt/lowcmd`
messages had zero leg and elbow stiffness/damping, and measured arm torques were
near zero. Motor-state `mode=1` alone does not establish active posture control.
The physical mode discrepancy must be resolved using the robot's controller
before a whole-body mode change or another motor test.

A ROS Docker bridge was unnecessary for this test: the installed native SDK
received valid measured state and wrote commands directly on the Jetson. Physical
acceptance remains unresolved until an appropriate enabled robot mode is
established and a fresh measured-response test succeeds.

The correction and FSM preflight passed 118 backend tests, the SDK image build,
and `git diff --check`. The deployed Jetson read-only probe returned FSM 0 and
zero publications. The requested code-review skill was unavailable; the diff
received manual review.
