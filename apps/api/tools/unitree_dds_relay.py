"""Run on native Linux to carry G1 DDS between robot Ethernet and client Wi-Fi."""
import argparse
from ipaddress import IPv4Address
import json
from pathlib import Path
import signal
import socket
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.robot_dds_relay import DDSRelay


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--robot-interface", required=True)
    parser.add_argument("--client-interface", required=True)
    parser.add_argument("--robot-domain", type=int, default=0)
    parser.add_argument("--client-domain", type=int, default=7)
    parser.add_argument("--client-peer", action="append", default=[])
    parser.add_argument("--forward-commands", action="store_true",
                        help="Allow validated arm packets from RTT; startup sends no commands")
    parser.add_argument("--waist-dof", type=int, choices=(1, 3), default=1,
                        help="Number of physically movable waist axes permitted in commands")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)
    for interface in (args.robot_interface, args.client_interface):
        socket.if_nametoindex(interface)
    peers = [str(IPv4Address(peer)) for peer in args.client_peer]
    relay = DDSRelay(args.robot_interface, args.client_interface, args.robot_domain,
                     args.client_domain, peers, args.forward_commands, waist_dof=args.waist_dof)
    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    signal.signal(signal.SIGINT, lambda *_: stopping.set())
    print(json.dumps({"ready": True, **vars(args)}, default=str), flush=True)
    last_report = 0
    try:
        while not stopping.is_set():
            relay.step()
            if time.monotonic() - last_report >= 1:
                report = relay.report()
                if args.report:
                    temporary = args.report.with_suffix(".tmp")
                    temporary.write_text(json.dumps(report) + "\n")
                    temporary.replace(args.report)
                last_report = time.monotonic()
            stopping.wait(.005)
    finally:
        print(json.dumps(relay.report()), flush=True)
        relay.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
