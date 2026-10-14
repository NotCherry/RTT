"""Bounded, process-isolated board detection and calibration operations."""
import base64
import multiprocessing as mp


def execute(operation, payload):
    import cv2
    import numpy as np
    if operation == "solve":
        from tools.camera_calibration import solve_calibration
        observations = payload["observations"]
        if len(observations) < 14:
            raise ValueError("Capture 14 board poses, including two held-out validation poses")
        objects, views = [], [[] for _ in observations[0]]
        sizes = [(v["width"], v["height"]) for v in observations[0]]
        for sample in observations:
            if [(v["width"], v["height"]) for v in sample] != sizes:
                raise ValueError("Camera dimensions changed during calibration")
            common = sorted(set.intersection(*(set(v["ids"]) for v in sample)))
            if len(common) < 12:
                continue
            board = make_board(cv2, payload["board"])
            objects.append(board.getChessboardCorners()[common])
            for points, view in zip(views, sample):
                lookup = dict(zip(view["ids"], view["points"]))
                points.append([lookup[i] for i in common])
        if len(objects) < 14:
            raise ValueError("Need 14 poses with common corners in all cameras")
        result = solve_calibration(objects[:-2], [v[:-2] for v in views], sizes)
        errors = [[] for _ in sizes]
        for points, image_points in zip(objects[-2:], zip(*(v[-2:] for v in views))):
            reference = result["cameras"][0]
            intrinsic = np.array(reference["intrinsic"]).reshape(3, 3)
            found, rvec, tvec = cv2.solvePnP(np.array(points, np.float32), np.array(image_points[0], np.float32), intrinsic, np.array(reference["distortion"]))
            if not found:
                raise ValueError("Held-out board pose could not be reconstructed")
            board_rotation = cv2.Rodrigues(rvec)[0]
            for index, (camera, observed) in enumerate(zip(result["cameras"], image_points)):
                rotation = np.array(camera["rotation"]).reshape(3, 3)
                translation = rotation @ tvec + np.array(camera["translation"]).reshape(3, 1)
                projected, _ = cv2.projectPoints(points, cv2.Rodrigues(rotation @ board_rotation)[0], translation,
                    np.array(camera["intrinsic"]).reshape(3, 3), np.array(camera["distortion"]))
                errors[index].append(float(np.sqrt(np.mean(np.sum((projected.reshape(-1, 2) - np.array(observed).reshape(-1, 2)) ** 2, axis=1)))))
        validation = [max(values) for values in errors]
        if max(validation) > 2:
            raise ValueError("Held-out reprojection error exceeds 2 pixels; improve coverage and timing")
        result["validation_rms_px"] = validation
        result.update({"board": payload["board"], "shared_poses": len(objects), "solver": "opencv-charuco-v1", "units": "metres", "timing": "unverified"})
        return result
    board = make_board(cv2, payload["board"])
    if operation == "board":
        image = board.generateImage((1000, 700), marginSize=25)
        ok, encoded = cv2.imencode(".png", image)
        if not ok:
            raise ValueError("Could not render calibration board")
        return {"png": base64.b64encode(encoded).decode("ascii")}
    detector = cv2.aruco.CharucoDetector(board)
    result = []
    for view in payload["views"]:
        data = base64.b64decode(view["jpeg"], validate=True)
        image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_GRAYSCALE)
        if image is None or max(image.shape) > 4096:
            raise ValueError("Invalid camera image or excessive resolution")
        corners, ids, _, _ = detector.detectBoard(image)
        result.append({"id": view["id"], "width": image.shape[1], "height": image.shape[0],
                       "ids": ids.ravel().tolist() if ids is not None else [],
                       "points": corners.reshape(-1, 2).tolist() if corners is not None else []})
    return {"views": result}


def make_board(cv2, settings):
    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    return cv2.aruco.CharucoBoard((settings["columns"], settings["rows"]), settings["square_m"], settings["marker_m"], dictionary)


def _entry(sender, operation, payload):
    try:
        sender.send({"result": execute(operation, payload)})
    except Exception as error:
        sender.send({"error": str(error)})
    finally:
        sender.close()


def isolated_calibration(operation, payload, timeout=30):
    context = mp.get_context("spawn")
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(target=_entry, args=(sender, operation, payload), daemon=True)
    try:
        process.start()
        sender.close()
        if not receiver.poll(timeout):
            raise TimeoutError("Calibration worker timed out; its process was stopped")
        response = receiver.recv()
        if "error" in response:
            raise ValueError(response["error"])
        return response["result"]
    finally:
        sender.close()
        receiver.close()
        if process.pid:
            process.join(.2)
            if process.is_alive():
                process.terminate()
                process.join(1)
            if process.is_alive():
                process.kill()
                process.join(1)
