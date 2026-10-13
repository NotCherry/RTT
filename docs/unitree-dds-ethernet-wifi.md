# G1 DDS on Ethernet and Wi-Fi

The 2026-10-13 setup uses DDS for both paths. Ethernet reaches the robot directly;
Wi-Fi uses a native DDS relay on the Jetson, without WebSockets.

In Camera select **Unitree DDS**, G1 EDU 29 DOF, then use:

| Setting | Direct Ethernet | Jetson Wi-Fi DDS relay |
| --- | --- | --- |
| Backend interface | `eth0` | `eth1` |
| DDS domain | `0` | `7` |
| Discovery peer | optional | `192.168.67.95` |
| Multicast | enabled | disabled, explicit peer |

Interface names and addresses describe the inspected host, not a universal
mapping. Inspect `ip -br address` in the backend host after networking changes.
Disconnect and restart the backend (`podman restart rtt_backend_1`) before
changing DDS interface/domain/discovery settings. Connect stays disarmed and
**Measured and commanded arm positions** shows fresh measured arms without
opening a camera. Keep motor control disarmed for transport diagnosis.

## Independent Windows and WSL firewall rules

Run in an elevated PowerShell from the repository root:

```powershell
./infra/allow-unitree-dds.ps1 -RuleName RTT-Unitree-DDS-Ethernet
./infra/allow-unitree-dds.ps1 -LocalAddress 192.168.67.87 -RobotAddresses 192.168.67.95 -InterfaceAlias Wi-Fi -RuleName RTT-Unitree-DDS-WiFi
```

Each named rule scopes Windows and Hyper-V inbound UDP to its interface/local
address and intended peers, preserving default policies and the other rule.
Use `-WhatIf` to preview, or the same `-RuleName` with `-Remove` to remove it.
Refresh addresses when changing networks. The old `RTT-Unitree-DDS-Inbound`
rule remains supported; configuring two paths with that same name overwrites
the earlier configuration.

## Native Jetson relay deployment

The inspected Jetson is `unitree@192.168.123.164` on wired `enP8p1s0`, with
Wi-Fi `wlx782288b51bc4` at `192.168.67.95`. Its existing SDK environment is
`/home/unitree/Glos/repo/robot/venv/bin/python` (CycloneDDS Python 0.10.2).
For a new host, install the pinned `apps/api/requirements-robot.txt` in a
native Linux environment with CycloneDDS; do not use an unpinned Windows wheel.

Copy these files into `/home/unitree/rtt-dds-relay`, preserving paths:

- `apps/api/app/robot_dds_relay.py` → `app/robot_dds_relay.py`
- `apps/api/app/robot_dds_network.py` → `app/robot_dds_network.py`
- `apps/api/app/robot_motion.py` → `app/robot_motion.py`
- `apps/api/app/assets/unitree_g1/g1_29dof_mode_11.source.urdf` → `app/assets/unitree_g1/g1_29dof_mode_11.source.urdf`
- `apps/api/tools/unitree_dds_relay.py` → `tools/unitree_dds_relay.py`
- `infra/unitree-dds-relay/start-relay.sh` → `start-relay.sh`
- `infra/unitree-dds-relay/relay.env.example` → `relay.env`
- `infra/unitree-dds-relay/rtt-unitree-dds-relay.service` → `rtt-unitree-dds-relay.service`

Edit `relay.env` for that host's interfaces, SDK environment and client address.
The template defaults `FORWARD_COMMANDS=false`, which supplies telemetry only.
Set it to `true` only to enable RTT's explicitly armed return command path.
The deployed service uses `true`; connect/startup still sends no motor commands.

```bash
cd /home/unitree/rtt-dds-relay
sudo install -m 600 relay.env /etc/rtt-unitree-dds-relay.env
sudo install -m 644 rtt-unitree-dds-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rtt-unitree-dds-relay
systemctl status rtt-unitree-dds-relay --no-pager
cat /run/rtt-unitree-dds-relay/status.json
```

Require rising `states_forwarded`, `state_fresh=true`, and zero
`commands_forwarded` while disarmed. The relay forwards `rt/lowstate` from
domain 0 to domain 7, and validated `rt/arm_sdk` from domain 7 to domain 0.
It never republishes state to its source domain, avoiding feedback loops.
Do not run hardware control labs on domain 7.

## Read-only acceptance

```bash
podman exec rtt_backend_1 python tools/arm_sequence_probe.py --interface eth0 --report /tmp/ethernet-state.json
podman exec rtt_backend_1 python tools/arm_sequence_probe.py --interface eth1 --domain 7 --peer 192.168.67.95 --no-multicast --report /tmp/wifi-state.json
```

Do not add `--execute`. These independent processes avoid SDK factory binding
conflicts and must report advancing validated state and zero motor packets.
The standalone probe also tries robot FSM RPC: it succeeded with FSM 0 on
direct Ethernet and failed through the Wi-Fi relay, which intentionally forwards
only state and arm command topics. The app's measured state still works.

Harmless DDS request/reply probes on a separate diagnostic domain establish
bidirectional networking without sending motor commands. Simulated relay tests
establish command encoding/forwarding; neither proves physical motor acceptance.
The observed FSM 0 remains a reason not to execute a physical motion probe.

The relay rejects commands whose DDS source timestamp is older than 250 ms or
over 100 ms in the future. Synchronize the PC/WSL and Jetson clocks. On this
host Windows Time was stopped and the PC lagged about 0.78 seconds; enabling
Windows Time and synchronizing with `0.pool.ntp.org` corrected the offset.
Do not relax timestamp rejection to hide clock drift.

## Current evidence and limits

After separate firewall rules, Ethernet obtained fresh G1 arm state with
multicast enabled. Ethernet request/reply received 79 unique messages of 79
sent for both 64-byte and 2,092-byte diagnostic payloads. Wi-Fi received 78 of
79 for a 64-byte diagnostic payload. The DDS relay subsequently supplied fresh
CRC-validated state for all 14 arms over Wi-Fi with zero forwarded commands.

Cross-machine simulated G1 tests passed measured motion, return and release on
Ethernet (domain 83) and through the Wi-Fi relay (domains 81 → 82). The Jetson
simulators accepted 439 and 435 commands respectively, rejected zero, and each
observed two releases. The hardware relay on domain 7 stayed at zero forwarded
commands throughout; no physical motion was commanded.

157 backend tests, 186 frontend tests, production build and nine camera browser
journeys passed. The Alpine frontend image lacks Xvfb; browser journeys ran in
the existing official Cypress image. The code-review skill was unavailable;
manual diff review addressed hardware/lab domain isolation and command age.

Raw local-loopback UDP still loses tested payloads above 1,472 bytes. Raw
physical Ethernet successfully receives the robot's reassembled 2,180-byte
multicast datagrams, so loopback loss should not be treated as proof that
physical DDS is broken. The old findings are retained in
[the previous lab guide](unitree-dds-lab.md).
