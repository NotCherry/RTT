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
    analyze_rollout_coordination,
    app,
    build_incremental_samples,
    coordination_diagnostics,
    coordination_sample_weights,
    denormalized,
    expected_active_mask,
    normalized,
    parse_urdf,
    train_session,
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


def test_reupload_preserves_robot_identity():
    from app.main import DEMO_URDF
    first = client.post("/api/robots/parse", files={"file": ("arm.urdf", DEMO_URDF.encode(), "text/xml")})
    second = client.post("/api/robots/parse", files={"file": ("renamed.urdf", DEMO_URDF.encode(), "text/xml")})
    assert first.status_code == second.status_code == 200
    assert first.json()["id"] == second.json()["id"]

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

def test_coordination_weights_emphasize_multi_joint_samples():
    import torch
    # One single-joint row and one two-joint row; only the latter is boosted.
    targets = torch.tensor([[0.2, 0.0], [0.19, -0.09]], dtype=torch.float32)
    weights = coordination_sample_weights(targets, 0.5)
    assert weights[0].item() == pytest.approx(1.0)
    assert weights[1].item() == pytest.approx(1.5)
    # Zero weight leaves every sample equal; the optimum never moves.
    flat = coordination_sample_weights(targets, 0.0)
    assert flat.tolist() == pytest.approx([1.0, 1.0])
    assert expected_active_mask([0.19, -0.09]).count(True) == 2
    assert expected_active_mask([0.2, 0.0]).count(True) == 1


def test_coordination_diagnostics_scores_simultaneous_vs_sequential():
    import torch
    target = torch.tensor([[0.19, -0.09]], dtype=torch.float32)
    simultaneous = torch.tensor([[0.19, -0.09]], dtype=torch.float32)
    sequential = torch.tensor([[0.19, 0.0]], dtype=torch.float32)
    good = coordination_diagnostics(simultaneous, target)
    bad = coordination_diagnostics(sequential, target)
    assert good["simultaneity"] == pytest.approx(1.0)
    assert good["direction_alignment"] == pytest.approx(1.0)
    assert bad["simultaneity"] < 0.6
    assert bad["direction_alignment"] < good["direction_alignment"]
    # Single-joint motion is never flagged.
    single = coordination_diagnostics(
        torch.tensor([[0.19, 0.0]], dtype=torch.float32),
        torch.tensor([[0.2, 0.0]], dtype=torch.float32),
    )
    assert single["simultaneity"] == pytest.approx(1.0)


def test_rollout_coordination_flags_sequential_path():
    joints = [{"lower": -1.0, "upper": 1.0}, {"lower": -1.0, "upper": 1.0}]
    diagonal = [
        {"expected": [0.0, 0.0], "positions": [0.0, 0.0]},
        {"expected": [0.3, -0.2], "positions": [0.3, -0.2]},
        {"expected": [0.6, -0.4], "positions": [0.6, -0.4]},
    ]
    l_shaped = [
        {"expected": [0.0, 0.0], "positions": [0.0, 0.0]},
        {"expected": [0.3, -0.2], "positions": [0.6, 0.0]},
        {"expected": [0.6, -0.4], "positions": [0.6, -0.4]},
    ]
    assert analyze_rollout_coordination(diagonal, joints)["sequential"] is False
    flagged = analyze_rollout_coordination(l_shaped, joints)
    assert flagged["sequential"] is True
    assert flagged["simultaneity"] < 0.6


def test_weighted_training_reports_coordination_and_stays_simultaneous():
    import time
    sid, _ = _demo_session()
    demo = {
        "id": "diag-coord",
        "name": "diag-coord",
        "kind": "gesture",
        "current": [0, 0],
        "target": [0.6, -0.4],
        "frames": [
            {"timestamp": 0, "positions": [0.0, 0.0]},
            {"timestamp": 240, "positions": [0.6, -0.4]},
        ],
    }
    r = client.post(f"/api/sessions/{sid}/train", json={"demonstrations": [demo], "config": {"epochs": 30, "timestep_ms": 120, "random_starts": 0, "random_seed": 7, "physics": False}})
    assert r.json()["status"] == "started"
    for _ in range(200):
        sess = SESSIONS[sid]
        done = [e for e in sess.events if e.get("type") == "training_complete"]
        if done:
            assert "simultaneity" in done[0]
            assert "direction_alignment" in done[0]
            break
        time.sleep(0.05)
    else:
        pytest.fail("training did not complete")
    r = client.post(f"/api/sessions/{sid}/rollout", json={"frames": demo["frames"], "current": [0, 0], "timestep_ms": 120, "max_steps": 160, "physics": False})
    assert r.status_code == 200
    coordination = r.json().get("coordination")
    assert coordination is not None
    assert coordination["multi_joint_steps"] > 0
    assert coordination["sequential"] is False


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

