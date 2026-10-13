import pytest
from app.robot_controller import RobotController
from app.robot_dds import ArmState, MockArmAdapter
from app.robot_motion import WAIST_INDICES, controlled_names
from app.robot_transport_contract import ConnectionConfig, TargetPacket


class MeasuredAdapter(MockArmAdapter):
    def __init__(self, config):
        super().__init__(config)
        self.positions = dict.fromkeys(controlled_names(config), .1)
        self.commands = []

    def publish(self, positions, velocities, weight, mode):
        self.commands.append((dict(positions), dict(velocities), weight))
        super().publish(positions, velocities, weight, mode)


def rig(mode, side="right", dof=3):
    runtime = RobotController(MeasuredAdapter)
    token = runtime.connect(ConnectionConfig(network_interface="lo", control_mode=mode,
                            active_arm=side, waist_dof=dof), run_worker=False)
    stream = runtime.attach_stream(token)
    runtime.arm(token)
    return runtime, token, stream


def submit(runtime, stream, sequence, positions):
    runtime.receive(stream, TargetPacket(sequence=sequence, sent_at_ms=runtime.wall_clock() * 1000,
                                        tracking=True, positions=positions))


@pytest.mark.parametrize("side", ["left", "right"])
def test_single_arm_holds_measured_torso_and_other_arm_and_rearms_at_new_pose(side):
    runtime, token, stream = rig("single-arm", side)
    try:
        selected = f"{side}_elbow_joint"
        held = {name: q for name, q in runtime.positions.items() if not name.startswith(side + "_")}
        submit(runtime, stream, 0, {selected: .4})
        for _ in range(20):
            runtime.tick()
        assert runtime.positions[selected] > .1
        assert {name: runtime.positions[name] for name in held} == held
        assert all(runtime.velocities[name] == 0 for name in held)
        assert set(WAIST_INDICES) <= set(runtime.adapter.commands[-1][0])
        with pytest.raises(ValueError, match="control mode"):
            submit(runtime, stream, 1, {"waist_yaw_joint": .2})
        other = "left" if side == "right" else "right"
        with pytest.raises(ValueError, match="control mode"):
            submit(runtime, stream, 1, {f"{other}_elbow_joint": .2})
        runtime.disarm(token)
        assert runtime.adapter.commands[-1][2] == 0
        runtime.adapter.positions["waist_yaw_joint"] = .3
        runtime.arm(token)
        runtime.tick()
        assert runtime.positions["waist_yaw_joint"] == .3
    finally:
        runtime.disconnect()


def test_upper_body_maps_all_waist_axes_with_independent_limits_and_holds_missing_axis():
    runtime, _, stream = rig("upper-body")
    try:
        previous_v = dict(runtime.velocities)
        for index in range(100):
            submit(runtime, stream, index, {"waist_yaw_joint": 2, "waist_roll_joint": -.8,
                                           "right_elbow_joint": .7})
            runtime.tick()
            for name in WAIST_INDICES:
                assert abs(runtime.velocities[name]) <= .5 + 1e-9
                assert abs(runtime.velocities[name] - previous_v[name]) <= .02 + 1e-9
            previous_v = dict(runtime.velocities)
        assert runtime.positions["waist_yaw_joint"] == pytest.approx(.6, abs=.02)
        assert runtime.positions["waist_roll_joint"] == pytest.approx(-.2, abs=.02)
        assert runtime.positions["waist_pitch_joint"] == .1
        assert runtime.positions["right_elbow_joint"] > .6
        assert all("hip" not in name for name in runtime.positions)
    finally:
        runtime.disconnect()


def test_yaw_only_never_reads_or_commands_locked_waist_axes():
    runtime, _, stream = rig("upper-body", dof=1)
    try:
        assert "waist_yaw_joint" in runtime.positions
        assert "waist_pitch_joint" not in runtime.positions
        assert "waist_roll_joint" not in runtime.positions
        with pytest.raises(ValueError, match="unavailable"):
            submit(runtime, stream, 0, {"waist_pitch_joint": .1})
    finally:
        runtime.disconnect()


def test_23_dof_contract_rejects_a_three_axis_waist():
    with pytest.raises(ValueError, match="waist yaw only"):
        ConnectionConfig(network_interface="lo", robot_model="g1-23", waist_dof=3)
