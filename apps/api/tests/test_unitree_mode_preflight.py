import sys
from types import SimpleNamespace
import pytest
from tools.unitree_mode_preflight import read_fsm_id, require_arm_control_mode


@pytest.mark.parametrize("mode", [0, 1])
def test_disabled_modes_refuse_arm_probe(mode):
    with pytest.raises(RuntimeError, match="select an appropriate enabled mode locally"):
        require_arm_control_mode(mode)


@pytest.mark.parametrize("public_getter", [True, False])
def test_fsm_query_supports_both_installed_sdk_versions(monkeypatch, public_getter):
    calls = []
    client = SimpleNamespace(SetTimeout=lambda value: None, Init=lambda: None)
    if public_getter:
        client.GetFsmId = lambda: (0, 0)
    else:
        def call(api_id, payload):
            calls.append((api_id, payload))
            return 0, '{"data":0}'
        client._Call = call
    module = SimpleNamespace(LocoClient=lambda: client)
    monkeypatch.setitem(sys.modules, "unitree_sdk2py.g1.loco.g1_loco_client", module)
    assert read_fsm_id() == 0
    if not public_getter:
        assert calls == [(7001, "")]


def test_rpc_failure_does_not_misread_default_zero_as_robot_mode(monkeypatch):
    client = SimpleNamespace(SetTimeout=lambda value: None, Init=lambda: None,
        _Call=lambda api_id, payload: (7301, '{"data":0}'))
    monkeypatch.setitem(sys.modules, "unitree_sdk2py.g1.loco.g1_loco_client",
        SimpleNamespace(LocoClient=lambda: client))
    with pytest.raises(RuntimeError, match="RPC result 7301"):
        read_fsm_id()
