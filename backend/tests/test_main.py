import io
import json
import zipfile
from pathlib import Path

import pytest  # type: ignore[import-not-found]
from fastapi.testclient import TestClient  # type: ignore[import-not-found]

from backend.app.main import (  # type: ignore[import-not-found]
    ROBOTS,
    SESSIONS,
    app,
    denormalized,
    normalized,
    parse_urdf,
)

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_sessions():
    yield
    for session in list(SESSIONS.values()):
        session.close()
    SESSIONS.clear()
    ROBOTS.clear()


def create_sample_session() -> tuple[str, dict]:
    robot_response = client.get("/api/robots/demo")
    assert robot_response.status_code == 200
    robot = robot_response.json()

    session_response = client.post("/api/sessions", json={"robot_id": robot["id"]})
    assert session_response.status_code == 200
    payload = session_response.json()
    assert len(payload["state"]["positions"]) == len(
        [joint for joint in robot["joints"] if joint["controllable"]]
    )
    return payload["session_id"], robot


def test_health_and_sample_session_expose_controllable_state():
    assert client.get("/api/health").json() == {"status": "ok"}

    session_id, robot = create_sample_session()

    # The session creation response is the public state contract; verify the
    # helper returned the sample robot that owns this controllable state.
    assert session_id
    assert len([joint for joint in robot["joints"] if joint["controllable"]]) == 2


def test_parser_rejects_external_mesh_assets(tmp_path: Path):
    raw = b"""<robot name='mesh-robot'>
      <link name='base'><visual><geometry><mesh filename='outside.stl'/></geometry></visual></link>
    </robot>"""

    with pytest.raises(ValueError, match="Mesh assets are not supported"):
        parse_urdf(raw, "mesh.urdf", tmp_path / "mesh.urdf")


def test_joint_normalization_round_trips_with_robot_limits():
    joints = [
        {"lower": -1.0, "upper": 1.0},
        {"lower": 0.0, "upper": 2.0},
    ]
    values = [-0.25, 1.5]

    encoded = normalized(values, joints)
    decoded = denormalized(encoded, joints)

    assert encoded == pytest.approx([-0.25, 0.5])
    assert decoded == pytest.approx(values)


def test_demonstrations_are_persisted_and_exported_as_frames():
    session_id, _ = create_sample_session()
    demonstration = {
        "id": "gesture-01",
        "name": "reach forward",
        "kind": "gesture",
        "current": [0.0, 0.0],
        "target": [0.6, -0.4],
        "frames": [
            {"timestamp": 0, "positions": [0.0, 0.0]},
            {"timestamp": 120, "positions": [0.6, -0.4]},
        ],
    }

    save_response = client.put(
        f"/api/sessions/{session_id}/demonstrations",
        json={"demonstrations": [demonstration]},
    )
    assert save_response.status_code == 200
    assert save_response.json()["demonstrations"] == 1

    export_response = client.get(f"/api/sessions/{session_id}/export")
    assert export_response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(export_response.content)) as archive:
        snapshot = json.loads(archive.read("session.json"))

    exported = snapshot["demonstrations"][0]
    assert exported["name"] == "reach forward"
    assert exported["kind"] == "gesture"
    assert len(exported["frames"]) == 2


def test_demonstrations_require_one_value_per_controllable_joint():
    session_id, _ = create_sample_session()
    invalid = {
        "id": "bad-pose",
        "name": "invalid",
        "kind": "pose",
        "current": [0.0],
        "target": [0.0],
        "frames": [],
    }

    response = client.put(
        f"/api/sessions/{session_id}/demonstrations",
        json={"demonstrations": [invalid]},
    )

    assert response.status_code == 422
    assert "one value per controllable joint" in response.json()["detail"]
