import io
import json
import zipfile
from pathlib import Path

import pytest  # type: ignore[import-not-found]
from fastapi.testclient import TestClient  # type: ignore[import-not-found]

from app.main import (  # type: ignore[import-not-found]
    ROBOTS,
    SESSIONS,
    Demonstration,
    TrainConfig,
    TrainRequest,
    app,
    build_incremental_samples,
    denormalized,
    normalized,
    parse_urdf,
    train_session,
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


def test_incremental_samples_learn_small_next_state_deltas():
    demonstration = Demonstration(
        id="reach",
        name="reach",
        kind="gesture",
        current=[0.0, 0.0],
        target=[0.9, -0.6],
        frames=[
            {"timestamp": 0, "positions": [0.0, 0.0]},
            {"timestamp": 300, "positions": [0.9, -0.6]},
        ],
    )
    joints = [
        {"lower": -1.0, "upper": 1.0},
        {"lower": -1.0, "upper": 1.0},
    ]

    samples = build_incremental_samples([demonstration], joints, 100)

    assert len(samples) == 3
    assert samples[0]["progress"] == pytest.approx(0)
    assert samples[0]["delta"] == pytest.approx([0.3, -0.2])
    assert samples[-1]["current"] == pytest.approx([0.6, -0.4])


def test_temporal_training_supports_checkpoint_rollout():
    session_id, _ = create_sample_session()
    demonstration = Demonstration(
        id="gesture-train",
        name="reach",
        kind="gesture",
        current=[0.0, 0.0],
        target=[0.6, -0.4],
        frames=[
            {"timestamp": 0, "positions": [0.0, 0.0]},
            {"timestamp": 240, "positions": [0.6, -0.4]},
        ],
    )
    session = SESSIONS[session_id]
    train_session(
        session,
        TrainRequest(
            demonstrations=[demonstration],
            config=TrainConfig(epochs=2, timestep_ms=120, random_starts=1),
        ),
    )

    response = client.post(
        f"/api/sessions/{session_id}/rollout",
        json={"frames": [frame.model_dump() for frame in demonstration.frames]},
    )

    assert response.status_code == 200
    assert response.json()["steps"] > 0
    assert len(response.json()["frames"]) > 1


def test_datasets_are_persisted_and_exported_with_demonstrations():
    session_id, _ = create_sample_session()
    demonstration = {
        "id": "pose-01",
        "name": "home",
        "kind": "pose",
        "current": [0.0, 0.0],
        "target": [0.4, -0.2],
        "frames": [{"timestamp": 0, "positions": [0.4, -0.2]}],
    }
    assert client.put(
        f"/api/sessions/{session_id}/demonstrations",
        json={"demonstrations": [demonstration]},
    ).status_code == 200

    response = client.put(
        f"/api/sessions/{session_id}/datasets",
        json={
            "datasets": [
                {
                    "id": "dataset-home",
                    "name": "Home poses",
                    "demonstration_ids": ["pose-01"],
                    "created_at": "2025-01-01T00:00:00Z",
                    "updated_at": "2025-01-01T00:00:00Z",
                }
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["datasets"] == 1

    with zipfile.ZipFile(io.BytesIO(client.get(f"/api/sessions/{session_id}/export").content)) as archive:
        snapshot = json.loads(archive.read("session.json"))
    assert snapshot["datasets"][0]["name"] == "Home poses"


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
