import numpy as np
import pytest
cv2 = pytest.importorskip("cv2")
from tools.camera_calibration import solve_calibration


def observations():
    rng = np.random.default_rng(4)
    board = np.zeros((54, 3), np.float32)
    board[:, :2] = np.mgrid[0:9, 0:6].T.reshape(-1, 2) * .025
    intrinsic = np.array([[800., 0, 320], [0, 800., 240], [0, 0, 1]])
    objects, points = [], [[], [], []]
    baselines = [0, -.4, .4]
    for _ in range(20):
        rotation = rng.uniform(-.5, .5, 3)
        translation = np.array([rng.uniform(-.15, .15), rng.uniform(-.15, .15), rng.uniform(.9, 1.5)])
        objects.append(board.copy())
        for camera, baseline in zip(points, baselines):
            shifted = translation + np.array([baseline, 0, 0])
            image, _ = cv2.projectPoints(board, rotation, shifted, intrinsic, np.zeros(5))
            camera.append(image.astype(np.float32))
    return objects, points


def test_three_camera_calibration_recovers_known_baselines_and_intrinsics():
    objects, points = observations()
    result = solve_calibration(objects, points, [(640, 480)] * 3)
    assert result["rms_px"] < .01
    assert len(result["cameras"]) == 3
    assert result["cameras"][1]["translation"][0] == pytest.approx(-.4, abs=.002)
    assert result["cameras"][2]["translation"][0] == pytest.approx(.4, abs=.002)
    assert result["cameras"][0]["intrinsic"][0] == pytest.approx(800, abs=1)


def test_calibration_rejects_too_few_poses_and_no_board_movement():
    objects, points = observations()
    with pytest.raises(ValueError, match="12 shared"):
        solve_calibration(objects[:5], [p[:5] for p in points], [(640, 480)] * 3)
    with pytest.raises(ValueError, match="Move and tilt"):
        solve_calibration([objects[0]] * 20, [[p[0]] * 20 for p in points], [(640, 480)] * 3)


def test_misaligned_camera_observations_fail_stereo_quality_gate():
    objects, points = observations()
    points[1] = points[1][1:] + points[1][:1]
    with pytest.raises(ValueError, match="Stereo calibration RMS"):
        solve_calibration(objects, points, [(640, 480)] * 3)


def test_exported_video_calibration_detects_real_checkerboard_pixels(tmp_path):
    from tools.calibrate_camera_rig import calibrate_videos
    intrinsic = np.array([[600., 0, 320], [0, 600., 240], [0, 0, 1]])
    board = np.zeros((350, 500), np.uint8)
    for row in range(7):
        for col in range(10):
            board[row*50:(row+1)*50, col*50:(col+1)*50] = 255 if (row+col) % 2 else 0
    outer = np.array([[-.025, -.025, 0], [.225, -.025, 0], [.225, .15, 0], [-.025, .15, 0]])
    pixels = np.float32([[0, 0], [499, 0], [499, 349], [0, 349]])
    paths = [tmp_path / f"view-{i+1}.avi" for i in range(2)]
    writers = [cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 10, (640, 480)) for path in paths]
    if not all(writer.isOpened() for writer in writers):
        pytest.fail("OpenCV MJPEG encoder is unavailable")
    rng = np.random.default_rng(8)
    try:
        for _ in range(20):
            rotation = rng.uniform(-.4, .4, 3)
            translation = np.array([rng.uniform(-.12, .08), rng.uniform(-.12, .06), rng.uniform(.7, 1)])
            for index, writer in enumerate(writers):
                projected, _ = cv2.projectPoints(outer, rotation, translation + [index*-.25, 0, 0], intrinsic, np.zeros(5))
                homography = cv2.getPerspectiveTransform(pixels, projected.reshape(-1, 2).astype(np.float32))
                image = cv2.warpPerspective(board, homography, (640, 480), borderValue=180)
                color = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
                for _ in range(3):
                    writer.write(color)
    finally:
        for writer in writers:
            writer.release()
    result = calibrate_videos(paths, samples=20)
    assert result["shared_poses"] >= 12
    assert result["rms_px"] < 2
    assert result["cameras"][1]["translation"][0] == pytest.approx(-.25, abs=.02)
