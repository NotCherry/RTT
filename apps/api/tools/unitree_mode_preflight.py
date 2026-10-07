"""Read the locomotion service without changing the robot's whole-body mode."""
import json


def read_fsm_id():
    from unitree_sdk2py.g1.loco.g1_loco_client import LocoClient

    client = LocoClient()
    client.SetTimeout(3)
    client.Init()
    getter = getattr(client, "GetFsmId", None)
    if getter is not None:
        code, mode = getter()
    else:
        # Older installed SDKs register 7001 but omit the public getter.
        code, payload = client._Call(7001, "")
        mode = json.loads(payload)["data"] if code == 0 else None
    if code != 0 or type(mode) is not int:
        raise RuntimeError(f"Cannot verify robot FSM (RPC result {code})")
    return mode


def require_arm_control_mode(mode):
    if mode in (0, 1):
        name = "ZeroTorque" if mode == 0 else "Damp"
        raise RuntimeError(f"Robot FSM {mode} ({name}); select an appropriate enabled mode locally before arm testing")
    # Passing this check does not establish that the arm controller accepts commands.
