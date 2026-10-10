"""Exercise the real RTT controller through DDS against a simulated G1."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.robot_controller import RobotController
from app.robot_transport_contract import ConnectionConfig
from tools.arm_sequence_probe import run_sequence, sequence_plan, wait_for_state


def run_lab(interface="lo", domain=42, fault=None, external=False, peers=(), multicast=True, rosbridge_url=None):
    if not 1 <= domain <= 232:
        raise ValueError("The control lab requires a nonzero private DDS domain")
    if not external and interface != "lo":
        raise ValueError("Local lab binds lo; use --external-simulator for another host/interface")
    if rosbridge_url and not external:
        raise ValueError("Use --external-simulator with --rosbridge-url")
    if not external:
        peers, multicast = ["127.0.0.1"], False
    report = {"interface": interface, "domain": domain, "fault": fault, "external_simulator": external}
    process = None
    runtime = RobotController()
    config = ConnectionConfig(transport="unitree-rosbridge" if rosbridge_url else "unitree-sdk2",
                              rosbridge_url=rosbridge_url, network_interface=interface, domain_id=domain,
                              max_joint_speed=.05, max_joint_acceleration=.1,
                              discovery_peers=list(peers), allow_multicast=multicast)
    with tempfile.TemporaryDirectory(prefix="rtt-dds-") as directory:
        robot_report = Path(directory) / "simulator.json"
        output = Path(directory) / "simulator.log"
        log_file = output.open("w")
        try:
            if not external:
                command = [sys.executable, str(Path(__file__).with_name("g1_dds_simulator.py")),
                           "--interface", interface, "--domain", str(domain), "--report", str(robot_report),
                           "--peer", "127.0.0.1", "--no-multicast"]
                if fault:
                    command += ["--fault", fault]
                process = subprocess.Popen(command, stdout=log_file, stderr=subprocess.STDOUT)
            token = runtime.connect(config, run_worker=False)
            if fault in ("no-state", "invalid-crc", "frozen-tick"):
                time.sleep(1)
                try:
                    wait_for_state(runtime, timeout=3)
                except RuntimeError:
                    report["feedback_rejected"] = True
                else:
                    raise RuntimeError("Invalid/missing/repeated telemetry was accepted as fresh")
                try:
                    runtime.arm(token)
                except ValueError:
                    report["arming_blocked"] = True
                else:
                    raise RuntimeError("Controller armed without valid updating feedback")
                if runtime.sent:
                    raise RuntimeError("Controller published commands during a read-only failure")
            else:
                state = wait_for_state(runtime)
                first_received = state.received_at
                time.sleep(.3)
                state = wait_for_state(runtime)
                if state.received_at <= first_received or runtime.sent:
                    raise RuntimeError("Read-only DDS state did not update, or sent commands")
                report["read_only_passed"] = True
                joint = "right_elbow_joint"
                initial = state.positions[joint]
                plan = sequence_plan(state.positions, joint)
                rows = []
                def record(line):
                    rows.append(json.loads(line))
                try:
                    run_sequence(runtime, token, plan, joint, log=record)
                except RuntimeError as exc:
                    if fault != "ignore-commands" or "did not follow" not in str(exc):
                        raise
                    report["command_acceptance_failure_detected"] = str(exc)
                else:
                    if fault == "ignore-commands":
                        raise RuntimeError("Ignored commands were incorrectly reported as motion")
                    report["motion_verified"] = any(row.get("phase") == "move out"
                        and row.get("measured_rad", initial) > initial + .04 for row in rows)
                    report["return_verified"] = abs(runtime.status()["measured"][joint] - initial) < .03
                    if not report["motion_verified"] or not report["return_verified"]:
                        raise RuntimeError("DDS measured motion/return did not match the sequence")
                report["samples"] = rows
                time.sleep(.1)  # Allow the independent subscriber to observe release.
                if process and not fault:
                    runtime.arm(token)
                    process.terminate()
                    process.wait(timeout=5)
                    time.sleep(.35)
                    runtime.tick()
                    report["state_loss_disarmed"] = not runtime.armed and "stale" in runtime.reason
                    if not report["state_loss_disarmed"]:
                        raise RuntimeError("State loss did not disarm the DDS controller")
            report["result"] = "passed"
        except Exception as exc:
            report.update(result="failed", error=str(exc))
        finally:
            runtime.disconnect()
            report["packets_sent"] = runtime.sent
            if process:
                if process.poll() is None:
                    process.terminate()
                process.wait(timeout=5)
                log_file.flush()
                if robot_report.exists():
                    report["simulator"] = json.loads(robot_report.read_text())
                    if report.get("result") == "passed" and report["simulator"]["rejected"]:
                        report.update(result="failed", error="Simulator rejected command fields or CRC")
                    if report.get("result") == "passed" and fault in (None, "ignore-commands") and (report["simulator"]["accepted"] < 10
                                                              or not report["simulator"]["releases"]):
                        report.update(result="failed", error="Simulator did not observe commands and release")
                else:
                    report.update(result="failed", error="Simulator exited without a report")
                    report["simulator_log"] = output.read_text()
            log_file.close()
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interface", default="lo")
    parser.add_argument("--domain", type=int, default=42)
    parser.add_argument("--peer", action="append", default=[])
    parser.add_argument("--no-multicast", action="store_true")
    parser.add_argument("--fault", choices=("invalid-crc", "frozen-tick", "no-state", "ignore-commands"))
    parser.add_argument("--external-simulator", action="store_true")
    parser.add_argument("--rosbridge-url", help="Test against an external simulated ROS bridge")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)
    if not 1 <= args.domain <= 232 or (not args.external_simulator and (args.interface != "lo" or args.rosbridge_url)):
        parser.error("Use a nonzero private DDS domain; local simulator uses interface lo")
    report = run_lab(args.interface, args.domain, args.fault, args.external_simulator,
                     args.peer, not args.no_multicast, args.rosbridge_url)
    report["rosbridge_url"] = args.rosbridge_url
    print(json.dumps(report, indent=2), flush=True)
    if args.report:
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    return 0 if report["result"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
