# G1 DDS and Windows/WSL transport lab

Windows can remain the desktop OS. Prefer **Unitree ROS bridge** in RTT for the
next hardware test: DDS runs on the existing native Linux Jetson, with measured
state and bounded arm commands carried to RTT over WebSockets. Direct DDS remains
available, but a successful ping or small DDS message is insufficient on this WSL setup.

## Findings from 2026-10-10

The robot was absent; Ethernet was disconnected, Wi-Fi was `192.168.50.158`,
and WSL used mirrored networking. The effective DDS firewall rule still allowed
the previous Wi-Fi pair `192.168.67.87 ↔ 192.168.67.95`, not today's addresses.

| Test | Observed result |
| --- | --- |
| Raw local UDP in WSL, without DDS or Podman | Latest run: all tested sizes through 1,472 bytes arrive; tested larger sizes drop |
| Same probe in host-network Podman | Latest run: same losses, including 2,180-byte payloads |
| Same probe in native Windows | All seven sizes arrive, three times each |
| Harmless Windows → WSL → Windows DDS with explicit localhost peers | 91 distinct round trips |
| Pinned G1 DDS state, independent WSL processes, large datagrams | No fresh state; no commands sent |
| Same protocol/controller, generated UDP payload cap 1,400 bytes | Motion, return, CRC, release and stale-state disarm pass |
| Invalid CRC, frozen ticks or missing state | Arming blocked; zero motor commands |
| Commands deliberately ignored | Probe detects absent measured motion and releases control |
| Native Windows G1 WebSocket simulator → WSL RTT | 439 commands accepted, zero rejected, two releases; motion and return pass |

The [saved experiment results](research/dds-lab-2026-10-10.json) include UDP
delivery counts, controller outcomes, simulator acceptance and fault checks.

The UDP drop is demonstrated below DDS. An earlier container run delivered
2,092-byte payloads, so this is not proven to be a universal size threshold.
Its exact lower-level cause is not established. Fragmentation helps the pinned SDK, but RTT cannot force the physical
robot's state publisher to fragment. The Linux gateway supplies the practical
path around this issue. An earlier Jetson test also reported FSM 0 (ZeroTorque),
an independent reason for command rejection. Networking success does not resolve mode.

Windows CycloneDDS 11.0.1 worked for the small diagnostic topic. G1 DDS tests with
that version failed, including a mixed-version native crash. Do not replace RTT's
pinned DDS with it as a hardware fix. It is only used for Windows diagnostics below.

## Local G1 DDS lab

From the repository root:

```bash
./start-local.sh
podman exec rtt_backend_1 python tools/dds_control_lab.py
podman exec rtt_backend_1 python tools/dds_control_lab.py --fault invalid-crc
podman exec rtt_backend_1 python tools/dds_control_lab.py --fault frozen-tick
podman exec rtt_backend_1 python tools/dds_control_lab.py --fault no-state
podman exec rtt_backend_1 python tools/dds_control_lab.py --fault ignore-commands
```

Each invocation creates an independent simulated publisher/subscriber on
loopback/domain 42, then shuts it down. Each runs in a new process to isolate the
SDK factory. The normal run checks read-only feedback, a measured-start 0.08-rad
elbow displacement and return, engagement ramp, received zero-weight release,
and disarming when the simulator stops. Fault runs succeed only when the expected
failure is detected. `--report /tmp/lab.json` saves structured evidence.

These are protocol simulations, not physics or firmware validation. Do not run
the control lab against a physical bridge: it intentionally publishes the
simulated motion sequence. Hardware testing uses explicit Arm in RTT or the
separately guarded [standalone probe](standalone-arm-probe.md).

Inspect packet-size loss independently:

```bash
podman exec rtt_backend_1 python tools/udp_payload_probe.py
```

`packet_loss` and exit code 1 report measured loss. This tool uses local UDP only,
without DDS, robot traffic, firewall changes or network configuration changes.

## Native Windows diagnostics

Use a separate Python 3.12 environment in PowerShell. Git and Python must already
be installed. This does not replace RTT's Linux SDK environment.

```powershell
$lab = Join-Path $env:LOCALAPPDATA 'RTT-dds-lab'
py -3.12 -m venv $lab
$python = Join-Path $lab 'Scripts\python.exe'
& $python -m pip install cyclonedds==11.0.1 numpy 'pydantic>=2.10,<3' websockets==15.0.1
git clone https://github.com/unitreerobotics/unitree_sdk2_python.git "$lab\sdk"
git -C "$lab\sdk" checkout 814556d15970dd2ecf1c9984e845ca02ab07e206
& $python -m pip install --no-deps -e "$lab\sdk"
& $python apps\api\tools\udp_payload_probe.py
```

