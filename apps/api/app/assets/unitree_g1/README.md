# Unitree G1 bundled examples

These source URDF descriptions are vendored from the official
[`unitreerobotics/unitree_ros`](https://github.com/unitreerobotics/unitree_ros)
repository at commit `7d6075f7f58588b189b940130e3edab3c839b2df`:

- `g1_23dof_mode_10.source.urdf` — G1 Basic, 23 controllable joints
- `g1_29dof_mode_11.source.urdf` — G1 EDU, 29 controllable joints

The files are distributed under Unitree's BSD 3-Clause License, reproduced in
`LICENSE.unitree_ros`. The workbench replaces their mesh references at load
time with small primitive boxes. This retains the upstream kinematics, joint
limits, and inertial values while keeping the product's primitive-only upload
and rendering boundary intact.
