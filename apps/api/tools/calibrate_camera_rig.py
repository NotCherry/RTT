"""Create RTT calibration JSON from locally exported, synchronized camera videos."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.camera_calibration import solve_calibration


def calibrate_videos(videos, columns=9, rows=6, square_m=.025, samples=60, timing=None, maximum_rms=2):
    import cv2
    import numpy as np
    if len(videos) not in (2, 3) or not 3 <= columns <= 20 or not 3 <= rows <= 20:
        raise ValueError("Use two/three videos and a checkerboard with 3–20 inner corners per axis")
    if not np.isfinite(square_m) or not .001 <= square_m <= .2 or not 12 <= samples <= 200:
        raise ValueError("Use a measured square size 0.001–0.2 m and 12–200 samples")
    offsets = [0.0] * len(videos)
    if timing:
        metadata = json.loads(Path(timing).read_text())
        views = metadata.get("views", [])
        if metadata.get("version") != 1 or len(views) != len(videos):
            raise ValueError("Timing file must match the number and order of camera videos")
        if [v.get("id") for v in views] != [f"view-{i+1}" for i in range(len(videos))]:
            raise ValueError("Timing views must be ordered view-1, view-2, then view-3")
        offsets = [float(v["offset_ms"]) for v in views]
        if not all(np.isfinite(offsets)):
            raise ValueError("Camera offsets must be finite")
    captures = [cv2.VideoCapture(str(path)) for path in videos]
    try:
        if any(not capture.isOpened() for capture in captures):
            raise ValueError("A camera video could not be decoded")
        sizes = [(int(c.get(cv2.CAP_PROP_FRAME_WIDTH)), int(c.get(cv2.CAP_PROP_FRAME_HEIGHT))) for c in captures]
        durations = []
        for capture in captures:
            fps = capture.get(cv2.CAP_PROP_FPS)
            if not np.isfinite(fps) or fps <= 0:
                raise ValueError("Video frame rate is unavailable")
            durations.append(capture.get(cv2.CAP_PROP_FRAME_COUNT) / fps * 1000)
        start, end = max(offsets), min(offset + duration for offset, duration in zip(offsets, durations))
        if not np.isfinite(end) or end <= start:
            raise ValueError("Camera recordings have no shared time range")
        template = np.zeros((columns * rows, 3), np.float32)
        template[:, :2] = np.mgrid[0:columns, 0:rows].T.reshape(-1, 2) * square_m
        objects, image_points = [], [[] for _ in captures]
        for timestamp in np.linspace(start, end - 100, samples):
            corners = []
            for capture, offset in zip(captures, offsets):
                capture.set(cv2.CAP_PROP_POS_MSEC, max(0, timestamp - offset))
                ok, image = capture.read()
                if not ok:
                    break
                found, points = cv2.findChessboardCornersSB(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY),
                    (columns, rows), flags=cv2.CALIB_CB_NORMALIZE_IMAGE)
                if not found:
                    break
                corners.append(points)
            if len(corners) == len(captures):
                objects.append(template.copy())
                for target, points in zip(image_points, corners):
                    target.append(points)
        return solve_calibration(objects, image_points, sizes, maximum_rms)
    finally:
        for capture in captures:
            capture.release()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("videos", nargs="+", type=Path, help="Primary view first, then view-2/view-3")
    parser.add_argument("--columns", type=int, default=9, help="Inner checkerboard corners, not squares")
    parser.add_argument("--rows", type=int, default=6)
    parser.add_argument("--square-m", type=float, default=.025, help="Measured square edge in metres")
    parser.add_argument("--samples", type=int, default=60)
    parser.add_argument("--timing", type=Path, help="camera-timing.json exported with videos")
    parser.add_argument("--maximum-rms", type=float, default=2)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = calibrate_videos(args.videos, args.columns, args.rows, args.square_m, args.samples, args.timing, args.maximum_rms)
    except (ValueError, ImportError) as error:
        parser.error(str(error))
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"calibrated_cameras": len(result["cameras"]), "rms_px": result["rms_px"], "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