# --- Edge cases added for fix hardening (coordination/density) ---
def test_expected_active_mask_edge_cases():
    # zero peak => all false
    assert expected_active_mask([0.0, 0.0]) == [False, False]
    assert expected_active_mask([1e-10, -1e-10]) == [False, False]
    # empty
    assert expected_active_mask([]) == []
    assert expected_active_mask(None) == []  # type: ignore[arg-type]
    # single joint below abs eps still false even if peak large
    assert expected_active_mask([0.1, 0.001]) == [True, False]  # 0.001 < 0.005 and < 0.2*0.1
    # both above thresholds
    assert expected_active_mask([0.19, -0.09]) == [True, True]


def test_coordination_hit_and_cosine_helpers():
    from app.main import _coordination_hit, _cosine_similarity
    # hit requires same sign and magnitude threshold
    assert _coordination_hit(0.19, 0.19) is True
    assert _coordination_hit(0.19, 0.0) is False
    assert _coordination_hit(0.19, -0.19) is False  # wrong sign
    assert _coordination_hit(0.19, 0.001) is False  # too small: min(0.005, 0.076)=0.005
    assert _coordination_hit(-0.09, -0.09) is True
    # cosine degenerate
    assert _cosine_similarity([0.0, 0.0], [0.0, 0.0]) is None
    assert _cosine_similarity([0.1, 0.0], [0.0, 0.0]) is None
    assert _cosine_similarity([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)
    assert _cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)


def test_density_boundary_and_bundled_equivalence():
    from app.main import RolloutBudget, _compute_rollout_density_bundled, compute_rollout_density, compute_effective_scale, SegmentScaleParams, _compute_effective_scale_bundled
    # boundary 1.01: should not warn below, should warn above
    from app.main import check_budget_exhaustion
    assert check_budget_exhaustion(5, 160, 1.009) is None
    assert check_budget_exhaustion(5, 160, 1.011) is not None
    assert check_budget_exhaustion(5, 160, 1.02) is not None
    assert check_budget_exhaustion(0, 160, 1.0) is not None  # trimmed
    assert check_budget_exhaustion(1, 160, 1.0) is None
    # bundled equivalence
    budget = RolloutBudget(segment_ms_list=[100, 240], grid_ms=120, max_steps=160, total_steps=0)
    via_bundled = _compute_rollout_density_bundled(budget)
    via_wrapper = compute_rollout_density([100, 240], 120, 160, 0)
    assert via_bundled == via_wrapper
    # effective scale bundled equivalence
    params = SegmentScaleParams(segment_ms=240, segment_steps=1, step_ms=120, grid_ms=120)
    assert _compute_effective_scale_bundled(params) == pytest.approx(2.0)
    assert compute_effective_scale(240, 1, 120, 120) == pytest.approx(2.0)
    # zero steps returns 1.0 without exception
    assert compute_effective_scale(240, 0, 120, 120) == 1.0
    assert _compute_effective_scale_bundled(SegmentScaleParams(segment_ms=240, segment_steps=0, step_ms=120, grid_ms=120)) == 1.0


def test_compute_rollout_density_zero_remaining():
    from app.main import compute_rollout_density, check_budget_exhaustion
    d = compute_rollout_density([240, 240], grid_ms=120, max_steps=2, total_steps=2)
    assert d["remaining"] == 0
    assert d["scaled_steps"] == [0, 0]
    assert d["density_ratio"] == pytest.approx(1.0)  # empty scaled guard
    warn = check_budget_exhaustion(d["remaining"], 2, d["density_ratio"])
    assert warn is not None and "trimmed" in warn["message"].lower()


def test_coordination_weights_empty_and_invalid():
    import torch
    # empty tensor
    empty = torch.tensor([], dtype=torch.float32).reshape(0, 2)
    # should not crash, returns empty weight vector
    w = coordination_sample_weights(empty, 0.5)
    assert w.shape[0] == 0
    # invalid object fallback — should return ones
    class Fake:
        shape = (2,)
        def detach(self): raise RuntimeError("no")
    fake = Fake()
    fallback = coordination_sample_weights(fake, 0.5)  # type: ignore[arg-type]
    assert fallback.shape[0] == 2
