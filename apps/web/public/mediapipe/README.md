# Local MediaPipe runtime

The classic camera worker loads `vision_bundle.js` from MediaPipe Tasks Vision
1.0.1, matching the installed lockfile and retained WASM/model assets. It is
vendored from the package's Apache-2.0 licensed distribution for offline use.
Update the bundle and WASM assets together when upgrading Tasks Vision. The
classic worker uses `importScripts` so the WASM loader's global factory is retained.
