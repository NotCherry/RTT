"""Protocol-only G1 rosbridge simulator, including official Unitree CRCs."""
import argparse
import asyncio
import base64
from dataclasses import asdict
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.robot_rosbridge import decode_ros_message
from tools.g1_dds_simulator import SimulatedG1


async def serve(host="127.0.0.1", port=19090, duration=30, fault=None, report=None, drop_after=None):
    from websockets.asyncio.server import serve as websocket_server
    from websockets.exceptions import ConnectionClosed
    from unitree_sdk2py.idl.default import unitree_hg_msg_dds__LowCmd_
    robot = SimulatedG1(fault)

    async def handle(socket):
        subscribed = False
        async def send_states():
            started = asyncio.get_running_loop().time()
            while True:
                if drop_after and asyncio.get_running_loop().time() - started > drop_after:
                    await socket.close()
                    return
                if subscribed and fault != "no-state":
                    state = asdict(robot.state())
                    state["wireless_remote"] = base64.b64encode(bytes(state["wireless_remote"])).decode("ascii")
                    await socket.send(json.dumps({"op": "publish", "topic": "/lowstate", "msg": state}))
                await asyncio.sleep(.02)
        sending = asyncio.create_task(send_states())
        try:
            async for raw in socket:
                packet = json.loads(raw)
                if packet.get("op") == "subscribe" and packet.get("topic") == "/lowstate":
                    subscribed = True
                elif packet.get("op") == "publish" and packet.get("topic") == "/arm_sdk":
                    command = decode_ros_message(unitree_hg_msg_dds__LowCmd_(), packet.get("msg"))
                    robot.receive(command)
                elif packet.get("op") != "advertise":
                    await socket.send(json.dumps({"op": "status", "level": "error", "msg": "Unsupported simulation operation"}))
        except ConnectionClosed:
            pass
        finally:
            sending.cancel()
            await asyncio.gather(sending, return_exceptions=True)

    async with websocket_server(handle, host, port, max_size=131072, max_queue=1):
        print(json.dumps({"ready": True, "url": f"ws://{host}:{port}", "simulated": True}), flush=True)
        await asyncio.sleep(duration)
    result = robot.report()
    print(json.dumps(result, indent=2), flush=True)
    if report:
        report.write_text(json.dumps(result, indent=2) + "\n")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=19090)
    parser.add_argument("--duration", type=float, default=30)
    parser.add_argument("--fault", choices=("invalid-crc", "frozen-tick", "no-state", "ignore-commands"))
    parser.add_argument("--drop-after", type=float)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)
    if not 1 <= args.port <= 65535 or not 1 <= args.duration <= 300 or (args.drop_after is not None and args.drop_after <= 0):
        parser.error("Use port 1–65535, duration 1–300 seconds, and a positive drop delay")
    asyncio.run(serve(args.host, args.port, args.duration, args.fault, args.report, args.drop_after))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