The SDK uses its official Python CRC on Windows. `--no-deps` keeps the isolated
diagnostic environment on the available Windows DDS wheel; that DDS version is
not approved for physical G1 control.

In WSL, start the harmless echo:

```bash
podman exec rtt_backend_1 python tools/dds_network_probe.py echo \
  --interface lo --peer 127.0.0.1 --duration 30
```

Then in PowerShell:

```powershell
& $python apps\api\tools\dds_network_probe.py client --interface 127.0.0.1 --peer 127.0.0.1
```

Require at least five distinct messages on both sides. Swap echo/client to test
the opposite direction. To compare multicast and unicast on a real LAN, put the
echo on the friend's Ubuntu host. Select its active LAN interface and domain 42.
Run the WSL client on its active LAN interface; omit `--peer` for multicast,
then repeat with the friend's numeric IPv4 as peer. Both hosts must allow the
probe's UDP traffic. Localhost does not test the access point or remote firewall.

## Complete gateway simulation

In PowerShell, from this repository:

```powershell
& $python apps\api\tools\g1_rosbridge_simulator.py --duration 120 --report "$lab\bridge.json"
```

In WSL:

```bash
podman exec rtt_backend_1 python tools/dds_control_lab.py \
  --external-simulator --rosbridge-url ws://127.0.0.1:19090
```

This exchanges complete Unitree messages across the OS boundary over TCP and
checks CRC, measured simulated motion and return. The Windows report must show
accepted commands, zero rejected packets and release. With no other controller
attached, inspect this simulator through Camera → **Unitree ROS bridge**, URL
`ws://127.0.0.1:19090`. Connect remains disarmed. The simulator supports the same
`--fault` flags as DDS, plus `--drop-after 5` for connection-loss testing.

## Physical acceptance next week

1. Verify the Jetson's existing `rtt-unitree-rosbridge` container is healthy.
   Its DDS interface remains robot-facing `enP8p1s0`. Use the current reachable
   Jetson address; the wired default is `192.168.123.164:9090`.
2. From RTT's robot image, run `python tools/rosbridge_smoke_probe.py --url
   ws://CURRENT_JETSON_IP:9090`. Require changing state ticks and the harmless
   String round trip. This sends no motor commands. If TCP fails, resolve
   addressing/firewall/bridge health before arming.
3. In Camera choose **Unitree ROS bridge**, that URL, G1 EDU 29 DOF and initially
   0.5 rad/s. Connect. Require fresh measured arms, zero motor packets, a ready
   live target stream, and no competing controller.
4. Verify an enabled robot mode locally: the previous FSM 0 test remains
   unresolved. With the local stop ready, explicitly Arm, make a small arm
   movement and compare **Measured** to **Commanded**. A rising packet count
   alone is insufficient. Stop/disarm and confirm actual release.
5. Under supervision, check tracking loss, browser disconnect and state loss.
   RTT disarming does not prove release arrived over a broken network. Record
   physical behavior and use the robot's local stop when needed.

For direct DDS comparison, run the read-only standalone probe on the friend's
Ubuntu and this WSL machine, on the same access point/domain and pinned SDK:

```bash
python tools/arm_sequence_probe.py --interface ACTIVE_LINUX_INTERFACE --report read-only.json
```

Repeat with `--peer ROBOT_IP --no-multicast` to isolate multicast discovery.
Without `--execute`, the probe publishes no motor commands. Refresh the scoped
firewall rule with current addresses/interface using [the firewall guide](unitree-dds-wsl.md).
If Ubuntu gets fresh state while WSL does not, retain the gateway and capture
sender packet sizes on native Linux for comparison.

## Verification and limits

148 backend tests, 164 frontend tests, production build and seven camera browser
journeys passed, including desktop/mobile bridge layout and adjacent recording,
playback and mock-control flows. Live DDS fault tests and native Windows gateway
simulation passed. The code-review skill was unavailable; manual diff review
and screenshot inspection were used. See [ADR 0005](adr/0005-dds-network-diagnostics-and-rosbridge-control.md).

No robot, real robot access point or Jetson connection was available. Physical
motion acceptance, firmware compatibility, balance and collision safety remain
on-site checks.
