"""Observed reference/command/feedback differences; never a control input."""
from .robot_motion import UPPER_BODY_LIMITS, WAIST_TARGET_LIMITS, UPPER_BODY_SPEEDS


def motion_diagnostics(config, reference, target, commanded, measured, velocities, accelerations):
    joints = {}
    for name, q in commanded.items():
        waist = name.startswith("waist_")
        speed = min(config.max_joint_speed, UPPER_BODY_SPEEDS[name], .5 if waist else float("inf"))
        acceleration = min(config.max_joint_acceleration, 1 if waist else float("inf"))
        low, high = WAIST_TARGET_LIMITS[name] if waist else UPPER_BODY_LIMITS[name]
        desired = target.get(name)
        joints[name] = {
            "reference": reference.get(name), "target": desired, "commanded": q,
            "measured": measured.get(name), "velocity": velocities.get(name, 0),
            "command_error": q-reference[name] if name in reference else None,
            "tracking_error": measured[name]-q if name in measured else None,
            "reference_error": measured[name]-reference[name] if name in measured and name in reference else None,
            "speed_limit": speed, "acceleration_limit": acceleration,
            "command_acceleration": accelerations.get(name, 0),
            "acceleration_limited": desired is not None and abs(desired-q) > .01 and abs(accelerations.get(name, 0)) >= acceleration*.99,
            "range_limited": desired is not None and not low <= desired <= high,
            "speed_limited": desired is not None and abs(desired-q) > .01 and abs(velocities.get(name, 0)) >= speed*.99,
        }
    return joints
