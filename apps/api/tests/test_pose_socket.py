from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.main import ROBOTS, SESSIONS, app


@pytest.fixture(autouse=True)
def clean_sessions():
    yield
    for session in list(SESSIONS.values()):
        session.close()
    SESSIONS.clear()
    ROBOTS.clear()


def receive_state(socket):
    while True:
        message = socket.receive_json()
        if message["type"] == "state":
            return message


def wait_for_positions(socket, expected):
    for _ in range(50):
        if receive_state(socket)["positions"] == expected:
            return
    pytest.fail(f"The socket never reported the requested pose: {expected}")


@pytest.mark.parametrize("robot_path", ["/api/robots/demo", "/api/robots/default"])
def test_pose_stays_exact_while_idle_after_edit_and_reset(robot_path, monkeypatch):
    with TestClient(app) as client:
        robot = client.get(robot_path).json()
        response = client.post("/api/sessions", json={"robot_id": robot["id"]})
        assert response.status_code == 200
        payload = response.json()
        session = SESSIONS[payload["session_id"]]
        step = Mock(wraps=session.step)
        monkeypatch.setattr(session, "step", step)
        expected = payload["state"]["positions"]

        with client.websocket_connect(f"/ws/sessions/{session.id}") as socket:
            for _ in range(5):
                assert receive_state(socket)["positions"] == expected

            edited = list(expected)
            edited[0] = 0.25
            socket.send_json({"type": "set_positions", "positions": edited})
            wait_for_positions(socket, edited)
            for _ in range(5):
                assert receive_state(socket)["positions"] == edited

            socket.send_json({"type": "reset"})
            wait_for_positions(socket, expected)
            for _ in range(5):
                assert receive_state(socket)["positions"] == expected
            step.assert_not_called()

            # An explicit physics command still advances the simulation once.
            socket.send_json({"type": "step"})
            for _ in range(50):
                receive_state(socket)
                if step.called:
                    break
            step.assert_called_once_with()
            for _ in range(5):
                receive_state(socket)
            step.assert_called_once_with()
