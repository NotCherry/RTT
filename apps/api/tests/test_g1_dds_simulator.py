import pytest
pytest.importorskip("unitree_sdk2py")
from unitree_sdk2py.idl.default import unitree_hg_msg_dds__LowCmd_
from app.robot_motion import ARM_INDICES
from tools.g1_dds_simulator import SimulatedG1, main


def command(robot):
    packet = unitree_hg_msg_dds__LowCmd_()
    packet.mode_machine = 11
    for name, index in ARM_INDICES.items():
        motor = packet.motor_cmd[index]
        motor.mode, motor.kp, motor.kd = 1, 20, 1.5
        motor.q = robot.positions[name]
    packet.motor_cmd[25].q = .58
    packet.motor_cmd[29].q = .5
    packet.crc = robot.crc.Crc(packet)
    return packet


def test_real_crc_survives_dds_serialization_and_feedback_tracks_commands():
    robot = SimulatedG1()
    packet = command(robot)
    robot.receive(type(packet).deserialize(packet.serialize()))
    state = robot.state()
    state = type(state).deserialize(state.serialize())
    assert robot.accepted == 1
    assert state.motor_state[25].q == pytest.approx(.58)
    assert robot.crc.Crc(state) == state.crc
    assert robot.state().tick > state.tick


@pytest.mark.parametrize("corrupt", ["crc", "legs", "mode", "position"])
def test_simulator_rejects_invalid_packets_without_moving(corrupt):
    robot = SimulatedG1()
    packet = command(robot)
    if corrupt == "legs":
        packet.motor_cmd[0].kp = 20
    elif corrupt == "mode":
        packet.mode_machine = 0
    elif corrupt == "position":
        packet.motor_cmd[25].q = 9
    packet.crc = robot.crc.Crc(packet) + (1 if corrupt == "crc" else 0)
    robot.receive(packet)
    assert robot.rejected == 1 and robot.accepted == 0
    assert robot.positions["right_elbow_joint"] == .5


def test_release_does_not_move_and_faults_are_observable():
    robot = SimulatedG1("ignore-commands")
    packet = command(robot)
    robot.receive(packet)
    assert robot.positions["right_elbow_joint"] == .5
    packet.motor_cmd[29].q = 0
    packet.crc = robot.crc.Crc(packet)
    robot.receive(packet)
    assert robot.releases == 1
    corrupt = SimulatedG1("invalid-crc")
    state = corrupt.state()
    assert corrupt.crc.Crc(state) != state.crc
    frozen = SimulatedG1("frozen-tick")
    assert frozen.state().tick == frozen.state().tick


def test_simulator_refuses_the_robot_default_domain_before_initialization():
    with pytest.raises(SystemExit):
        main(["--interface", "lo", "--domain", "0"])
