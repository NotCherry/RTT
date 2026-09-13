import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException

from app.main import (
    DEMO_URDF, ROBOTS, SESSIONS, SESSION_IDLE_SECONDS, Demonstration,
    SessionRequest, TrainConfig, TrainRequest, _resolve_rollout_step,
    create_session, delete_session, demo_robot, expire_idle_sessions,
    save_datasets, DatasetsRequest,
    build_physics_feasible_samples,
    parse_urdf, train_session,
)
from app.session_runtime import SessionEvents, serialized


@pytest.fixture(autouse=True)
def cleanup():
    yield
    for session in list(SESSIONS.values()):
        session.close()
    SESSIONS.clear()
    ROBOTS.clear()


def test_events_are_delivered_once_while_producers_run():
    events = SessionEvents()
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(lambda start=start: [events.append(i) for i in range(start, start + 1000)]) for start in (0, 1000)]
        delivered = events.drain()
        for future in futures:
            future.result()
    delivered.extend(events.drain())
    assert sorted(delivered) == list(range(2000))
    assert events.drain() == []


def test_serialized_transaction_excludes_other_session_operations():
    class Session:
        lock = threading.RLock()

        @serialized
        def read(self):
            return True

    session = Session()
    started = threading.Event()
    with ThreadPoolExecutor(max_workers=1) as executor:
        with session.lock:
            future = executor.submit(lambda: (started.set(), session.read())[1])
            assert started.wait(1)
            assert not future.done()
        assert future.result(timeout=1)


def test_physics_failure_is_not_reported_as_zero_error():
    class FailedPhysics:
        def servo_to_positions(self, *args):
            raise RuntimeError("disconnected")

    with pytest.raises(HTTPException) as error:
        _resolve_rollout_step(FailedPhysics(), [0.1], 120, True)
    assert error.value.status_code == 503


def test_parser_rejects_indefinite_inertia(tmp_path):
    inertial = "<inertial><mass value='1'/><inertia ixx='1' iyy='1' izz='1' ixy='2' ixz='0' iyz='0'/></inertial>"
    raw = DEMO_URDF.replace('<link name="shoulder">', '<link name="shoulder">' + inertial)
    with pytest.raises(ValueError, match="positive-definite"):
        parse_urdf(raw.encode(), "bad.urdf", tmp_path / "bad.urdf")


def test_sessions_close_expire_and_keep_active_training():
    robot = demo_robot()
    session_id = create_session(SessionRequest(robot_id=robot["id"]))["session_id"]
    session = SESSIONS[session_id]
    session.training = True
    deadline = session.last_activity + SESSION_IDLE_SECONDS + 1
    expire_idle_sessions(deadline)
    assert session_id in SESSIONS
    with pytest.raises(HTTPException):
        delete_session(session_id)
    session.training = False
    expire_idle_sessions(deadline)
    assert session_id not in SESSIONS
    assert delete_session(session_id) == {"status": "closed"}


def test_closed_session_cannot_mutate_a_new_physics_client():
    robot = demo_robot()
    old_id = create_session(SessionRequest(robot_id=robot["id"]))["session_id"]
    old = SESSIONS[old_id]
    delete_session(old_id)
    new_id = create_session(SessionRequest(robot_id=robot["id"]))["session_id"]
    new = SESSIONS[new_id]
    with pytest.raises(ValueError, match="closed"):
        old.step()
    with pytest.raises(ValueError, match="closed"):
        old.begin_training()
    old.close()
    assert new.state()["positions"] == [0, 0]


def test_rest_archive_activity_renews_session_lease(monkeypatch):
    robot = demo_robot()
    sid = create_session(SessionRequest(robot_id=robot["id"]))["session_id"]
    session = SESSIONS[sid]
    now = session.last_activity + SESSION_IDLE_SECONDS - 1
    monkeypatch.setattr("app.main.time.monotonic", lambda: now)
    save_datasets(sid, DatasetsRequest(datasets=[]))
    expire_idle_sessions(now + 2)
    assert sid in SESSIONS


def test_training_subset_does_not_replace_archive():
    robot = demo_robot()
    session_id = create_session(SessionRequest(robot_id=robot["id"]))["session_id"]
    session = SESSIONS[session_id]
    pose = Demonstration(id="trained", current=[0, 0], target=[0.1, 0.2])
    session.demonstrations = [pose.model_dump(), {**pose.model_dump(), "id": "other"}]
    train_session(session, TrainRequest(demonstrations=[pose], config=TrainConfig(epochs=1, random_starts=0, physics=False)))
    assert [demo["id"] for demo in session.demonstrations] == ["trained", "other"]
    assert any(event["type"] == "training_complete" for event in session.events)


def test_training_physics_fallback_is_reported(monkeypatch):
    robot = demo_robot()
    sid = create_session(SessionRequest(robot_id=robot["id"]))["session_id"]
    session = SESSIONS[sid]
    def fail(*args):
        raise RuntimeError("servo failed")
    monkeypatch.setattr(session, "servo_to_positions", fail)
    samples = [{"current": [0, 0], "delta": [0.1, 0.2]}]
    assert build_physics_feasible_samples(samples, session.joints, 120, session) == samples
    assert any("1 of 1" in event.get("message", "") for event in session.events)


def test_cancelled_training_exits_without_publishing_a_model():
    robot = demo_robot()
    sid = create_session(SessionRequest(robot_id=robot["id"]))["session_id"]
    session = SESSIONS[sid]
    session.cancel_training.set()
    pose = Demonstration(current=[0, 0], target=[0.1, 0.2])
    train_session(session, TrainRequest(demonstrations=[pose]))
    assert session.model is None
    assert session.closed
    assert not session.training
