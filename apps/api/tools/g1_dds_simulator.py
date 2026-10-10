"""Protocol simulator using official G1 DDS types and CRC; no physics or motors."""
import argparse
import json
import math
from pathlib import Path
import signal
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.robot_motion import ARM_INDICES, ARM_LIMITS
from app.robot_dds_network import initialize_sdk_channels


class SimulatedG1:
    def __init__(self, fault=None):
        from unitree_sdk2py.idl.default import unitree_hg_msg_dds__LowState_
        from unitree_sdk2py.utils.crc import CRC
        self.crc = CRC()
        self.message_factory = unitree_hg_msg_dds__LowState_
        self.lock = threading.Lock()
        self.positions = dict.fromkeys(ARM_INDICES, 0.0)
        self.positions["left_elbow_joint"] = self.positions["right_elbow_joint"] = .5
        self.tick = 0
        self.fault = fault
        self.accepted = self.rejected = self.releases = 0
        self.max_weight = 0.0

    def receive(self, command):
        with self.lock:
            weight = command.motor_cmd[29].q
            arms = [command.motor_cmd[index] for index in ARM_INDICES.values()]
            valid = (self.crc.Crc(command) == command.crc and command.mode_pr == 0
                     and command.mode_machine == 11 and math.isfinite(weight) and 0 <= weight <= 1
                     and all(math.isfinite(m.q) and math.isfinite(m.dq) and m.mode == 1
                             and m.kp > 0 and m.kd > 0 and m.tau == 0 for m in arms)
                     and all(ARM_LIMITS[name][0] <= command.motor_cmd[index].q <= ARM_LIMITS[name][1]
                             for name, index in ARM_INDICES.items())
                     and all(m.mode == 0 and m.kp == 0 and m.kd == 0 and m.tau == 0
                             for i, m in enumerate(command.motor_cmd) if i not in ARM_INDICES.values() and i != 29))
            if not valid:
                self.rejected += 1
                return
            self.accepted += 1
            self.max_weight = max(self.max_weight, weight)
            if weight == 0:
                self.releases += 1
            elif self.fault != "ignore-commands":
                self.positions = {name: float(command.motor_cmd[index].q)
                                  for name, index in ARM_INDICES.items()}

    def state(self):
        with self.lock:
            message = self.message_factory()
            if self.fault != "frozen-tick":
                self.tick = (self.tick + 1) % 2**32
            message.tick, message.mode_machine = self.tick, 11
            for name, q in self.positions.items():
                message.motor_state[ARM_INDICES[name]].q = q
            message.crc = self.crc.Crc(message)
            if self.fault == "invalid-crc":
                message.crc ^= 1
            return message

    def report(self):
        with self.lock:
            return {"accepted": self.accepted, "rejected": self.rejected,
                    "releases": self.releases, "max_weight": self.max_weight,
                    "positions": dict(self.positions), "tick": self.tick, "fault": self.fault}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--interface", required=True)
    parser.add_argument("--domain", type=int, default=42)
    parser.add_argument("--peer", action="append", default=[], help="Explicit numeric IPv4 discovery peer")
    parser.add_argument("--no-multicast", action="store_true")
    parser.add_argument("--duration", type=float, default=30)
    parser.add_argument("--fault", choices=("invalid-crc", "frozen-tick", "no-state", "ignore-commands"))
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)
    if not 1 <= args.domain <= 232 or not 1 <= args.duration <= 300:
        parser.error("Simulator requires a nonzero private domain (1–232), duration 1–300 seconds")
    from ipaddress import IPv4Address
    peers = [str(IPv4Address(peer)) for peer in args.peer]
    from unitree_sdk2py.core.channel import ChannelPublisher, ChannelSubscriber
    from unitree_sdk2py.idl.unitree_hg.msg.dds_ import LowCmd_, LowState_
    initialize_sdk_channels(args.domain, args.interface, peers, not args.no_multicast)
    robot = SimulatedG1(args.fault)
    publisher = ChannelPublisher("rt/lowstate", LowState_)
    subscriber = ChannelSubscriber("rt/arm_sdk", LowCmd_)
    publisher.Init()
    subscriber.Init(robot.receive)
    print(json.dumps({"ready": True, "domain": args.domain, "interface": args.interface}), flush=True)
    deadline = time.monotonic() + args.duration
    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    try:
        while time.monotonic() < deadline and not stopping.is_set():
            if args.fault != "no-state":
                publisher.Write(robot.state())
            time.sleep(.02)
    except KeyboardInterrupt:
        pass
    finally:
        subscriber.Close()
        publisher.Close()
        report = robot.report()
        print(json.dumps(report, indent=2), flush=True)
        if args.report:
            args.report.write_text(json.dumps(report, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
