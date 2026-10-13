"""Upper-body motion through the spawned SDK worker, on a private simulator domain."""
import json
from pathlib import Path
import subprocess
import sys
import time
import pytest
pytest.importorskip("unitree_sdk2py")
from app.robot_controller import RobotController
from app.robot_transport_contract import ConnectionConfig, TargetPacket


@pytest.mark.parametrize("mode,side,domain", [("single-arm", "right", 67), ("single-arm", "left", 68), ("upper-body", "right", 69)])
def test_real_dds_upper_body_motion_holding_and_release(tmp_path, mode, side, domain):
    report = tmp_path / "robot.json"
    tool = Path(__file__).resolve().parents[1] / "tools/g1_dds_simulator.py"
    with (tmp_path / "robot.log").open("w") as log:
        process = subprocess.Popen([sys.executable, str(tool), "--interface", "lo", "--domain", str(domain),
                                    "--peer", "127.0.0.1", "--no-multicast", "--report", str(report)], stdout=log, stderr=log)
        runtime = RobotController()
        try:
            token = runtime.connect(ConnectionConfig(transport="unitree-sdk2", network_interface="lo", domain_id=domain,
                                    discovery_peers=["127.0.0.1"], allow_multicast=False,
                                    control_mode=mode, active_arm=side, waist_dof=3), run_worker=False)
            deadline = time.monotonic() + 5
            while runtime.fresh_state() is None and time.monotonic() < deadline:
                time.sleep(.02)
            state = runtime.fresh_state()
            assert state is not None and len(state.positions) == 17
            assert runtime.sent == 0
            baseline = dict(state.positions)
            stream = runtime.attach_stream(token)
            runtime.arm(token)
            targets = {f"{side}_elbow_joint": .65}
            if mode == "upper-body":
                targets.update(waist_yaw_joint=.1, waist_roll_joint=.1, waist_pitch_joint=-.1, left_elbow_joint=.65)
            for sequence in range(85):
                runtime.receive(stream, TargetPacket(sequence=sequence, sent_at_ms=time.time() * 1000,
                                                    tracking=True, positions=targets))
                runtime.tick()
                time.sleep(.02)
            measured = runtime.status()["measured"]
            assert runtime.armed
            for name, target in targets.items():
                assert measured[name] == pytest.approx(target, abs=.025)
            for name, initial in baseline.items():
                if name not in targets:
                    assert measured[name] == pytest.approx(initial, abs=1e-6)
            runtime.disarm(token)
            time.sleep(.1)
        finally:
            runtime.disconnect()
            process.terminate()
            process.wait(timeout=5)
        result = json.loads(report.read_text())
        assert result["accepted"] > 20 and result["rejected"] == 0 and result["releases"] >= 1
