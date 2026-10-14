"""Offline comparison of timestamped controller observations, outside its lock."""
from bisect import bisect_right
import math


def _delay(samples, name, reference, following):
    points = [(sample["server_time_ms"], sample["joints"][name]) for sample in samples if name in sample["joints"]]
    points = [(time, joint) for time, joint in points if joint.get(reference) is not None and joint.get(following) is not None]
    if len(points) < 25 or max(j[reference] for _, j in points)-min(j[reference] for _, j in points) < .1:
        return None
    times = [t for t, _ in points]
    errors = []
    for delay in range(0, 501, 20):
        squared = []
        for time, joint in points:
            if time-times[0] < 500:
                continue
            index = bisect_right(times, time-delay)-1
            if index >= 0:
                squared.append((joint[following]-points[index][1][reference])**2)
        if squared:
            errors.append((sum(squared)/len(squared), delay))
    return min(errors)[1] if errors else None


def analyze_motion(samples):
    steady = [sample for sample in samples if sample["armed"] and sample["engagement"] >= .99]
    result = {}
    for name in {name for sample in steady for name in sample["joints"]}:
        errors = [abs(sample["joints"][name]["reference_error"]) for sample in steady
                  if name in sample["joints"] and sample["joints"][name]["reference_error"] is not None]
        errors.sort()
        result[name] = {"compared_samples": len(errors),
                        "mean_absolute_error_rad": sum(errors)/len(errors) if errors else None,
                        "p95_absolute_error_rad": errors[max(0, math.ceil(len(errors)*.95)-1)] if errors else None,
                        "reference_to_command_delay_ms": _delay(steady, name, "reference", "commanded"),
                        "command_to_measured_delay_ms": _delay(steady, name, "commanded", "measured")}
    return {"scope": "steady engagement; least-squares delay fit in 20 ms steps over 0–500 ms; null for insufficient motion; not exposure latency",
            "startup_samples": len(samples)-len(steady), "steady_samples": len(steady), "joints": result}
