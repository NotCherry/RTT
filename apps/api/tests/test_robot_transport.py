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
