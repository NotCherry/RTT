"""G1 motor contracts and deterministic, bounded command trajectories."""
import math
from pathlib import Path
import xml.etree.ElementTree as ET

ARM_INDICES = {
    f"{side}_{joint}_joint": start + offset
    for side, start in [("left", 15), ("right", 22)]
    for offset, joint in enumerate(["shoulder_pitch", "shoulder_roll", "shoulder_yaw", "elbow", "wrist_roll", "wrist_pitch", "wrist_yaw"])
}
_ROOT = ET.parse(Path(__file__).parent / "assets/unitree_g1/g1_29dof_mode_11.source.urdf").getroot()
ARM_LIMITS = {
    j.attrib["name"]: (float(j.find("limit").attrib["lower"]), float(j.find("limit").attrib["upper"]))
    for j in _ROOT.findall("joint") if j.attrib["name"] in ARM_INDICES
}


def arm_names(model: str):
    return [name for name in ARM_INDICES if model != "g1-23" or not name.endswith(("wrist_pitch_joint", "wrist_yaw_joint"))]


def advance_motion(positions, velocities, target, dt, speed, acceleration):
    """Limit commanded speed and acceleration; URDF boundaries override trajectory."""
    dt = max(0.0, min(dt, 0.04))
    if not dt:
        return dict(positions), dict(velocities)
    next_q, next_v = {}, {}
    for name, q in positions.items():
        if name not in target:
            next_q[name], next_v[name] = q, 0.0
            continue
        lo, hi = ARM_LIMITS[name]
        desired = max(lo, min(hi, target.get(name, q)))
        error = desired - q
        desired_v = math.copysign(min(speed, math.sqrt(2 * acceleration * abs(error))), error) if error else 0.0
        v = velocities.get(name, 0.0)
        v += max(-acceleration * dt, min(acceleration * dt, desired_v - v))
        # Exact arrival is allowed only when the required velocity is reachable.
        if abs(error) < abs(v * dt) and error * v >= 0 and abs(error / dt - velocities.get(name, 0)) <= acceleration * dt:
            v = error / dt
        achieved = max(lo, min(hi, q + v * dt))
        next_q[name] = achieved
        next_v[name] = (achieved - q) / dt
    return next_q, next_v
