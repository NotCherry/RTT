"""Measure local UDP delivery by payload size without DDS or a robot."""
import argparse
import json
from pathlib import Path
import platform
import socket
import time
import uuid


def probe(address="127.0.0.1", sizes=(64, 1200, 1400, 1472, 1500, 2092, 4096), timeout=.2):
    samples = []
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as receiver, \
            socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sender:
        receiver.bind((address, 0))
        receiver.settimeout(timeout)
        for size in sizes:
            nonce = uuid.uuid4().bytes
            payload = (nonce * ((size + 15) // 16))[:size]
            received = 0
            for _ in range(3):
                sender.sendto(payload, receiver.getsockname())
                deadline = time.monotonic() + timeout
                while time.monotonic() < deadline:
                    try:
                        packet = receiver.recv(65535)
                    except socket.timeout:
                        break
                    if packet == payload:
                        received += 1
                        break
            samples.append({"payload_bytes": size, "sent": 3, "received": received})
    return {"platform": platform.platform(), "address": address, "samples": samples,
            "result": "passed" if all(row["received"] == 3 for row in samples) else "packet_loss"}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--address", default="127.0.0.1", help="A local IPv4 address to bind")
    parser.add_argument("--sizes", nargs="+", type=int, default=[64, 1200, 1400, 1472, 1500, 2092, 4096])
    parser.add_argument("--timeout", type=float, default=.2)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)
    if any(not 16 <= size <= 65507 for size in args.sizes) or not .01 <= args.timeout <= 2:
        parser.error("Payloads must be 16–65507 bytes, timeout 0.01–2 seconds")
    result = probe(args.address, args.sizes, args.timeout)
    print(json.dumps(result, indent=2), flush=True)
    if args.report:
        args.report.write_text(json.dumps(result, indent=2) + "\n")
    return 0 if result["result"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
