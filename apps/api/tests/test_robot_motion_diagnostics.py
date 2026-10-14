import math
import pytest
from app.robot_controller import RobotController
from app.robot_transport_contract import ConnectionConfig, TargetPacket
from app.robot_motion_analysis import analyze_motion
from test_robot_controller import FakeAdapter


def test_reference_is_diagnostics_only_and_does_not_change_commands():
    clock = [0.]
    runtime = RobotController(FakeAdapter, lambda: clock[0], lambda: clock[0])
    try:
        token = runtime.connect(ConnectionConfig(network_interface="lo", max_joint_speed=3, max_joint_acceleration=10), run_worker=False)
        stream = runtime.attach_stream(token)
        runtime.arm(token)
        name = "left_elbow_joint"
        for i in range(20):
            clock[0] += .02
            runtime.adapter.received_at = clock[0]
            runtime.adapter.positions = dict(runtime.positions)
            runtime.receive(stream, TargetPacket(sequence=i, sent_at_ms=clock[0]*1000, tracking=True,
                positions={name: .5}, reference={name: 2.}, observation_age_ms=20, processing_ms=10))
            runtime.tick()
        value = runtime.status()["motion"]["joints"][name]
        assert value["reference"] == 2 and value["target"] == .5
        assert runtime.positions[name] < .6
        assert value["command_error"] == pytest.approx(runtime.positions[name]-2)
        assert runtime.status()["motion"]["packet"]["sequence"] == 19
        report = runtime.diagnostics()
        assert len(report["samples"]) == 20
        assert report["analysis"]["steady_samples"] == 0
        clock[0] += .3
        assert runtime.status()["motion"]["joints"][name]["reference"] is None
    finally:
        runtime.disconnect()


def test_trace_separates_known_command_delay_from_tracking_delay():
    name = "left_elbow_joint"
    samples = []
    for t in range(0, 4000, 20):
        reference = math.sin(t/350)*.4
        command = math.sin((t-80)/350)*.4
        measured = math.sin((t-140)/350)*.4
        samples.append({"server_time_ms": t, "armed": True, "engagement": 1,
            "joints": {name: {"reference": reference, "commanded": command, "measured": measured, "reference_error": measured-reference}}})
    result = analyze_motion(samples)["joints"][name]
    assert result["reference_to_command_delay_ms"] == 80
    assert result["command_to_measured_delay_ms"] == 60
    assert result["p95_absolute_error_rad"] > .1
    for sample in samples:
        sample["joints"][name]["reference"] = .2
    assert analyze_motion(samples)["joints"][name]["reference_to_command_delay_ms"] is None


def test_abandoned_connect_request_releases_its_adapter_without_arming():
    import asyncio
    from fastapi import HTTPException
    from app.robot_transport import create_transport_router
    runtime = RobotController(FakeAdapter, lambda: 0., lambda: 0.)
    endpoint = next(route.endpoint for route in create_transport_router(runtime).routes if route.path.endswith("/connect"))
    class DisconnectedRequest:
        async def is_disconnected(self):
            return True
    with pytest.raises(HTTPException) as failure:
        asyncio.run(endpoint(ConnectionConfig(network_interface="lo"), DisconnectedRequest()))
    assert failure.value.status_code == 499
    assert runtime.status()["connected"] is False
    assert runtime.status()["armed"] is False
