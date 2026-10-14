"""G1 motor contracts and deterministic, bounded command trajectories."""
import math
from pathlib import Path
import xml.etree.ElementTree as ET

ARM_INDICES = {
    f"{side}_{joint}_joint": start + offset
    for side, start in [("left", 15), ("right", 22)]
    for offset, joint in enumerate(["shoulder_pitch", "shoulder_roll", "shoulder_yaw", "elbow", "wrist_roll", "wrist_pitch", "wrist_yaw"])
}
WAIST_INDICES = {"waist_yaw_joint": 12, "waist_roll_joint": 13, "waist_pitch_joint": 14}
UPPER_BODY_INDICES = {**ARM_INDICES, **WAIST_INDICES}
_ROOT = ET.parse(Path(__file__).parent / "assets/unitree_g1/g1_29dof_mode_11.source.urdf").getroot()
ARM_LIMITS = {
    j.attrib["name"]: (float(j.find("limit").attrib["lower"]), float(j.find("limit").attrib["upper"]))
    for j in _ROOT.findall("joint") if j.attrib["name"] in ARM_INDICES
}
UPPER_BODY_LIMITS = {
    j.attrib["name"]: (float(j.find("limit").attrib["lower"]), float(j.find("limit").attrib["upper"]))
    for j in _ROOT.findall("joint") if j.attrib["name"] in UPPER_BODY_INDICES
}
UPPER_BODY_SPEEDS = {
    j.attrib["name"]: float(j.find("limit").attrib["velocity"])
    for j in _ROOT.findall("joint") if j.attrib["name"] in UPPER_BODY_INDICES
}
WAIST_TARGET_LIMITS = {"waist_yaw_joint": (-.6, .6), "waist_roll_joint": (-.2, .2), "waist_pitch_joint": (-.25, .25)}


def controlled_names(config):
    names = arm_names(config.robot_model)
    if config.control_mode != "arms":
        names += list(WAIST_INDICES)[:config.waist_dof]
    return names


def target_names(config):
    names = controlled_names(config)
    if config.control_mode == "single-arm":
        names = [name for name in names if name.startswith(config.active_arm + "_")]
    return names


def camera_joint_contract(config):
    """Use the physical model's geometry even when a different preview is open."""
    names = controlled_names(config)
    result = []
    for joint in _ROOT.findall("joint"):
        name = joint.attrib["name"]
        if name not in names:
            continue
        origin = joint.find("origin")
        result.append({"name": name, "type": joint.attrib["type"],
                       "parent": joint.find("parent").attrib["link"], "child": joint.find("child").attrib["link"],
                       "axis": [float(value) for value in joint.find("axis").attrib["xyz"].split()],
                       "origin": {field: [float(value) for value in origin.attrib.get(field, "0 0 0").split()]
                                  for field in ("xyz", "rpy")},
                       "lower": UPPER_BODY_LIMITS[name][0], "upper": UPPER_BODY_LIMITS[name][1],
                       "velocity": UPPER_BODY_SPEEDS[name],
                       "controllable": True})
    return result


def advance_upper_body(positions, velocities, target, dt, speed, acceleration):
    arms = {name: q for name, q in positions.items() if name in ARM_INDICES}
    waist = {name: q for name, q in positions.items() if name in WAIST_INDICES}
    waist_target = {name: max(WAIST_TARGET_LIMITS[name][0], min(WAIST_TARGET_LIMITS[name][1], q))
                    for name, q in target.items() if name in waist}
    arm_q, arm_v = advance_motion(arms, velocities, target, dt, speed, acceleration)
    waist_q, waist_v = advance_motion(waist, velocities, waist_target, dt, min(speed, .5), min(acceleration, 1))
    return {**arm_q, **waist_q}, {**arm_v, **waist_v}


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
        lo, hi = UPPER_BODY_LIMITS[name]
        desired = max(lo, min(hi, target.get(name, q)))
        error = desired - q
        desired_v = math.copysign(min(speed, UPPER_BODY_SPEEDS[name], math.sqrt(2 * acceleration * abs(error))), error) if error else 0.0
        v = velocities.get(name, 0.0)
        v += max(-acceleration * dt, min(acceleration * dt, desired_v - v))
        # Exact arrival is allowed only when the required velocity is reachable.
        if abs(error) < abs(v * dt) and error * v >= 0 and abs(error / dt - velocities.get(name, 0)) <= acceleration * dt:
            v = error / dt
        achieved = max(lo, min(hi, q + v * dt))
        next_q[name] = achieved
        next_v[name] = (achieved - q) / dt
    return next_q, next_v
