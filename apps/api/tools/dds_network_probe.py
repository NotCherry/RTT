"""Harmless bidirectional DDS probe; runs on Windows, WSL, or native Linux."""
import argparse
from dataclasses import dataclass
import json
from ipaddress import ip_address
from pathlib import Path
import time
import uuid
from xml.sax.saxutils import escape

from cyclonedds.domain import Domain, DomainParticipant
from cyclonedds.idl import IdlStruct
from cyclonedds.pub import DataWriter
from cyclonedds.sub import DataReader
from cyclonedds.topic import Topic


@dataclass
class ProbeMessage(IdlStruct, typename="rtt.diagnostics.ProbeMessage"):
    payload: str


def domain_config(interface, peer=None):
    try:
        ip_address(interface)
        selector = "address"
    except ValueError:
        selector = "name"
    interface = escape(interface, {'"': "&quot;"})
    discovery = ""
    if peer:
        peer = escape(peer, {'"': "&quot;"})
        discovery = ('<Discovery><ParticipantIndex>auto</ParticipantIndex>'
                     f'<Peers><Peer Address="{peer}"/></Peers></Discovery>')
    return ('<CycloneDDS><Domain><General>'
            f'<Interfaces><NetworkInterface {selector}="{interface}" prefer_multicast="false"/></Interfaces>'
            f'<AllowMulticast>{"false" if peer else "true"}</AllowMulticast>'
            f'</General>{discovery}</Domain></CycloneDDS>')


def probe(role, interface, domain_id=42, duration=10, peer=None, payload_bytes=64):
    domain = Domain(domain_id, domain_config(interface, peer))
    participant = DomainParticipant(domain_id)
    request = Topic(participant, "rtt/diagnostics/request", ProbeMessage)
    reply = Topic(participant, "rtt/diagnostics/reply", ProbeMessage)
    reader = DataReader(participant, request if role == "echo" else reply)
    writer = DataWriter(participant, reply if role == "echo" else request)
    nonce = uuid.uuid4().hex
    sent, received = 0, set()
    deadline = time.monotonic() + duration
    next_send = 0
    while time.monotonic() < deadline:
        now = time.monotonic()
        if role == "client" and now >= next_send:
            header = f"{nonce}:{sent}:"
            writer.write(ProbeMessage(header + "x" * max(0, payload_bytes - len(header))))
            sent += 1
            next_send = now + .1
        for message in reader.take(100):
            if not isinstance(message, ProbeMessage):
                continue
            if role == "echo":
                received.add(message.payload)
                writer.write(message)
                sent += 1
            elif message.payload.startswith(nonce + ":"):
                received.add(message.payload)
        time.sleep(.01)
    # Keep the configured Domain alive throughout the exchange.
    del reader, writer, request, reply, participant, domain
    return {"role": role, "interface": interface, "domain": domain_id,
            "peer": peer, "payload_bytes": payload_bytes, "sent": sent, "received_unique": len(received),
            "result": "passed" if len(received) >= 5 else "failed"}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role", choices=("echo", "client"))
    parser.add_argument("--interface", required=True, help="DDS interface name or IPv4 address")
    parser.add_argument("--domain", type=int, default=42)
    parser.add_argument("--duration", type=float, default=10)
    parser.add_argument("--peer", help="Disable multicast and use this unicast discovery peer")
    parser.add_argument("--payload-bytes", type=int, default=64)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)
    if not 0 <= args.domain <= 232 or not 1 <= args.duration <= 120 or not 64 <= args.payload_bytes <= 32768:
        parser.error("Use domain 0–232, duration 1–120 seconds, payload 64–32768 bytes")
    result = probe(args.role, args.interface, args.domain, args.duration, args.peer, args.payload_bytes)
    print(json.dumps(result, indent=2), flush=True)
    if args.report:
        args.report.write_text(json.dumps(result, indent=2) + "\n")
    return 0 if result["result"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
