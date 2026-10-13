import sys
import types
from types import SimpleNamespace
import pytest
from app import robot_dds
from app.robot_transport_contract import ConnectionConfig


@pytest.fixture
def sdk(monkeypatch):
    calls = []
    class Publisher:
        def __init__(self, topic, message_type): self.topic = topic; self.packets = []; self.closed = False; calls.append(self)
        def Init(self): pass
        def Write(self, message): self.packets.append(message); return True
        def Close(self): self.closed = True
    class Subscriber:
        def __init__(self, topic, message_type): self.topic = topic; self.closed = False; calls.append(self)
        def Init(self, callback): self.callback = callback
        def Close(self): self.closed = True
    def message():
        return SimpleNamespace(mode_pr=0, mode_machine=0, crc=0, motor_cmd=[SimpleNamespace(mode=0, q=0, dq=0, tau=0, kp=0, kd=0) for _ in range(35)])
    class CRC:
        def Crc(self, command): return 123
    modules = {
        "unitree_sdk2py.core.channel": dict(ChannelFactoryInitialize=lambda *args: calls.append(args), ChannelPublisher=Publisher, ChannelSubscriber=Subscriber),
        "unitree_sdk2py.idl.unitree_hg.msg.dds_": dict(LowCmd_=object, LowState_=object),
        "unitree_sdk2py.idl.default": dict(unitree_hg_msg_dds__LowCmd_=message),
        "unitree_sdk2py.utils.crc": dict(CRC=CRC),
    }
    for path, attrs in modules.items():
        module = types.ModuleType(path)
        for key, value in attrs.items(): setattr(module, key, value)
        monkeypatch.setitem(sys.modules, path, module)
    monkeypatch.setattr(robot_dds, "_factory_binding", None)
    return calls


def test_packet_encodes_arm_indices_crc_and_weight_without_touching_legs(sdk):
    adapter = robot_dds.UnitreeArmAdapter(ConnectionConfig(transport="unitree-sdk2", network_interface="lo"))
    adapter.start()
    adapter.publish({"left_elbow_joint": .4, "right_wrist_yaw_joint": -.2}, {"left_elbow_joint": .1}, .3, 7)
    packet = adapter.publisher.packets[-1]
    assert adapter.publisher.topic == "rt/arm_sdk"
    assert adapter.subscriber.topic == "rt/lowstate"
    assert sdk[0] == (0, "lo")
    assert packet.motor_cmd[18].q == .4
    assert packet.motor_cmd[28].q == -.2
    assert packet.motor_cmd[18].dq == .1
    assert packet.motor_cmd[18].mode == packet.motor_cmd[28].mode == 1
    assert all(motor.mode == 0 for index, motor in enumerate(packet.motor_cmd) if index not in (18, 28))
    assert packet.motor_cmd[29].q == .3
    assert packet.mode_machine == 7
    assert packet.crc == 123
    assert all(motor.kp == 0 for motor in packet.motor_cmd[:15])
    adapter.close()
    assert adapter.publisher.closed and adapter.subscriber.closed


def test_state_callback_maps_real_hardware_motor_order_and_rejects_nan(sdk):
    adapter = robot_dds.UnitreeArmAdapter(ConnectionConfig(transport="unitree-sdk2", network_interface="lo"))
    adapter.start()
    message = SimpleNamespace(motor_state=[SimpleNamespace(q=index / 100) for index in range(35)], mode_machine=9, crc=123, tick=1)
    adapter.subscriber.callback(message)
    assert adapter.state().positions["left_shoulder_pitch_joint"] == .15
    assert adapter.state().mode_machine == 9
    before = adapter.state().received_at
    message.tick = 2
    message.motor_state[15].q = float("nan")
    adapter.subscriber.callback(message)
    assert adapter.state().received_at == before
    adapter.close()


def test_sdk_factory_does_not_silently_reuse_another_domain(sdk):
    first = robot_dds.UnitreeArmAdapter(ConnectionConfig(transport="unitree-sdk2", network_interface="lo"))
    first.start()
    first.close()
    second = robot_dds.UnitreeArmAdapter(ConnectionConfig(transport="unitree-sdk2", network_interface="lo", domain_id=1))
    with pytest.raises(RuntimeError, match="Restart"):
        second.start()


def test_duplicate_ticks_and_invalid_crc_do_not_refresh_feedback(sdk):
    adapter = robot_dds.UnitreeArmAdapter(ConnectionConfig(transport="unitree-sdk2", network_interface="lo"))
    adapter.start()
    message = SimpleNamespace(motor_state=[SimpleNamespace(q=0) for _ in range(35)], mode_machine=0, crc=123, tick=1)
    adapter.subscriber.callback(message)
    original = adapter.state()
    adapter.subscriber.callback(message)
    assert adapter.state() is original
    message.tick, message.crc = 2, 999
    adapter.subscriber.callback(message)
    assert adapter.state() is original
    adapter.close()


def test_sdk_factory_requires_restart_when_discovery_peers_change(sdk):
    first = robot_dds.UnitreeArmAdapter(ConnectionConfig(transport="unitree-sdk2", network_interface="lo"))
    first.start()
    first.close()
    second = robot_dds.UnitreeArmAdapter(ConnectionConfig(transport="unitree-sdk2", network_interface="lo",
                                                         discovery_peers=["127.0.0.1"]))
    with pytest.raises(RuntimeError, match="discovery settings"):
        second.start()


@pytest.mark.parametrize("dof", [1, 3])
def test_upper_body_feedback_and_waist_pd_gains_never_touch_legs_or_locked_axes(sdk, dof):
    adapter = robot_dds.UnitreeArmAdapter(ConnectionConfig(transport="unitree-sdk2", network_interface="lo",
                                         control_mode="single-arm", waist_dof=dof))
    adapter.start()
    try:
        message = SimpleNamespace(motor_state=[SimpleNamespace(q=.1) for _ in range(35)], mode_machine=9, crc=123, tick=1)
        adapter.subscriber.callback(message)
        positions = adapter.state().positions
        assert len(positions) == 14 + dof
        adapter.publish(positions, {}, .3, 9)
        packet = adapter.publisher.packets[-1]
        assert packet.motor_cmd[12].kp == 40 and packet.motor_cmd[12].kd == 2
        assert all(m.kp == m.kd == m.mode == 0 for m in packet.motor_cmd[:12])
        if dof == 1:
            assert packet.motor_cmd[13].kp == packet.motor_cmd[14].kp == 0
        else:
            assert packet.motor_cmd[13].kp == packet.motor_cmd[14].kp == 40
    finally:
        adapter.close()


@pytest.mark.parametrize("kp", [20, 40, 60])
def test_arm_strength_encodes_selected_gain_without_changing_waist_gains(sdk, kp):
    adapter = robot_dds.UnitreeArmAdapter(ConnectionConfig(network_interface="lo", control_mode="upper-body",
                                         waist_dof=3, kp=kp, kd=1.5))
    adapter.start()
    try:
        packet = adapter.build_command({"right_shoulder_pitch_joint": -.9, "left_shoulder_pitch_joint": -.9,
                                        "waist_yaw_joint": .1}, {}, .5, 9)
        assert packet.motor_cmd[15].kp == packet.motor_cmd[22].kp == kp
        assert packet.motor_cmd[15].kd == packet.motor_cmd[22].kd == 1.5
        assert packet.motor_cmd[12].kp == 40
        assert packet.motor_cmd[12].kd == 2
        assert all(m.kp == m.mode == 0 for m in packet.motor_cmd[:12])
    finally:
        adapter.close()
