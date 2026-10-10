"""Read-only by default; bypass browser/camera using the backend arm controller."""
import argparse
import json
import math
from pathlib import Path
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.robot_controller import RobotController
from app.robot_motion import ARM_LIMITS, arm_names
from app.robot_transport_contract import ConnectionConfig, TargetPacket
from tools.unitree_mode_preflight import read_fsm_id, require_arm_control_mode


def sequence_plan(initial, joint, delta=.08, target_rad=None, return_to_initial=True):
    if joint not in initial or joint not in ARM_LIMITS:
        raise ValueError("Choose a joint available in the measured arm state")
    if target_rad is not None:
        delta = target_rad - initial[joint]
        if not math.isfinite(delta) or abs(delta) > .35:
            raise ValueError("Absolute probe target must be within 0.35 rad of measured position")
    elif not math.isfinite(delta) or not 0 < abs(delta) <= .1:
        raise ValueError("Probe displacement must be nonzero and at most 0.1 rad")
    if any(not math.isfinite(q) or not ARM_LIMITS[name][0] <= q <= ARM_LIMITS[name][1]
           for name, q in initial.items()):
        raise ValueError("Measured arm positions are outside the G1 joint contract")
    target = {**initial, joint: initial[joint] + delta}
    if not ARM_LIMITS[joint][0] <= target[joint] <= ARM_LIMITS[joint][1]:
        raise ValueError("Probe target would exceed the selected joint's limit")
    phases = [("hold initial", dict(initial)), ("move out", target)]
    if return_to_initial:
        phases.append(("return", dict(initial)))
    return phases


def require_backend_stopped(url):
    try:
        with urlopen(url.rstrip("/") + "/api/robot-transport/status", timeout=2):
            pass
    except URLError as exc:
        # A refusal confirms no listener. Timeouts or HTTP errors do not.
        if isinstance(exc.reason, ConnectionRefusedError):
            return
        raise RuntimeError("Cannot verify backend is stopped; refusing motor publication") from exc
    raise RuntimeError("Stop the RTT backend before this standalone physical test to avoid competing control")


