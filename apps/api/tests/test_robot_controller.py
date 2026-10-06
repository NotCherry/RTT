import math
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError
import pytest
from app.robot_controller import RobotController
from app.robot_dds import ArmState
from app.robot_motion import ARM_INDICES, ARM_LIMITS, advance_motion, arm_names
from app.robot_transport_contract import ConnectionConfig, TargetPacket as Packet


class FakeAdapter:
    def __init__(self, config):
        self.positions = dict.fromkeys(arm_names(config.robot_model), .2)
        self.received_at = 0
        self.packets = []
        self.closed = False
        self.fail = False
    def start(self): pass
    def state(self): return ArmState(dict(self.positions), self.received_at, 7)
    def publish(self, q, v, weight, mode):
        if self.fail: raise RuntimeError("write failed")
        self.packets.append((dict(q), dict(v), weight, mode))
    def close(self): self.closed = True


def packet(runtime, **values):
    return Packet(sent_at_ms=runtime.wall_clock() * 1000, **values)


@pytest.fixture
def rig():
    clock = [0.0]
    runtime = RobotController(FakeAdapter, lambda: clock[0], lambda: clock[0])
    token = runtime.connect(ConnectionConfig(network_interface="lo"), run_worker=False)
    stream = runtime.attach_stream(token)
    yield runtime, token, stream, clock
    runtime.disconnect()


def test_arm_starts_at_measured_state_and_ramps_weight(rig):
    runtime, token, stream, _ = rig
    runtime.arm(token)
    runtime.tick()
    q, v, weight, mode = runtime.adapter.packets[-1]
    assert all(position == .2 for position in q.values())
    assert all(velocity == 0 for velocity in v.values())
    assert weight == pytest.approx(.01)
    assert mode == 7


def test_latest_target_and_velocity_acceleration_limits(rig):
    runtime, token, stream, clock = rig
    runtime.arm(token)
    name = "left_shoulder_pitch_joint"
    for i in range(100):
        clock[0] += .02
        runtime.adapter.received_at = clock[0]
        runtime.adapter.positions = dict(runtime.positions)
        runtime.receive(stream, packet(runtime, sequence=i, tracking=True, positions={name: 2.0}))
        before_q, before_v = runtime.positions[name], runtime.velocities[name]
        runtime.tick(.02)
        assert abs(runtime.positions[name] - before_q) <= 1 * .02 + 1e-9
        assert abs(runtime.velocities[name] - before_v) <= 3 * .02 + 1e-9
        assert runtime.positions["right_elbow_joint"] == .2
    assert runtime.positions[name] > 1


def test_target_loss_holds_and_recovers_without_rearming(rig):
    runtime, token, stream, clock = rig
    runtime.arm(token)
    runtime.receive(stream, packet(runtime, sequence=0, tracking=True, positions={"left_elbow_joint": 1}))
    runtime.tick()
    held = dict(runtime.positions)
    clock[0] = .3
    runtime.adapter.received_at = clock[0]
    runtime.tick()
    assert runtime.positions == held
    assert runtime.armed
    runtime.receive(stream, packet(runtime, sequence=1, tracking=True, positions={"left_elbow_joint": 1}))
    runtime.tick()
    assert runtime.positions["left_elbow_joint"] > held["left_elbow_joint"]


def test_state_loss_disarms_and_releases_control(rig):
    runtime, token, stream, clock = rig
    runtime.arm(token)
    clock[0] = 1
    runtime.tick()
    assert not runtime.armed
    assert runtime.adapter.packets[-1][2] == 0
    with pytest.raises(ValueError, match="Fresh measured"):
        runtime.arm(token)


def test_owner_disconnect_disarms_and_stale_stream_cannot_control(rig):
    runtime, token, stream, _ = rig
    runtime.arm(token)
    with pytest.raises(ValueError, match="Another camera"):
        runtime.attach_stream(token)
    runtime.detach_stream(stream)
    assert not runtime.armed
    with pytest.raises(PermissionError):
        runtime.receive(stream, packet(runtime, sequence=0, tracking=True))


def test_rejects_old_packets_bad_models_and_unauthorized_actions(rig):
    runtime, token, stream, _ = rig
    runtime.arm(token)
    runtime.receive(stream, packet(runtime, sequence=2, tracking=True, positions={"left_elbow_joint": 1}))
    with pytest.raises(ValueError, match="Out-of-order"):
        runtime.receive(stream, packet(runtime, sequence=1, tracking=True, positions={"left_elbow_joint": 2}))
    with pytest.raises(PermissionError): runtime.disarm("wrong")
    with pytest.raises(ValueError): packet(runtime, sequence=3, tracking=True, positions={"waist_yaw_joint": 1})
    with pytest.raises(ValueError): packet(runtime, sequence=3, tracking=True, positions={"left_elbow_joint": math.nan})


def test_transport_fault_cannot_remain_armed(rig):
    runtime, token, _, _ = rig
    runtime.arm(token)
    runtime.adapter.fail = True
    runtime.tick()
    assert not runtime.armed
    assert "fault" in runtime.reason


def test_positions_cannot_exceed_hardware_joint_limits():
    name = "left_elbow_joint"
    q, v = {name: 0}, {name: 0}
    for _ in range(1000): q, v = advance_motion(q, v, {name: 999}, .02, 3, 3)
    assert ARM_LIMITS[name][0] <= q[name] <= ARM_LIMITS[name][1]
    assert set(arm_names("g1-23")) < set(ARM_INDICES)


def test_large_measured_tracking_error_disarms(rig):
    runtime, token, _, _ = rig
    runtime.arm(token)
    runtime.adapter.positions["left_elbow_joint"] = 1.5
    runtime.tick()
    assert not runtime.armed
    assert "tracking error" in runtime.reason


def test_delayed_network_packets_cannot_be_replayed_as_fresh_targets(rig):
    runtime, token, stream, clock = rig
    runtime.arm(token)
    stale = Packet(sequence=0, sent_at_ms=0, tracking=True, positions={"left_elbow_joint": 1})
    clock[0] = 1
    with pytest.raises(ValueError, match="timestamp"):
        runtime.receive(stream, stale)


def test_reconnect_waits_for_previous_disconnect_to_finish():
    runtime = RobotController(FakeAdapter)
    config = ConnectionConfig(network_interface="lo")
    token = runtime.connect(config, run_worker=False)
    original = runtime.adapter
    joining, release = threading.Event(), threading.Event()

    class JoiningWorker:
        def join(self, timeout):
            joining.set()
            assert release.wait(timeout)

    runtime.worker = JoiningWorker()
    with ThreadPoolExecutor(max_workers=2) as pool:
        disconnect = pool.submit(runtime.disconnect, token)
        assert joining.wait(1)
        reconnect = pool.submit(runtime.connect, config, False)
        try:
            with pytest.raises(TimeoutError):
                reconnect.result(timeout=.05)
        finally:
            release.set()
        disconnect.result(timeout=1)
        new_token = reconnect.result(timeout=1)
    assert original.closed
    assert not runtime.adapter.closed
    with pytest.raises(PermissionError):
        runtime.disconnect(token)
    assert runtime.token == new_token
    runtime.disconnect(new_token)
