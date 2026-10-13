import time
import pytest
pytest.importorskip("unitree_sdk2py")
from cyclonedds.pub import DataWriter
from cyclonedds.sub import DataReader
from app.robot_dds import UnitreeArmAdapter
from app.robot_dds_relay import DDSRelay
from app.robot_transport_contract import ConnectionConfig
from tools.g1_dds_simulator import SimulatedG1


def wait_for(relay, action, condition):
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        action()
        relay.step()
        result = condition()
        if result:
            return result
        time.sleep(.01)
    raise AssertionError("DDS did not deliver the expected packet")


def command(robot, weight=.3):
    from unitree_sdk2py.idl.default import unitree_hg_msg_dds__LowCmd_
    adapter = UnitreeArmAdapter(ConnectionConfig(network_interface="lo"))
    adapter.message_factory = unitree_hg_msg_dds__LowCmd_
    adapter.crc = robot.crc
    return adapter.build_command(robot.positions, {}, weight, 11)


def test_real_dds_relay_preserves_feedback_crc_and_only_forwards_valid_arm_commands():
    relay = DDSRelay("lo", "lo", 61, 62, forward_commands=True)
    robot = SimulatedG1()
    state_writer = DataWriter(relay.participants[0], relay.topics[0])
    state_reader = DataReader(relay.participants[1], relay.topics[1])
    command_writer = DataWriter(relay.participants[1], relay.topics[2])
    command_reader = DataReader(relay.participants[0], relay.topics[3])
    try:
        samples = wait_for(relay, lambda: state_writer.write(robot.state()), lambda: state_reader.take(1))
        assert samples[0].crc == robot.crc.Crc(samples[0])
        assert samples[0].motor_state[25].q == .5
        assert relay.commands_forwarded == 0
        assert command_reader.take(1) == []
        packet = command(robot)
        packets = wait_for(relay, lambda: command_writer.write(packet), lambda: command_reader.take(1))
        robot.receive(packets[-1])
        assert robot.accepted == 1 and robot.rejected == 0
        assert packets[-1].crc == packet.crc
        packet.motor_cmd[0].mode = 1
        packet.crc = robot.crc.Crc(packet)
        rejected_before = relay.rejected_commands
        wait_for(relay, lambda: command_writer.write(packet), lambda: relay.rejected_commands > rejected_before)
        assert command_reader.take(1) == []
        delayed = command(robot)
        rejected_before = relay.rejected_commands
        wait_for(relay, lambda: command_writer.write(delayed, timestamp=time.time_ns() - 1_000_000_000),
                 lambda: relay.rejected_commands > rejected_before)
        assert command_reader.take(1) == []
    finally:
        del state_writer, state_reader, command_writer, command_reader
        relay.close()


def test_relay_rejects_frozen_corrupt_state_and_stale_motion_but_accepts_release():
    relay = DDSRelay("lo", "lo", 63, 64, forward_commands=True, clock=lambda: 10)
    robot = SimulatedG1()
    try:
        state = robot.state()
        assert relay.accept_state(state)
        assert not relay.accept_state(state)
        corrupt = robot.state()
        corrupt.crc ^= 1
        assert not relay.accept_state(corrupt)
        assert relay.accept_command(command(robot))
        relay.clock = lambda: 11
        assert not relay.accept_command(command(robot))
        assert relay.accept_command(command(robot, weight=0))
        relay.forward_commands = False
        assert not relay.accept_command(command(robot, weight=0))
    finally:
        relay.close()


@pytest.mark.parametrize("domains", [(0, 0), (42, 42), (0, 233)])
def test_relay_rejects_looping_domains(domains):
    with pytest.raises(ValueError):
        DDSRelay("lo", "lo", *domains)


def test_relay_forwards_three_axis_torso_contract_and_rejects_unsupported_axes_and_legs():
    relay = DDSRelay("lo", "lo", 65, 66, forward_commands=True, waist_dof=3)
    robot = SimulatedG1()
    adapter = UnitreeArmAdapter(ConnectionConfig(network_interface="lo", control_mode="upper-body", waist_dof=3))
    from unitree_sdk2py.idl.default import unitree_hg_msg_dds__LowCmd_
    adapter.message_factory, adapter.crc = unitree_hg_msg_dds__LowCmd_, robot.crc
    try:
        assert relay.accept_state(robot.state())
        positions = {**robot.positions, "waist_yaw_joint": .1, "waist_roll_joint": .05, "waist_pitch_joint": -.1}
        packet = adapter.build_command(positions, {}, .5, 11)
        assert relay.accept_command(packet)
        robot.receive(packet)
        assert robot.accepted == 1 and robot.positions["waist_pitch_joint"] == pytest.approx(-.1)
        relay.waist_names = ["waist_yaw_joint"]
        assert not relay.accept_command(packet)
        relay.waist_names = list(positions)
        packet.motor_cmd[0].kp = 40
        packet.crc = robot.crc.Crc(packet)
        assert not relay.accept_command(packet)
    finally:
        relay.close()
