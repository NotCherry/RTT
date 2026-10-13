# Direct Ethernet DDS and native DDS over Wi-Fi

## Evidence

On 2026-10-13, Windows Ethernet and WSL `eth0` were `192.168.123.200`;
Wi-Fi and WSL `eth1` were `192.168.67.87`. The Jetson had wired `.123.164`
and Wi-Fi `.67.95`. The active Windows and Hyper-V DDS rules allowed only
the Wi-Fi pair. Adding independent scoped rules restored direct, CRC-validated
G1 state over Ethernet with multicast enabled. Disabling multicast did not
receive the robot's multicast state, even with explicit peers.

Harmless DDS request/reply tests passed over both interfaces. Ethernet also
passed with 2,092-byte DDS payloads. A raw Ethernet UDP receiver received the
robot's reassembled 2,180-byte multicast payloads. The older local-loopback UDP
size failure still reproduces, but does not establish failure for physical
fragmented multicast packets after the firewall correction.

Wi-Fi DDS connectivity alone does not expose the robot's wired-only state
publisher. A native Linux relay delivered live, CRC-validated G1 state over
the Jetson's Wi-Fi interface to RTT's unchanged Unitree SDK adapter.

## Decision

Keep direct Ethernet on robot domain 0. Add an explicit native DDS relay
between robot domain 0 on the Jetson's wired interface and client domain 7 on
its Wi-Fi interface. Domain 7 stays separate from the simulator lab's default
domain 42. Retain the ROS bridge as an independent optional transport.

The relay forwards complete official Unitree types without rewriting CRC or
motor fields. State requires a valid CRC, finite arm positions and advancing
ticks. Latest-sample queues and 1,400-byte DDS packets bound buffering and
avoid oversized generated UDP datagrams. Command forwarding is opt-in,
checks DDS source age, CRC, arm-only motor fields, gains, limits, mode and
engagement weight. Motion requires state received within 250 ms; a zero-weight
release can still pass after state expires. Startup sends no motor commands.

RTT retains ownership, explicit arming, trajectory bounds and watchdog.
The relay is not an authenticated controller or a robot-side watchdog.
Use one intended G1 EDU 29 DOF and one controller on an isolated DDS network.
A broken path can prevent release delivery. No automatic fallback occurs.

Expose domain, peers and multicast in Camera. The process-global SDK factory
still requires a backend restart before changing DDS network settings.
Firewall rules use separate names so configuring Wi-Fi preserves Ethernet.
The native relay is managed by systemd with startup on boot and failure restart.

## Verification scope

Real DDS integration tests protect state CRC, read-only startup, arm command
forwarding, leg rejection, stale state and release behavior. Physical checks
observe changing measured state and harmless bidirectional diagnostic topics;
motor acceptance and physical movement remain untested. See
[the deployment guide](../unitree-dds-ethernet-wifi.md) for current settings.
