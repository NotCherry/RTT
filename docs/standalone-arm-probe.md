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
reachable. Configure `--backend-url` if RTT uses another address. Other DDS
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
