import pytest
from app.robot_controller import RobotController
from app.robot_dds import ArmState, MockArmAdapter
from app.robot_motion import ARM_LIMITS
from app.robot_transport_contract import ConnectionConfig
from tools.arm_sequence_probe import main, run_sequence, sequence_plan, require_backend_stopped


def probe_rig(follows=True):
    clock = [0.0]

    class Adapter(MockArmAdapter):
        def state(self):
            return ArmState(dict(self.positions), clock[0], 5)

        def publish(self, positions, velocities, weight, mode_machine):
            if follows:
                super().publish(positions, velocities, weight, mode_machine)
            else:
                self.packets += 1

    runtime = RobotController(Adapter, lambda: clock[0], lambda: clock[0])
    token = runtime.connect(ConnectionConfig(network_interface="lo", max_joint_speed=.05,
        max_joint_acceleration=.1), run_worker=False)
    plan = sequence_plan(runtime.adapter.state().positions, "right_elbow_joint", .08)
    def sleep(seconds):
        clock[0] += seconds
    return runtime, token, plan, lambda: clock[0], sleep


def test_probe_starts_measured_moves_slowly_returns_and_releases():
    runtime, token, plan, clock, sleep = probe_rig()
    rows = run_sequence(runtime, token, plan, "right_elbow_joint", log=lambda _: None, clock=clock, sleep=sleep)
    assert runtime.armed is False
    assert runtime.weight == 0
    assert rows[0]["commanded_rad"] == plan[0][1]["right_elbow_joint"]
    assert max(row["measured_rad"] for row in rows) > .07
    assert abs(runtime.adapter.positions["right_elbow_joint"]) < .001
    assert runtime.sent > 100
    for previous, current in zip(rows, rows[1:]):
        if previous["phase"] == current["phase"]:
            assert abs(current["commanded_rad"] - previous["commanded_rad"]) <= .05 * (current["elapsed_s"] - previous["elapsed_s"] + .02)
    assert all(q == 0 for name, q in runtime.positions.items() if name != "right_elbow_joint")
    runtime.disconnect(token)


def test_probe_detects_publication_without_measured_response_and_releases():
    runtime, token, plan, clock, sleep = probe_rig(follows=False)
    with pytest.raises(RuntimeError, match="did not follow"):
        run_sequence(runtime, token, plan, "right_elbow_joint", log=lambda _: None, clock=clock, sleep=sleep)
    assert runtime.armed is False
    assert runtime.weight == 0
    runtime.disconnect(token)


def test_probe_rejects_large_or_out_of_limit_displacements():
    joint = "right_elbow_joint"
    with pytest.raises(ValueError, match="0.1 rad"):
        sequence_plan({joint: 0}, joint, .5)
    with pytest.raises(ValueError, match="exceed"):
        sequence_plan({joint: ARM_LIMITS[joint][1]}, joint, .08)


def test_probe_refuses_competing_backend(monkeypatch):
    from contextlib import nullcontext
    monkeypatch.setattr("tools.arm_sequence_probe.urlopen", lambda *a, **k: nullcontext())
    with pytest.raises(RuntimeError, match="Stop the RTT backend"):
        require_backend_stopped("http://127.0.0.1:8000")


def test_read_only_cli_never_publishes_even_on_cleanup(monkeypatch, tmp_path):
    import json
    def unexpected_publication(*args):
        raise AssertionError("Read-only probe must never publish")
    monkeypatch.setattr(MockArmAdapter, "publish", unexpected_publication)
    monkeypatch.setattr("tools.arm_sequence_probe.time.sleep", lambda seconds: None)
    report = tmp_path / "probe.json"
    assert main(["--interface", "lo", "--mock", "--report", str(report)]) == 0
    assert json.loads(report.read_text())["packets_sent"] == 0


def test_absolute_ninety_degree_target_starts_measured_and_can_skip_return():
    import math
    initial = {"right_elbow_joint": 1.4}
    plan = sequence_plan(initial, "right_elbow_joint", target_rad=math.pi / 2, return_to_initial=False)
    assert plan[0][1] == initial
    assert plan[1][1]["right_elbow_joint"] == math.pi / 2
    assert len(plan) == 2
    with pytest.raises(ValueError, match="0.35 rad"):
        sequence_plan({"right_elbow_joint": 0}, "right_elbow_joint", target_rad=math.pi / 2)


def test_physical_cli_in_zero_torque_never_publishes(monkeypatch, tmp_path):
    import json
    runtime = RobotController(adapter_factory=MockArmAdapter)
    monkeypatch.setattr("tools.arm_sequence_probe.RobotController", lambda: runtime)
    monkeypatch.setattr("tools.arm_sequence_probe.require_backend_stopped", lambda url: None)
    monkeypatch.setattr("tools.arm_sequence_probe.read_fsm_id", lambda: 0)
    def unexpected_publication(*args):
        raise AssertionError("Disabled FSM must never publish")
    monkeypatch.setattr(MockArmAdapter, "publish", unexpected_publication)
    report = tmp_path / "blocked.json"
    assert main(["--interface", "lo", "--execute", "--confirm-g1-29", "--report", str(report)]) == 1
    result = json.loads(report.read_text())
    assert result["fsm_id"] == 0
    assert "ZeroTorque" in result["error"]
    assert result["packets_sent"] == 0
