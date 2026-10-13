"""A native Linux DDS link between the robot LAN and a separate client domain."""
import math
import struct
import time
from .robot_dds_network import channel_config
from .robot_motion import ARM_INDICES, ARM_LIMITS


class DDSRelay:
    def __init__(self, robot_interface, client_interface, robot_domain=0,
                 client_domain=7, client_peers=(), forward_commands=False, clock=time.monotonic):
        if not 0 <= robot_domain <= 232 or not 1 <= client_domain <= 232 or robot_domain == client_domain:
            raise ValueError("Use distinct domains and a nonzero client domain")
        from cyclonedds.domain import Domain, DomainParticipant
        from cyclonedds.core import Qos, Policy
        from cyclonedds.topic import Topic
        from cyclonedds.pub import DataWriter
        from cyclonedds.sub import DataReader
        from unitree_sdk2py.idl.unitree_hg.msg.dds_ import LowCmd_, LowState_
        from unitree_sdk2py.utils.crc import CRC
        self.clock, self.crc = clock, CRC()
        self.forward_commands = forward_commands
        self.state = None
        self.state_at = -math.inf
        self.states_forwarded = self.commands_forwarded = self.rejected_commands = 0
        self.domains = [Domain(robot_domain, channel_config(robot_interface)),
                       Domain(client_domain, channel_config(client_interface, client_peers))]
        self.participants = [DomainParticipant(robot_domain), DomainParticipant(client_domain)]
        self.topics = [Topic(self.participants[0], "rt/lowstate", LowState_),
                       Topic(self.participants[1], "rt/lowstate", LowState_),
                       Topic(self.participants[1], "rt/arm_sdk", LowCmd_),
                       Topic(self.participants[0], "rt/arm_sdk", LowCmd_)]
        latest = Qos(Policy.History.KeepLast(1))
        self.state_reader = DataReader(self.participants[0], self.topics[0], qos=latest)
        self.state_writer = DataWriter(self.participants[1], self.topics[1], qos=latest)
        self.command_reader = DataReader(self.participants[1], self.topics[2], qos=latest) if forward_commands else None
        self.command_writer = DataWriter(self.participants[0], self.topics[3], qos=latest) if forward_commands else None

    def accept_state(self, message):
        try:
            if self.crc.Crc(message) != message.crc:
                return False
            if not all(math.isfinite(message.motor_state[i].q) for i in ARM_INDICES.values()):
                return False
            if self.state is not None and not 0 < (message.tick - self.state.tick) % 2**32 < 2**31:
                return False
        except (AttributeError, IndexError, TypeError, ValueError, OverflowError, struct.error):
            return False
        self.state, self.state_at = message, self.clock()
        return True

    def accept_command(self, message):
        """Forward RTT arm packets only; never alter CRC or fill missing fields."""
        try:
            if not self.forward_commands or self.state is None or self.crc.Crc(message) != message.crc:
                return False
            weight = message.motor_cmd[29].q
            if not math.isfinite(weight) or not 0 <= weight <= 1:
                return False
            # A zero-weight release remains deliverable when telemetry stops.
            if weight > 0 and self.clock() - self.state_at > .25:
                return False
            if message.mode_pr != 0 or message.mode_machine != self.state.mode_machine:
                return False
            for name, index in ARM_INDICES.items():
                motor = message.motor_cmd[index]
                if (motor.mode != 1 or not ARM_LIMITS[name][0] <= motor.q <= ARM_LIMITS[name][1]
                        or not math.isfinite(motor.dq) or abs(motor.dq) > 3 or motor.tau != 0
                        or not 5 <= motor.kp <= 80 or not .1 <= motor.kd <= 5):
                    return False
            for index, motor in enumerate(message.motor_cmd):
                if index not in ARM_INDICES.values() and index != 29:
                    if any(getattr(motor, field) != 0 for field in ("mode", "q", "dq", "tau", "kp", "kd")):
                        return False
            weight_motor = message.motor_cmd[29]
            if any(getattr(weight_motor, field) != 0 for field in ("mode", "dq", "tau", "kp", "kd")):
                return False
        except (AttributeError, IndexError, TypeError, ValueError, OverflowError, struct.error):
            return False
        return True

    def step(self):
        states = self.state_reader.take(1)
        if states and self.accept_state(states[-1]):
            self.state_writer.write(states[-1])
            self.states_forwarded += 1
        if self.command_reader is not None:
            commands = self.command_reader.take(1)
            if commands:
                command = commands[-1]
                timestamp = getattr(getattr(command, "sample_info", None), "source_timestamp", 0)
                age = time.time() - timestamp / 1e9
                if -.1 <= age <= .25 and self.accept_command(command):
                    self.command_writer.write(command)
                    self.commands_forwarded += 1
                else:
                    self.rejected_commands += 1

    def report(self):
        return {"states_forwarded": self.states_forwarded,
                "commands_forwarded": self.commands_forwarded,
                "rejected_commands": self.rejected_commands,
                "state_fresh": self.state is not None and self.clock() - self.state_at <= .25,
                "forward_commands": self.forward_commands}

    def close(self):
        self.command_reader = self.command_writer = None
        self.state_reader = self.state_writer = None
        self.topics.clear()
        self.participants.clear()
        self.domains.clear()