def wait_for_state(runtime, timeout=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = runtime.fresh_state()
        if state is not None:
            return state
        time.sleep(.02)
    raise RuntimeError("No fresh CRC-validated lowstate arrived within five seconds")


def run_sequence(runtime, token, plan, joint, log=print, clock=time.monotonic, sleep=time.sleep, hold_seconds=1):
    """50 Hz commands, measured startup, engagement ramp, outward move and return."""
    stream = runtime.attach_stream(token)
    runtime.arm(token)
    sequence = 0
    rows = []
    previous = clock()
    next_tick = previous
    try:
        for phase, target in plan:
            start = clock()
            settled = None
            last_log = -math.inf
            peak_motion = 0.0
            while True:
                now = clock()
                dt = now - previous
                if dt > .1:
                    raise RuntimeError("Control loop missed its deadline by over 100 ms")
                previous = now
                runtime.receive(stream, TargetPacket(sequence=sequence,
                    sent_at_ms=runtime.wall_clock() * 1000, tracking=True, positions=target))
                sequence += 1
                runtime.tick(dt)
                status = runtime.status()
                if not status["armed"]:
                    raise RuntimeError(status["reason"])
                if any(abs(status["commanded"][name] - status["measured"][name]) > .15
                       for name in target):
                    raise RuntimeError("Measured arm tracking error exceeds 0.15 rad")
                peak_motion = max(peak_motion, abs(status["measured"][joint] - plan[0][1][joint]))
                if now - last_log >= .5:
                    row = {"phase": phase, "elapsed_s": round(now - start, 2),
                        "target_rad": target[joint], "commanded_rad": status["commanded"][joint],
                        "measured_rad": status["measured"][joint], "packets_sent": status["packets_sent"],
                        "engagement": status["engagement"]}
                    rows.append(row)
                    log(json.dumps(row))
                    last_log = now
                arrived = all(abs(status["commanded"][name] - q) < .001
                              and abs(runtime.velocities[name]) < .005 for name, q in target.items())
                if phase == "hold initial":
                    if now - start >= 2.2:
                        break
                elif arrived:
                    if settled is None:
                        settled = now
                    if now - settled >= hold_seconds:
                        if phase == "move out" and peak_motion < abs(target[joint] - plan[0][1][joint]) * .25:
                            raise RuntimeError("Commands published but measured joint did not follow; check arm SDK acceptance/mode")
                        if abs(status["measured"][joint] - target[joint]) > .03:
                            raise RuntimeError("Measured joint did not reach the probe target within 0.03 rad")
                        break
                else:
                    settled = None
                phase_timeout = max(8, abs(target[joint] - plan[0][1][joint]) / runtime.config.max_joint_speed + hold_seconds + 3)
                if now - start > phase_timeout:
                    raise RuntimeError("Probe phase exceeded its bounded time limit")
                next_tick += .02
                sleep(max(0, next_tick - clock()))
    finally:
        runtime.disarm(token)
        log(json.dumps({"phase": "release", "status": runtime.status()}))
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interface", required=True)
    parser.add_argument("--domain", type=int, default=0)
    parser.add_argument("--peer", action="append", default=[], help="Numeric IPv4 DDS discovery peer")
    parser.add_argument("--no-multicast", action="store_true")
    parser.add_argument("--mock", action="store_true")
    parser.add_argument("--execute", action="store_true", help="Publish the small motion sequence")
    parser.add_argument("--confirm-g1-29", action="store_true", help="Operator confirms one G1 EDU 29 DOF on this DDS network")
    parser.add_argument("--joint", choices=arm_names("g1-29"), default="right_elbow_joint")
    destination = parser.add_mutually_exclusive_group()
    destination.add_argument("--delta", type=float, default=.08)
    destination.add_argument("--target-deg", type=float, help="Absolute joint angle, within 0.35 rad of freshly measured position")
    parser.add_argument("--no-return", action="store_true", help="Release after holding the target instead of returning")
    parser.add_argument("--hold-seconds", type=float, default=1)
    parser.add_argument("--backend-url", default="http://127.0.0.1:8000")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)
    if not math.isfinite(args.hold_seconds) or not 1 <= args.hold_seconds <= 5:
        parser.error("--hold-seconds must be between one and five seconds")
    if args.execute and not args.mock:
        if not args.confirm_g1_29:
            parser.error("Physical execution requires --confirm-g1-29")
        require_backend_stopped(args.backend_url)
    config = ConnectionConfig(transport="mock" if args.mock else "unitree-sdk2",
        robot_model="g1-29", network_interface=args.interface, domain_id=args.domain,
        discovery_peers=args.peer, allow_multicast=not args.no_multicast,
        max_joint_speed=.05, max_joint_acceleration=.1, kp=20, kd=1.5)
    runtime = RobotController()
    report = {"config": config.model_dump(), "executed": args.execute, "command_topic": "rt/arm_sdk"}
    token = None
    try:
        token = runtime.connect(config, run_worker=False)
        state = wait_for_state(runtime)
        initial = dict(state.positions)
        plan = sequence_plan(initial, args.joint, args.delta,
            target_rad=math.radians(args.target_deg) if args.target_deg is not None else None,
            return_to_initial=not args.no_return)
        report.update(initial=initial, mode_machine=state.mode_machine,
                      joint=args.joint, phases=[{"phase": phase, "positions": q} for phase, q in plan])
        if not args.mock:
            try:
                report["fsm_id"] = read_fsm_id()
            except Exception as exc:
                report["fsm_error"] = str(exc)
                if args.execute:
                    raise RuntimeError("Cannot verify robot FSM; refusing physical probe") from exc
        print(json.dumps(report, indent=2), flush=True)
        if args.execute:
            if not args.mock:
                require_arm_control_mode(report["fsm_id"])
            report["samples"] = []
            def record(line):
                report["samples"].append(json.loads(line))
                print(line, flush=True)
            run_sequence(runtime, token, plan, args.joint, log=record, hold_seconds=args.hold_seconds)
        else:
            # Observe updates without arming or writing any command, including release.
            time.sleep(1)
            fresh = wait_for_state(runtime)
            report["final_measured"] = fresh.positions
            report["measured_updates_observed"] = fresh.received_at > state.received_at
            print("READ ONLY: no motor commands sent. Proposed displacement: "
                  f"{args.joint}: " + " -> ".join(f"{q[args.joint]:.4f}" for _, q in plan) + " rad", flush=True)
        report["result"] = "completed"
    except (Exception, KeyboardInterrupt) as exc:
        report["result"], report["error"] = "aborted", str(exc) or "Interrupted"
        print(json.dumps({"error": report["error"]}), file=sys.stderr, flush=True)
        return 1
    finally:
        if token:
            runtime.disconnect(token)
        report["packets_sent"] = runtime.sent
        if args.report:
            args.report.write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
