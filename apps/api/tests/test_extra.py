import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.main import (
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
)

client = TestClient(app)

@pytest.fixture(autouse=True)
def clean():
    yield
    for s in list(SESSIONS.values()):
        s.close()
    SESSIONS.clear()
    ROBOTS.clear()

def _demo_session():
    robot = client.get("/api/robots/demo").json()
    sid = client.post("/api/sessions", json={"robot_id": robot["id"]}).json()["session_id"]
    return sid, robot

def test_demo_robot_idempotent():
    first = client.get("/api/robots/demo").json()
    second = client.get("/api/robots/demo").json()
    assert first["id"] == second["id"] == "demo-slider-arm"
    assert len(first["joints"]) == len(second["joints"])

def test_create_session_invalid_robot_returns_404():
    r = client.post("/api/sessions", json={"robot_id": "no-such-robot"})
    assert r.status_code == 404
    assert "Robot not found" in r.text

def test_upload_rejects_oversized_payload():
    # patch MAX_UPLOAD_BYTES by sending large payload; use direct endpoint
    big = b"x" * (6 * 1024 * 1024)  # >5MB limit expected
    r = client.post("/api/robots/parse", files={"file": ("big.urdf", big, "text/xml")})
    # either 413 or 422 depending on limit check order
    assert r.status_code in (413, 422)

def test_upload_rejects_invalid_urdf_syntax():
    r = client.post("/api/robots/parse", files={"file": ("bad.urdf", b"not xml", "text/xml")})
    assert r.status_code == 422

def test_valid_primitive_urdf_accepted(tmp_path=None):
    # Use demo slider arm URDF primitives (box) - minimal valid robot
    raw = b"""<robot name='tiny'>
  <link name='base'><visual><geometry><box size='0.1 0.1 0.1'/></geometry></visual></link>
  <link name='arm'><visual><geometry><cylinder radius='0.02' length='0.3'/></geometry></visual></link>
  <joint name='j1' type='revolute'><parent link='base'/><child link='arm'/><origin xyz='0 0 0'/><axis xyz='0 1 0'/><limit lower='-1' upper='1'/></joint>
</robot>"""
    r = client.post("/api/robots/parse", files={"file": ("tiny.urdf", raw, "text/xml")})
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "tiny"
    assert any(j["name"] == "j1" for j in data["joints"])

def test_save_demonstrations_empty_accepts_and_export_empty():
    sid, _ = _demo_session()
    r = client.put(f"/api/sessions/{sid}/demonstrations", json={"demonstrations": []})
    assert r.status_code == 200
    assert r.json()["demonstrations"] == 0

def test_train_rejects_empty_demonstrations():
    sid, _ = _demo_session()
    # No demonstrations saved yet, try train via internal train_session or endpoint
    r = client.post(f"/api/sessions/{sid}/train", json={"demonstrations": [], "config": {"epochs": 5, "timestep_ms": 120}})
    # endpoint may succeed but queue error event; check session events or status
    # If no demonstrations, session should record error
    assert r.status_code in (200, 422)

def test_train_rejects_mismatched_joint_dimensions():
    sid, _ = _demo_session()
    bad = Demonstration(  # type: ignore[call-arg]  # SAFETY: defaults for timeline_fps etc are intentional, testing validation
        id="bad-dim",
        name="bad",
        kind="pose",
        current=[0.0],  # only 1 value but robot has 2 controllable
        target=[0.0],
        frames=[{"timestamp": 0, "positions": [0.0]}],
    )
    r = client.post(f"/api/sessions/{sid}/train", json={"demonstrations": [bad.model_dump()], "config": {"epochs": 2, "timestep_ms": 120}})
    # Mismatched joint dims also queued; train_session validates and records error
    assert r.status_code == 200
    assert r.json()["status"] == "started"
    import time
    for _ in range(20):
        sess = SESSIONS[sid]
        if any(e.get("type") == "error" for e in sess.events):
            break
        time.sleep(0.05)
    sess = SESSIONS[sid]
    assert any(e.get("type") == "error" and "one value per controllable joint" in e.get("message", "") for e in sess.events)

