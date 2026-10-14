# Local MediaPipe runtime

The classic camera worker loads `vision_bundle.js` from MediaPipe Tasks Vision
1.0.1, matching the installed lockfile and retained WASM/model assets. It is
vendored from the package's Apache-2.0 licensed distribution for offline use.
Update the bundle and WASM assets together when upgrading Tasks Vision. The
classic worker uses `importScripts` so the WASM loader's global factory is retained.

The optional body-only detector uses Google's Pose Landmarker Full, float16,
version 1, from the [official model documentation](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker).
Asset: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task`.
SHA-256: `5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1`.
