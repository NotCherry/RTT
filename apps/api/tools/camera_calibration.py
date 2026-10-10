"""Calibrate a fixed two/three-camera rig from shared checkerboard observations."""
import numpy as np


def solve_calibration(object_points, camera_points, sizes, maximum_rms=2.0):
    import cv2
    if len(camera_points) not in (2, 3) or len(sizes) != len(camera_points):
        raise ValueError("Provide two or three cameras")
    if len(object_points) < 12 or any(len(points) != len(object_points) for points in camera_points):
        raise ValueError("At least 12 shared checkerboard poses are required")
    if not np.isfinite(maximum_rms) or maximum_rms <= 0:
        raise ValueError("RMS threshold must be positive")
    objects = [np.asarray(points, np.float32).reshape(-1, 3) for points in object_points]
    images = [[np.asarray(points, np.float32).reshape(-1, 1, 2) for points in camera] for camera in camera_points]
    if any(not np.isfinite(p).all() for p in objects) or any(not np.isfinite(p).all() for camera in images for p in camera):
        raise ValueError("Calibration observations must be finite")
    if any(len(image) != len(obj) or len(obj) < 12 for camera in images for image, obj in zip(camera, objects)):
        raise ValueError("Checkerboard correspondence counts do not match")
    solutions = []
    errors = []
    for points, size in zip(images, sizes):
        centers = np.array([p.mean(axis=0).ravel() for p in points]) / np.array(size)
        if np.max(np.ptp(centers, axis=0)) < .05:
            raise ValueError("Move and tilt the checkerboard across the shared field of view")
        rms, intrinsic, distortion, rotations, _ = cv2.calibrateCamera(objects, points, tuple(size), None, None)
        if not np.isfinite(rms) or rms > maximum_rms:
            raise ValueError(f"Camera calibration RMS {rms:.2f} px exceeds {maximum_rms} px")
        normals = np.array([cv2.Rodrigues(r)[0][:, 2] for r in rotations])
        if np.min(normals @ normals.T) > np.cos(np.deg2rad(10)):
            raise ValueError("Checkerboard orientations need more tilt diversity")
        solutions.append((intrinsic, distortion))
        errors.append(float(rms))
    cameras = []
    for index, ((intrinsic, distortion), size) in enumerate(zip(solutions, sizes)):
        rotation, translation = np.eye(3), np.zeros((3, 1))
        if index:
            reference_intrinsic, reference_distortion = solutions[0]
            result = cv2.stereoCalibrate(objects, images[0], images[index],
                reference_intrinsic.copy(), reference_distortion.copy(), intrinsic.copy(), distortion.copy(),
                tuple(sizes[0]), flags=cv2.CALIB_FIX_INTRINSIC,
                criteria=(cv2.TERM_CRITERIA_MAX_ITER + cv2.TERM_CRITERIA_EPS, 100, 1e-8))
            rms, _, _, _, _, rotation, translation, _, _ = result
            if not np.isfinite(rms) or rms > maximum_rms:
                raise ValueError(f"Stereo calibration RMS {rms:.2f} px exceeds {maximum_rms} px; check timing/corner ordering")
            if np.linalg.norm(translation) < .05:
                raise ValueError("Camera baseline must be at least 5 cm")
            errors.append(float(rms))
        cameras.append({"id": f"view-{index+1}", "width": int(size[0]), "height": int(size[1]),
            "intrinsic": intrinsic.ravel().tolist(), "distortion": distortion.ravel()[:5].tolist(),
            "rotation": rotation.ravel().tolist(), "translation": translation.ravel().tolist()})
    return {"version": 1, "cameras": cameras, "rms_px": max(errors), "shared_poses": len(objects)}
