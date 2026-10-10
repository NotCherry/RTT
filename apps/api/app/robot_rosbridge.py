"""G1 arm transport through a native Linux rosbridge DDS gateway."""
import asyncio
import base64
import binascii
from dataclasses import asdict, fields, is_dataclass
import json
import math
import struct
import threading
from .robot_dds import UnitreeArmAdapter


def decode_ros_message(template, value, field_name=None):
    """Require the complete ROS message; never invent omitted state fields."""
    if is_dataclass(template):
        names = {field.name for field in fields(template)}
        if not isinstance(value, dict) or set(value) != names:
            raise ValueError("Incomplete or unexpected ROS state fields")
        for name in names:
            setattr(template, name, decode_ros_message(getattr(template, name), value[name], name))
        return template
    if isinstance(template, list):
        if field_name == "wireless_remote" and isinstance(value, str):
            try:
                value = list(base64.b64decode(value, validate=True))
            except (ValueError, binascii.Error) as exc:
                raise ValueError("ROS state byte array has invalid base64") from exc
        if not isinstance(value, list) or len(value) != len(template):
            raise ValueError("ROS state array does not match the G1 contract")
        return [decode_ros_message(sample, raw) for sample, raw in zip(template, value)]
    if type(template) is int:
        if type(value) is not int:
            raise ValueError("ROS state integer field is invalid")
    elif type(template) is float:
        if type(value) not in (int, float) or not math.isfinite(value):
            raise ValueError("ROS state float field is invalid")
        value = float(value)
    else:
        raise ValueError("Unsupported ROS state field")
    return value


class RosbridgeArmAdapter(UnitreeArmAdapter):
    def __init__(self, config):
        super().__init__(config)
        self.loop = self.thread = self.task = self.socket = None
        self.ready = threading.Event()
        self.error = None

    def start(self):
        try:
            from unitree_sdk2py.idl.default import unitree_hg_msg_dds__LowCmd_, unitree_hg_msg_dds__LowState_
            from unitree_sdk2py.utils.crc import CRC
        except ImportError as exc:
            raise RuntimeError("Unitree message/CRC support is unavailable; use the robot backend image") from exc
        self.message_factory = unitree_hg_msg_dds__LowCmd_
        self.state_factory = unitree_hg_msg_dds__LowState_
        self.crc = CRC()
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run_bridge, name="robot-rosbridge", daemon=True)
        self.thread.start()
        if not self.ready.wait(8):
            raise RuntimeError("ROS bridge connection timed out")
        if self.error:
            raise RuntimeError(self.error)

    def _run_bridge(self):
        asyncio.set_event_loop(self.loop)
        self.task = self.loop.create_task(self._serve())
        try:
            self.loop.run_until_complete(self.task)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            self.error = f"ROS bridge transport failed: {exc}"
        finally:
            self.ready.set()
            self.socket = None
            pending = asyncio.all_tasks(self.loop)
            for task in pending:
                task.cancel()
            if pending:
                self.loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            # Complete callbacks that resolve cross-thread publication futures
            # before closing their source loop.
            self.loop.run_until_complete(asyncio.sleep(0))
            self.loop.close()

    async def _serve(self):
        from websockets.asyncio.client import connect
        async with connect(self.config.rosbridge_url, open_timeout=5, close_timeout=1,
                           max_size=131072, max_queue=1, ping_interval=5, ping_timeout=5) as socket:
            self.socket = socket
            await socket.send(json.dumps({"op": "subscribe", "topic": "/lowstate",
                "type": "unitree_hg/msg/LowState", "throttle_rate": 20, "queue_length": 1}))
            await socket.send(json.dumps({"op": "advertise", "topic": "/arm_sdk",
                "type": "unitree_hg/msg/LowCmd"}))
            self.ready.set()
            async for raw in socket:
                message = json.loads(raw)
                if message.get("op") == "status" and message.get("level") == "error":
                    raise RuntimeError(message.get("msg", "ROS bridge rejected an operation"))
                if message.get("op") == "publish" and message.get("topic") == "/lowstate":
                    try:
                        state = decode_ros_message(self.state_factory(), message.get("msg"))
                        self._receive(state)
                    except (ValueError, TypeError, OverflowError, struct.error):
                        continue
            self.error = "ROS bridge connection closed"

    def state(self):
        return None if self.error else super().state()

    async def _send_command(self, message):
        if self.socket is None or self.error:
            raise RuntimeError(self.error or "ROS bridge is disconnected")
        await asyncio.wait_for(self.socket.send(message), timeout=.1)

    def publish(self, positions, velocities, weight, mode_machine):
        command = self.build_command(positions, velocities, weight, mode_machine)
        message = json.dumps({"op": "publish", "topic": "/arm_sdk", "msg": asdict(command)}, allow_nan=False)
        if self.loop is None or self.loop.is_closed() or self.error:
            raise RuntimeError(self.error or "ROS bridge is disconnected")
        coroutine = self._send_command(message)
        try:
            future = asyncio.run_coroutine_threadsafe(coroutine, self.loop)
        except RuntimeError as exc:
            coroutine.close()
            raise RuntimeError("ROS bridge is disconnected") from exc
        try:
            future.result(timeout=.15)
        except Exception as exc:
            future.cancel()
            self.error = f"ROS bridge command publication failed: {exc}"
            raise RuntimeError(self.error) from exc

    def close(self):
        def request_close():
            if self.socket:
                self.loop.create_task(self.socket.close())
            elif self.task:
                self.task.cancel()
        if self.loop and not self.loop.is_closed():
            try:
                self.loop.call_soon_threadsafe(request_close)
            except RuntimeError:
                pass
        if self.thread:
            self.thread.join(timeout=1.5)
        if self.loop and not self.loop.is_closed() and self.task:
            try:
                self.loop.call_soon_threadsafe(self.task.cancel)
            except RuntimeError:
                pass  # The transport thread may have closed between these checks.
        if self.thread:
            self.thread.join(timeout=2)
