import base64
import numpy as np
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.camera_calibration_worker import execute, isolated_calibration, make_board

cv2 = pytest.importorskip("cv2")
BOARD = {"columns": 10, "rows": 7, "square_m": .025, "marker_m": .018}


def samples(count=20):
    board = make_board(cv2, BOARD).getChessboardCorners()
    intrinsic = np.array([[900., 0, 640], [0, 900., 360], [0, 0, 1]])
    rng = np.random.default_rng(7)
    observations = []
    for _ in range(count):
        rotation = rng.uniform(-.5, .5, 3)
        translation = np.array([rng.uniform(-.15, .1), rng.uniform(-.15, .1), rng.uniform(.9, 1.5)])
        views = []
        for i, baseline in enumerate([0, -.4, .4]):
            projected, _ = cv2.projectPoints(board, rotation, translation + [baseline, 0, 0], intrinsic, np.zeros(5))
            views.append({"id": f"view-{i+1}", "width": 1280, "height": 720, "ids": list(range(len(board))), "points": projected.reshape(-1, 2).tolist()})
        observations.append(views)
    return {"board": BOARD, "observations": observations}


def test_guided_calibration_recovers_geometry_with_held_out_validation():
    result = execute("solve", samples())
    assert result["rms_px"] < .01
    assert max(result["validation_rms_px"]) < .02
    assert result["cameras"][1]["translation"][0] == pytest.approx(-.4, abs=.002)
    assert result["timing"] == "unverified"


def test_held_out_bad_correspondence_cannot_be_hidden_by_fit_error():
    payload = samples()
    for view in payload["observations"][-1][1:]:
        view["points"] = [[x+20, y] for x, y in view["points"]]
    with pytest.raises(ValueError, match="Held-out"):
        execute("solve", payload)


def test_board_detection_uses_real_charuco_pixels_in_isolated_process():
    board = isolated_calibration("board", {"board": BOARD})
    result = isolated_calibration("detect", {"board": BOARD, "views": [{"id": f"view-{i}", "jpeg": board["png"]} for i in (1, 2)]})
    assert all(len(view["ids"]) == 54 for view in result["views"])
    image = cv2.imdecode(np.frombuffer(base64.b64decode(board["png"]), np.uint8), cv2.IMREAD_GRAYSCALE)
    assert image.shape == (700, 1000)


def test_guided_api_rejects_wrong_views_and_unsafe_board_dimensions():
    client = TestClient(app)
    assert client.post("/api/camera-calibration/board", json={**BOARD, "marker_m": .03}).status_code == 422
    payload = samples()
    payload["observations"][1][1]["id"] = "view-1"
    assert client.post("/api/camera-calibration/solve", json=payload).status_code == 422
    payload = samples()
    payload["observations"][1][0]["points"][0][0] = -10
    assert client.post("/api/camera-calibration/solve", json=payload).status_code == 422


def test_calibration_timeout_reaps_the_child_process():
    import multiprocessing as mp
    before = {p.pid for p in mp.active_children()}
    with pytest.raises(TimeoutError):
        isolated_calibration("board", {"board": BOARD}, timeout=0)
    assert {p.pid for p in mp.active_children()} == before
