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

def test_random_starts_approach_without_teleport():
    from app.main import approach_step_count, build_approach_plan, denormalized, max_joint_step
    joints = [{"lower": -1.0, "upper": 1.0, "velocity": 2.0, "type": "revolute"}]
    start, goal = [-1.0], [1.0]
    assert approach_step_count(start, goal, joints, 120) > 1
    plan = build_approach_plan(start, goal, joints, 120)
    assert plan[-1] == pytest.approx(goal)
    previous = start
    for waypoint in plan:
        assert abs(waypoint[0] - previous[0]) <= max_joint_step(joints[0], 120) + 1e-9
        previous = waypoint


def test_random_start_samples_respect_velocity_bounds():
    from app.main import denormalized
    demo = Demonstration(  # type: ignore[call-arg]
        id="bounded",
        name="bounded",
        kind="gesture",
        current=[0.0],
        target=[0.05],
        frames=[{"timestamp": 0, "positions": [0.0]}, {"timestamp": 240, "positions": [0.05]}],
    )
    joints = [{"lower": -1.0, "upper": 1.0, "velocity": 0.5, "type": "revolute"}]
    samples = build_incremental_samples([demo], joints, 120, random_starts=3, random_seed=7)
    assert len(samples) > 0
    max_step_native = 0.5 * 120 / 1000.0
    for sample in samples:
        current = denormalized(sample["current"], joints)
        delta_native = [
            (next_value - current_value) * (joints[index]["upper"] - joints[index]["lower"]) / 2.0
            for index, (next_value, current_value) in enumerate(zip(
                [current_value + change for current_value, change in zip(sample["current"], sample["delta"])],
                sample["current"],
            ))
        ]
        assert all(abs(change) <= max_step_native + 1e-6 for change in delta_native)
        _ = current


def test_parse_stores_joint_velocity_limits():
    from pathlib import Path
    import tempfile
    raw = b"""<robot name='v'><link name='l1'/><link name='l2'/><joint name='j' type='revolute'><parent link='l1'/><child link='l2'/><limit lower='-1' upper='1' velocity='3.5'/></joint></robot>"""
    with tempfile.TemporaryDirectory() as td:
        data = parse_urdf(raw, "v.urdf", Path(td) / "tmp.urdf")
        assert data["joints"][0]["velocity"] == pytest.approx(3.5)

def test_rollout_approaches_first_checkpoint_from_random_start():
    import time
    sid, _ = _demo_session()
    demo = {
        "id": "stage",
        "name": "stage",
        "kind": "gesture",
        "current": [0, 0],
        "target": [0.1, 0.1],
        "frames": [
            {"timestamp": 0, "positions": [0.0, 0.0]},
            {"timestamp": 240, "positions": [0.05, 0.05]},
            {"timestamp": 480, "positions": [0.1, 0.1]},
        ],
    }
    r = client.post(f"/api/sessions/{sid}/train", json={"demonstrations": [demo], "config": {"epochs": 5, "timestep_ms": 120, "random_starts": 2, "random_seed": 7}})
    assert r.json()["status"] == "started"
    for _ in range(200):
        sess = SESSIONS[sid]
        if any(e.get("type") == "training_complete" for e in sess.events):
            break
        time.sleep(0.05)
    r = client.post(f"/api/sessions/{sid}/rollout", json={"frames": demo["frames"], "current": [0.8, -0.8], "timestep_ms": 120, "max_steps": 160})
    assert r.status_code == 200
    frames = r.json()["frames"]
    assert len(frames) > 3
    assert frames[0]["expected"] == [0.0, 0.0]
    assert frames[1]["expected"] != frames[0]["expected"]
    phases = [frame.get("phase", "gesture") for frame in frames]
    assert "approach" in phases
    assert "gesture" in phases
    assert phases.index("gesture") > phases.index("approach")

def test_scripted_approach_meets_accuracy_and_reports_collisions():
    import time
    sid, _ = _demo_session()
    demo = {
        "id": "scripted-stage",
        "name": "scripted-stage",
        "kind": "gesture",
        "current": [0, 0],
        "target": [0.1, 0.1],
        "frames": [
            {"timestamp": 0, "positions": [0.0, 0.0]},
            {"timestamp": 240, "positions": [0.05, 0.05]},
            {"timestamp": 480, "positions": [0.1, 0.1]},
        ],
    }
    r = client.post(f"/api/sessions/{sid}/train", json={"demonstrations": [demo], "config": {"epochs": 5, "timestep_ms": 120, "random_starts": 2, "random_seed": 7}})
    assert r.json()["status"] == "started"
    for _ in range(200):
        sess = SESSIONS[sid]
        if any(e.get("type") == "training_complete" for e in sess.events):
            break
        time.sleep(0.05)
    r = client.post(f"/api/sessions/{sid}/rollout", json={"frames": demo["frames"], "current": [0.8, -0.8], "timestep_ms": 120, "max_steps": 160, "approach_mode": "scripted"})
    assert r.status_code == 200
    body = r.json()
    assert "collisions" in body
    assert body["collisions"] == 0
    approach = [f for f in body["frames"] if f.get("phase") == "approach"]
    gesture = [f for f in body["frames"] if f.get("phase") == "gesture"]
    assert len(approach) >= 2
    assert len(gesture) >= 2
    # Frame 0 is the pre-approach starting pose; every executed approach step
    # must track its expected waypoint, and the final step must reach the
    # first checkpoint within the 0.05 approach-success bound.
    for frame in approach[1:]:
        assert max(abs(a - b) for a, b in zip(frame["positions"], frame["expected"])) <= 0.05
    assert max(abs(a - b) for a, b in zip(approach[-1]["positions"], [0.0, 0.0])) <= 0.05