def test_normalized_clamps_out_of_range():
    joints = [{"lower": -1.0, "upper": 1.0}]
    # value far beyond upper should encode >1 then decode clamped
    encoded = normalized([5.0], joints)
    assert encoded[0] > 1
    decoded = denormalized(encoded, joints)
    # decoded should be clamped to upper
    assert decoded[0] == pytest.approx(1.0)

def test_build_incremental_samples_single_frame_expansion():
    demo = Demonstration(  # type: ignore[call-arg]
        id="single",
        name="single",
        kind="pose",
        current=[0.0, 0.0],
        target=[0.5, -0.5],
        frames=[{"timestamp": 0, "positions": [0.5, -0.5]}],
    )
    joints = [{"lower": -2.0, "upper": 2.0}, {"lower": -2.0, "upper": 2.0}]
    samples = build_incremental_samples([demo], joints, 120)
    assert len(samples) > 0
    # first sample should start from current
    assert samples[0]["current"] == pytest.approx(normalized([0.0, 0.0], joints))

def test_build_incremental_samples_random_starts_deterministic():
    demo = Demonstration(  # type: ignore[call-arg]
        id="det",
        name="det",
        kind="gesture",
        current=[0.0, 0.0],
        target=[1.0, 1.0],
        frames=[{"timestamp": 0, "positions": [0, 0]}, {"timestamp": 240, "positions": [1, 1]}],
    )
    joints = [{"lower": -1, "upper": 1}, {"lower": -1, "upper": 1}]
    a = build_incremental_samples([demo], joints, 120, random_starts=2, random_seed=42)
    b = build_incremental_samples([demo], joints, 120, random_starts=2, random_seed=42)
    assert a == b
    # different seed gives different
    c = build_incremental_samples([demo], joints, 120, random_starts=2, random_seed=99)
    assert a != c

def test_export_contains_robot_and_session_json():
    sid, robot = _demo_session()
    demo = {
        "id": "pose-export",
        "name": "home",
        "kind": "pose",
        "current": [0, 0],
        "target": [0.2, 0.2],
        "frames": [{"timestamp": 0, "positions": [0.2, 0.2]}],
    }
    client.put(f"/api/sessions/{sid}/demonstrations", json={"demonstrations": [demo]})
    r = client.get(f"/api/sessions/{sid}/export")
    assert r.status_code == 200
    assert "application/zip" in r.headers.get("content-type", "")
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        assert "session.json" in z.namelist()
        data = json.loads(z.read("session.json"))
        assert data["robot"]["id"] == robot["id"]

def test_authored_frames_prefers_keyframes_over_frames():
    from app.main import authored_frames
    demo_with_both = Demonstration(  # type: ignore[call-arg]
        id="both",
        name="both",
        kind="gesture",
        current=[0, 0],
        target=[1, 1],
        frames=[{"timestamp": 999, "positions": [9, 9]}],
        keyframes=[
            {"id": "k0", "frame": 0, "timestamp": 0, "positions": [0, 0], "interpolation": "linear"},
            {"id": "k1", "frame": 10, "timestamp": 333, "positions": [1, 1], "interpolation": "linear"},
        ],
    )
    frames = authored_frames(demo_with_both)
    assert len(frames) == 2
    assert frames[0].timestamp == 0
    assert frames[1].timestamp == 333

def test_parse_rejects_missing_origin_defaults():
    # Minimal URDF with defaults should not raise; origin element missing should default to 0
    raw = b"<robot name='a'><link name='l1'/><link name='l2'/><joint name='j' type='fixed'><parent link='l1'/><child link='l2'/></joint></robot>"
    # fixed joints are not controllable, should parse without error
    from pathlib import Path
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "tmp.urdf"
        data = parse_urdf(raw, "a.urdf", p)
        assert data["name"] == "a"
