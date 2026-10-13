# Single-arm torso holding and camera upper-body control

The operator confirmed physical arm motion works after ADR 0008, then requested
one-arm mapping with a held torso and a separate upper-body mode. They confirmed
all three waist axes are movable on this G1 EDU. This supersedes the arm-only
motor boundary in ADR 0004 and ADR 0007; legs and locomotion remain excluded.

## Decision

Reuse Mapping scope as the source of truth for camera and hardware control.
Single arm selects the person's left or right arm. On explicit arming, fresh
measured positions initialize both arms and the available waist joints. Only
the selected arm receives camera targets; the remaining commanded joints hold
those initial positions with zero velocity and active PD gains. Re-arming takes
a new measured baseline. This holds waist joint angles, not global balance.

Upper body maps both arms and available waist yaw, roll and pitch. Existing
retargeting geometry uses shoulder/hip landmarks; yaw and pitch need world/depth
landmarks. Missing channels retain their last command. Full body remains a
preview/Archive profile; its hardware targets exclude legs. Disconnect before
changing mapping scope or waist axes so an engaged joint cannot silently drop
out of the connection contract.

Waist indices are 12, 13, 14, following the pinned official
[G1 arm example](https://github.com/unitreerobotics/unitree_sdk2_python/blob/814556d15970dd2ecf1c9984e845ca02ab07e206/example/g1/high_level/g1_arm7_sdk_dds_example.py).
Use PR commands on `rt/arm_sdk`, measured mode_machine, valid CRC and the same
engagement ramp/release. Waist PD defaults are kp=40, kd=2; arm gains retain
the API's existing defaults. The operator also requested stronger arms for
overhead poses. New UI connections default to Strong (kp=60, kd=1.5), matching
the pinned SDK example, with Gentle (20) and Firm (40) alternatives. Gain
selection does not change speed, acceleration, engagement ramp or manufacturer
motor limits and does not guarantee an overhead pose. Disconnect to change it.
Waist motion is capped at 0.5 rad/s and 1 rad/s², additionally
bounded by the configured arm limits. Camera waist targets clamp to ±0.6 rad
yaw, ±0.2 roll and ±0.25 pitch within the URDF joint limits. A held measured
angle is preserved rather than abruptly forcing it inside the camera range.
These are application defaults that require operator hardware validation.

The API preserves legacy `arms` for existing clients. New UI connections choose
`single-arm` or `upper-body`, with a selectable one-axis or three-axis waist.
The current UI defaults to the operator-confirmed three-axis hardware. One-axis
contracts never read or command mechanically locked roll/pitch motors.

The Wi-Fi relay explicitly configures its allowed waist axes and validates
optional waist packets with the same joint/gain bounds and a 0.5 rad/s limit.
Leg commands still fail validation. Startup never commands or arms the robot.
DDS process isolation, ownership, stale-state/target checks, tracking-error
release and cancellation cleanup from ADR 0008 continue to apply.

## Verification

Focused tests cover measured torso/other-arm holding, left/right selection,
re-arming baselines, missing axes, independent waist bounds, motor encoding,
locked-axis rejection, relay validation and camera target filtering. Browser
journeys exercise both modes through the authenticated mock controller and
check the controls at desktop/mobile sizes. Protocol simulations validate
waist commands and releases without moving physical hardware. Physical
acceptance of the new torso modes remains an operator check.

On 2026-10-13, all 180 backend tests passed, including real DDS process
simulations of left-arm, right-arm and three-axis upper-body control. Frontend
unit tests, production build and all 11 camera browser journeys passed.
Desktop/mobile screenshots were inspected against the existing system styles.
The code-review skill was unavailable; the complete change was manually reviewed,
including model-specific locked-axis rejection and the actual camera callback.

The canonical stack and native Jetson relay were deployed with `WAIST_DOF=3`.
Read-only probes received all 17 joints over eth0/domain 0 and eth1/domain 7,
including finite CRC-validated waist yaw, roll and pitch; neither probe published
motor commands. The operator had confirmed physical arm control before this
change, while torso holding/mapping and overhead strength remain to be checked
on the physical robot after reconnecting with the new configuration.
