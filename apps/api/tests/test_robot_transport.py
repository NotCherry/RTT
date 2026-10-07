import time
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.robot_transport import router

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def test_plan_is_dry_run_and_interface_based():
    response = client.post("/api/robot-transport/plan", json={"network_interface": "eth0"})
    assert response.status_code == 200
    plan = response.json()
    assert plan["transmission_enabled"] is False
    assert plan["requires_robot_ip"] is False
    assert plan["command_topic"] == "rt/arm_sdk"
    assert plan["config"]["domain_id"] == 0


@pytest.mark.parametrize("update", [
    {"max_joint_speed": 10}, {"max_joint_speed": 0}, {"domain_id": -1},
    {"stale_after_ms": 1000}, {"network_interface": ""}, {"transmission_enabled": True},
])
def test_plan_rejects_unsafe_or_unknown_configuration(update):
    assert client.post("/api/robot-transport/plan", json={"network_interface": "eth0", **update}).status_code == 422


def test_ros_plan_uses_ros_topic_names():
    plan = client.post("/api/robot-transport/plan", json={"network_interface": "eth0", "transport": "ros2"}).json()
    assert plan["command_topic"] == "arm_sdk"
    assert not plan["transmission_enabled"]


def test_mock_http_and_websocket_lifecycle():
    from app.robot_controller import RobotController
    from app.robot_transport import create_transport_router
    runtime = RobotController()
    local_app = FastAPI()
    local_app.include_router(create_transport_router(runtime))
    with TestClient(local_app) as local:
        next_status = local.post("/api/robot-transport/connect", json={"transport": "mock", "network_interface": "lo"}).json()
        token = next_status["token"]
        headers = {"X-Robot-Token": token}
        assert local.post("/api/robot-transport/disconnect").status_code == 403
        with local.websocket_connect("/api/robot-transport/stream") as stream:
            stream.send_json({"token": token})
            assert stream.receive_json()["ready"] is True
            assert local.post("/api/robot-transport/arm", headers=headers).json()["armed"]
            stream.send_json({"sequence": 0, "sent_at_ms": time.time() * 1000, "tracking": True, "positions": {"left_elbow_joint": .5}})
        assert not runtime.armed
        assert local.get("/api/robot-transport/status").json()["connected"] is False
    runtime.disconnect()


def test_physical_connect_does_not_require_an_operator_key(monkeypatch):
    monkeypatch.setattr("app.robot_transport.controller.connect", lambda config: "owner")
    response = client.post("/api/robot-transport/connect", json={"transport": "unitree-sdk2", "network_interface": "lo"})
    assert response.status_code == 200
    assert response.json()["token"] == "owner"
