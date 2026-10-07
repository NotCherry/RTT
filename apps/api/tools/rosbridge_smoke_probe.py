"""Verify robot feedback and a harmless String publish/subscribe through rosbridge."""
import argparse
import asyncio
import json
from pathlib import Path
import time
import uuid
import websockets


async def probe(url):
    nonce = str(uuid.uuid4())
    ticks = set()
    last_state = None
    echoed = False
    async with websockets.connect(url, open_timeout=8) as socket:
        async def send(message):
            await socket.send(json.dumps(message))
        await send({"op": "subscribe", "topic": "/lowstate", "type": "unitree_hg/msg/LowState",
                    "throttle_rate": 100, "queue_length": 1})
        await send({"op": "advertise", "topic": "/rtt/bridge_probe", "type": "std_msgs/msg/String"})
        await send({"op": "subscribe", "topic": "/rtt/bridge_probe", "type": "std_msgs/msg/String"})
        deadline = time.monotonic() + 15
        next_publish = 0
        while time.monotonic() < deadline:
            if time.monotonic() >= next_publish:
                await send({"op": "publish", "topic": "/rtt/bridge_probe", "msg": {"data": nonce}})
                next_publish = time.monotonic() + .5
            try:
                message = json.loads(await asyncio.wait_for(socket.recv(), timeout=.5))
            except asyncio.TimeoutError:
                continue
            if message.get("op") == "status" and message.get("level") == "error":
                raise RuntimeError(message.get("msg", "Rosbridge rejected request"))
            if message.get("topic") == "/lowstate":
                last_state = message["msg"]
                ticks.add(last_state["tick"])
            elif message.get("topic") == "/rtt/bridge_probe":
                echoed = message["msg"]["data"] == nonce
            if len(ticks) >= 10 and echoed:
                return {"url": url, "distinct_state_ticks": len(ticks), "loopback_verified": True,
                        "right_elbow_rad": last_state["motor_state"][25]["q"],
                        "mode_machine": last_state["mode_machine"], "motor_commands_sent": 0}
    raise RuntimeError(f"Bridge verification timed out: {len(ticks)} state ticks, loopback={echoed}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="ws://192.168.123.164:9090")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = asyncio.run(probe(args.url))
    output = json.dumps(result, indent=2) + "\n"
    print(output, end="")
    if args.report:
        args.report.write_text(output)
