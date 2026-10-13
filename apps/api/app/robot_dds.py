"""Unitree SDK2 I/O, imported only when a physical connection is requested."""
from dataclasses import dataclass
import math
import socket
import threading
import time
from typing import Protocol
from .robot_motion import ARM_INDICES, arm_names
from .robot_transport_contract import ConnectionConfig
from .robot_dds_network import initialize_sdk_channels


@dataclass
class ArmState:
    positions: dict[str, float]
    received_at: float
    mode_machine: int = 0


class ArmAdapter(Protocol):
    def start(self): ...
    def state(self) -> ArmState | None: ...
    def publish(self, positions, velocities, weight, mode_machine): ...
    def close(self): ...


class MockArmAdapter:
    def __init__(self, config):
        self.positions = {name: 0.0 for name in arm_names(config.robot_model)}
        self.packets = 0

    def start(self): pass
    def state(self): return ArmState(dict(self.positions), time.monotonic())
    def publish(self, positions, velocities, weight, mode_machine):
        self.packets += 1
        if weight > 0:
            self.positions.update(positions)
    def close(self): pass


_factory_lock = threading.Lock()
_factory_binding = None


class UnitreeArmAdapter:
    def __init__(self, config: ConnectionConfig):
        self.config = config
        self._state = None
        self._last_tick = None
        self._lock = threading.Lock()
        self.publisher = self.subscriber = None

    def start(self):
        global _factory_binding
        try:
            socket.if_nametoindex(self.config.network_interface)
        except OSError as exc:
            raise RuntimeError("DDS network interface does not exist on this backend host") from exc
        try:
            from unitree_sdk2py.core.channel import ChannelPublisher, ChannelSubscriber
            from unitree_sdk2py.idl.unitree_hg.msg.dds_ import LowCmd_, LowState_
            from unitree_sdk2py.idl.default import unitree_hg_msg_dds__LowCmd_
            from unitree_sdk2py.utils.crc import CRC
        except ImportError as exc:
            raise RuntimeError("Unitree SDK is unavailable. Start with ./start-local.sh or install requirements-robot.txt.") from exc
        binding = (self.config.domain_id, self.config.network_interface,
                   tuple(self.config.discovery_peers), self.config.allow_multicast)
        with _factory_lock:
            if _factory_binding is not None and _factory_binding != binding:
                raise RuntimeError("Restart the robot backend before changing the DDS interface, domain, or discovery settings.")
            initialize_sdk_channels(*binding)
            _factory_binding = binding
        self.message_factory = unitree_hg_msg_dds__LowCmd_
        self.crc = CRC()
        self.publisher = ChannelPublisher("rt/arm_sdk", LowCmd_)
        self.publisher.Init()
        self.subscriber = ChannelSubscriber("rt/lowstate", LowState_)
        self.subscriber.Init(self._receive)  # no backlog: callback consumes the latest DDS sample

    def _receive(self, message):
        try:
            if self.crc.Crc(message) != message.crc:
                return
            tick = int(message.tick)
            positions = {name: float(message.motor_state[ARM_INDICES[name]].q) for name in arm_names(self.config.robot_model)}
            if not all(math.isfinite(q) for q in positions.values()):
                return
            state = ArmState(positions, time.monotonic(), int(message.mode_machine))
            with self._lock:
                if self._last_tick is not None and not 0 < (tick - self._last_tick) % (2**32) < 2**31:
                    return
                self._last_tick = tick
                self._state = state
        except (AttributeError, IndexError, TypeError, ValueError, OverflowError):
            return

    def state(self):
        with self._lock:
            return self._state

    def build_command(self, positions, velocities, weight, mode_machine):
        command = self.message_factory()
        command.mode_pr = 0
        command.mode_machine = mode_machine
        for name, q in positions.items():
            motor = command.motor_cmd[ARM_INDICES[name]]
            motor.mode = 1  # Match the explicit servo mode used by the onboard G1 scripts.
            motor.q = q
            motor.dq = velocities.get(name, 0.0)
            motor.tau = 0.0
            motor.kp = self.config.kp
            motor.kd = self.config.kd
        command.motor_cmd[29].q = weight
        command.crc = self.crc.Crc(command)
        return command

    def publish(self, positions, velocities, weight, mode_machine):
        command = self.build_command(positions, velocities, weight, mode_machine)
        if not self.publisher.Write(command):
            raise RuntimeError("DDS command publication failed")

    def close(self):
        if self.subscriber is not None:
            self.subscriber.Close()
        if self.publisher is not None:
            self.publisher.Close()


def create_adapter(config):
    if config.transport == "unitree-rosbridge":
        from .robot_rosbridge import RosbridgeArmAdapter
        return RosbridgeArmAdapter(config)
    if config.transport == "mock":
        return MockArmAdapter(config)
    from .robot_dds_process import ProcessDDSAdapter
    return ProcessDDSAdapter(config)