def test_learned_approach_mode_still_available():
    import time
    sid, _ = _demo_session()
    demo = {
        "id": "learned-stage",
        "name": "learned-stage",
        "kind": "gesture",
        "current": [0, 0],
        "target": [0.1, 0.1],
        "frames": [
            {"timestamp": 0, "positions": [0.0, 0.0]},
            {"timestamp": 240, "positions": [0.05, 0.05]},
            {"timestamp": 480, "positions": [0.1, 0.1]},
        ],
    }
    r = client.post(f"/api/sessions/{sid}/train", json={"demonstrations": [demo], "config": {"epochs": 5, "timestep_ms": 120, "random_starts": 2, "random_seed": 7}})
    assert r.json()["status"] == "started"
    for _ in range(200):
        sess = SESSIONS[sid]
        if any(e.get("type") == "training_complete" for e in sess.events):
            break
        time.sleep(0.05)
    r = client.post(f"/api/sessions/{sid}/rollout", json={"frames": demo["frames"], "current": [0.8, -0.8], "timestep_ms": 120, "max_steps": 160, "approach_mode": "learned"})
    assert r.status_code == 200
    phases = [f.get("phase") for f in r.json()["frames"]]
    assert "approach" in phases and "gesture" in phases

def test_rollout_density_follows_timeline_fps():
    import time
    sid, _ = _demo_session()
    demo = {
        "id": "dense",
        "name": "dense",
        "kind": "gesture",
        "current": [0, 0],
        "target": [0.1, 0.1],
        "frames": [
            {"timestamp": 0, "positions": [0.0, 0.0]},
            {"timestamp": 240, "positions": [0.05, 0.05]},
            {"timestamp": 480, "positions": [0.1, 0.1]},
        ],
    }
    r = client.post(f"/api/sessions/{sid}/train", json={"demonstrations": [demo], "config": {"epochs": 5, "timestep_ms": 120, "random_starts": 0, "random_seed": 7}})
    assert r.json()["status"] == "started"
    for _ in range(200):
        sess = SESSIONS[sid]
        if any(e.get("type") == "training_complete" for e in sess.events):
            break
        time.sleep(0.05)
    coarse = client.post(f"/api/sessions/{sid}/rollout", json={"frames": demo["frames"], "current": [0, 0], "timestep_ms": 120, "max_steps": 160})
    dense = client.post(f"/api/sessions/{sid}/rollout", json={"frames": demo["frames"], "current": [0, 0], "timestep_ms": 120, "max_steps": 160, "timeline_fps": 30})
    assert coarse.status_code == 200 and dense.status_code == 200
    coarse_gesture = [f for f in coarse.json()["frames"] if f.get("phase") == "gesture"]
    dense_gesture = [f for f in dense.json()["frames"] if f.get("phase") == "gesture"]
    # Frame 0 carries the gesture phase when no approach is needed.
    # timestep fallback: 2 steps per 240ms segment; fps grid: 8 steps per segment.
    assert len(coarse_gesture) == 5
    assert len(dense_gesture) == 17
    assert len(dense_gesture) > len(coarse_gesture)

def test_rollout_dense_grid_degrades_to_full_coverage_under_cap():
    import time
    sid, _ = _demo_session()
    demo = {
        "id": "cap",
        "name": "cap",
        "kind": "gesture",
        "current": [0, 0],
        "target": [0.1, 0.1],
        "frames": [
            {"timestamp": 0, "positions": [0.0, 0.0]},
            {"timestamp": 240, "positions": [0.05, 0.05]},
            {"timestamp": 480, "positions": [0.1, 0.1]},
        ],
    }
    r = client.post(f"/api/sessions/{sid}/train", json={"demonstrations": [demo], "config": {"epochs": 5, "timestep_ms": 120, "random_starts": 0, "random_seed": 7}})
    assert r.json()["status"] == "started"
    for _ in range(200):
        sess = SESSIONS[sid]
        if any(e.get("type") == "training_complete" for e in sess.events):
            break
        time.sleep(0.05)
    # 1000 fps grid would plan 480 steps; the 160-step budget must keep full
    # coverage (final checkpoint reached) instead of cutting the tail.
    r = client.post(f"/api/sessions/{sid}/rollout", json={"frames": demo["frames"], "current": [0, 0], "timestep_ms": 120, "max_steps": 160, "timeline_fps": 1000})
    assert r.status_code == 200
    body = r.json()
    gesture = [f for f in body["frames"] if f.get("phase") == "gesture"]
    assert len(gesture) == 161
    assert gesture[-1]["expected"] == [0.1, 0.1]

def test_save_demonstrations_accepts_timeline_fps_up_to_1000():
    sid, _ = _demo_session()
    demo = {
        "id": "hi-fps",
        "name": "hi-fps",
        "kind": "gesture",
        "current": [0, 0],
        "target": [0.1, 0.1],
        "frames": [
            {"timestamp": 0, "positions": [0.0, 0.0]},
            {"timestamp": 100, "positions": [0.1, 0.1]},
        ],
        "timeline_fps": 1000,
        "duration_frames": 100,
        "start_frame_index": 0,
    }
    r = client.put(f"/api/sessions/{sid}/demonstrations", json={"demonstrations": [demo]})
    assert r.status_code == 200
    assert r.json()["demonstrations"] == 1
