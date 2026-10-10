import asyncio
import base64
from dataclasses import asdict
import json
import threading
import time
from types import SimpleNamespace
import pytest
pytest.importorskip("unitree_sdk2py")
from unitree_sdk2py.idl.default import unitree_hg_msg_dds__LowCmd_
from app.robot_controller import RobotController
from app.robot_rosbridge import decode_ros_message
from app.robot_transport_contract import ConnectionConfig, TargetPacket
from tools.g1_dds_simulator import SimulatedG1


@pytest.fixture
def bridge():
    from websockets.asyncio.server import serve
    robot = SimulatedG1()
    ready = threading.Event()
    loop = asyncio.new_event_loop()
    context = SimpleNamespace(robot=robot, packets=[], sockets=[], loop=loop)
    async def handle(socket):
        context.sockets.append(socket)
        subscribed = False
        async def states():
            while True:
                if subscribed:
                    state = asdict(robot.state())
                    state["wireless_remote"] = base64.b64encode(bytes(state["wireless_remote"])).decode("ascii")
                    await socket.send(json.dumps({"op": "publish", "topic": "/lowstate", "msg": state}))
                await asyncio.sleep(.02)
        task = asyncio.create_task(states())
        try:
            async for raw in socket:
                message = json.loads(raw)
                context.packets.append(message)
                if message["op"] == "subscribe":
                    subscribed = True
                elif message["op"] == "publish":
                    robot.receive(decode_ros_message(unitree_hg_msg_dds__LowCmd_(), message["msg"]))
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    async def run():
        async with serve(handle, "127.0.0.1", 0) as server:
            context.url = f"ws://127.0.0.1:{server.sockets[0].getsockname()[1]}"
            context.stop = asyncio.Event()
            ready.set()
            await context.stop.wait()
    def thread_main():
        asyncio.set_event_loop(loop)
        loop.run_until_complete(run())
        loop.close()
    thread = threading.Thread(target=thread_main)
    thread.start()
    assert ready.wait(3)
    yield context
    loop.call_soon_threadsafe(context.stop.set)
    thread.join(3)
    assert not thread.is_alive()


def wait_until(condition, timeout=3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(.02)
    raise AssertionError("Condition did not become true")


def connected_controller(bridge):
    runtime = RobotController()
    token = runtime.connect(ConnectionConfig(transport="unitree-rosbridge", network_interface="lo",
                                            rosbridge_url=bridge.url), run_worker=False)
    wait_until(lambda: runtime.fresh_state() is not None)
    return runtime, token


def test_real_websocket_bridge_preserves_crc_command_mapping_and_release(bridge):
    runtime, token = connected_controller(bridge)
    try:
        assert runtime.sent == bridge.robot.accepted == 0
        assert runtime.status()["measured"]["right_elbow_joint"] == .5
        assert bridge.packets[0]["queue_length"] == 1
        stream = runtime.attach_stream(token)
        runtime.arm(token)
        for sequence in range(10):
            runtime.receive(stream, TargetPacket(sequence=sequence, sent_at_ms=time.time()*1000,
                                                 tracking=True, positions={"right_elbow_joint": .58}))
            runtime.tick(.02)
            time.sleep(.025)
        wait_until(lambda: bridge.robot.accepted >= 10)
        assert bridge.robot.rejected == 0
        assert runtime.status()["measured"]["right_elbow_joint"] > .5
        runtime.disarm(token)
        wait_until(lambda: bridge.robot.releases >= 1)
        assert not runtime.armed
        command = next(packet["msg"] for packet in bridge.packets if packet["op"] == "publish")
        assert command["motor_cmd"][25]["mode"] == 1
        assert all(motor["kp"] == 0 for motor in command["motor_cmd"][:15])
    finally:
        runtime.disconnect()


@pytest.mark.parametrize("fault", ["invalid-crc", "frozen-tick"])
def test_bridge_bad_feedback_expires_and_disarms_controller(bridge, fault):
    runtime, token = connected_controller(bridge)
    try:
        runtime.arm(token)
        bridge.robot.fault = fault
        time.sleep(.4)
        runtime.tick()
        assert not runtime.armed and "stale" in runtime.reason
    finally:
        runtime.disconnect()


def test_bridge_connection_loss_disarms_and_cannot_publish(bridge):
    runtime, token = connected_controller(bridge)
    try:
        runtime.arm(token)
        asyncio.run_coroutine_threadsafe(bridge.sockets[0].close(), bridge.loop).result(2)
        wait_until(lambda: runtime.adapter.error is not None)
        runtime.tick()
        assert not runtime.armed and not runtime.status()["state_fresh"]
        with pytest.raises(RuntimeError):
            runtime.adapter.publish(runtime.positions, runtime.velocities, 0, 11)
    finally:
        runtime.disconnect()


@pytest.mark.parametrize("corrupt", ["missing-field", "short-array", "nonfinite", "bool-as-int"])
def test_bridge_requires_the_complete_finite_robot_state(corrupt):
    robot = SimulatedG1()
    value = asdict(robot.state())
    if corrupt == "missing-field":
        del value["crc"]
    elif corrupt == "short-array":
        value["motor_state"].pop()
    elif corrupt == "nonfinite":
        value["motor_state"][25]["q"] = float("nan")
    else:
        value["tick"] = True
    with pytest.raises(ValueError):
        decode_ros_message(robot.state(), value)


def test_official_rosbridge_base64_byte_array_preserves_crc():
    robot = SimulatedG1()
    state = robot.state()
    state.wireless_remote = list(range(40))
    state.crc = robot.crc.Crc(state)
    value = asdict(state)
    value["wireless_remote"] = base64.b64encode(bytes(value["wireless_remote"])).decode("ascii")
    decoded = decode_ros_message(robot.state(), value)
    assert decoded.wireless_remote == list(range(40))
    assert robot.crc.Crc(decoded) == decoded.crc
    value["wireless_remote"] = "broken!"
    with pytest.raises(ValueError):
        decode_ros_message(robot.state(), value)
