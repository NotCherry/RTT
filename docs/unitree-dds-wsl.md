# Unitree DDS measurements in WSL

These older measurements are supplemented by the
[2026-10-10 DDS lab and gateway guide](unitree-dds-lab.md). Raw local UDP tests
now reproduce payload-size-dependent loss below DDS, and RTT supports live arm
control through the Linux ROS bridge. Firewall filtering is no longer the sole
leading hypothesis; physical confirmation remains pending.

Use mirrored WSL networking and the SDK backend's host network. The interface
entered in RTT belongs to the Linux backend. In the 2026-10-13 setup,
`eth0` is wired Ethernet and `eth1` is Wi-Fi; see
[the current two-interface DDS guide](unitree-dds-ethernet-wifi.md).
The Jetson at `192.168.123.164` uses `enP8p1s0`; its robot controller is `.161`.

An SSH diagnostic received 8,313 `rt/lowstate` samples in eight seconds on the
Jetson, including left and right arm positions. A multicast diagnostic
on the local machine received no DDS multicast, and a unicast peer test also
received no state. Windows reported WSL Hyper-V default inbound blocking and
the Ethernet network profile was Public. Firewall filtering is the leading
explanation; a firewall change has not yet been applied or verified.

ROS 2 Humble is installed on the Jetson. Its topic discovery reported a
`unitree_hg/msg/LowState` publisher on `/lowstate`. The SDK can consume the
existing telemetry directly; no new ROS publisher is required. No motor commands
were sent during these diagnostics.

## Apply a restricted firewall rule

Open **Windows PowerShell as Administrator** from this repository and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\infra\allow-unitree-dds.ps1
```

Defaults allow inbound UDP ports 7400–65535 from `.161` and `.164`, destined for
local `.200` or DDS multicast `239.255.0.1`. The Windows rule is restricted to
`Ethernet`; the Hyper-V rule belongs to WSL. Default firewall policies remain
intact. The unicast range covers CycloneDDS's ephemeral ports. Adjust
`-LocalAddress`, `-RobotAddresses`, or `-InterfaceAlias` if your wiring differs.
Use `-WhatIf` to inspect the action and `-Remove` to remove these two rules.

Keep RTT disarmed and check `/api/robot-transport/status`: `state_fresh` should
become true and `measured` should contain arm joint positions. If it stays empty,
repeat a read-only state subscription and inspect effective firewall policy;
the rule's creation alone does not confirm packet delivery. Do not start the
SDK arm-motion examples to diagnose missing measurements.

[Microsoft's WSL networking guide](https://learn.microsoft.com/windows/wsl/networking)
documents mirrored networking and the separate Hyper-V firewall.
[Unitree's ROS 2 setup](https://github.com/unitreerobotics/unitree_ros2)
documents interface selection and the read-only state examples.
