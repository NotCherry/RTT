# Timed camera processing and synchronized inspection

## Decision

Run one independent MediaPipe detector in a classic browser worker per camera.
Retain a reported main-thread fallback for unsupported browsers. The retained
Tasks Vision 1.0.1 distribution, WASM and model are local assets; classic workers
preserve the WASM loader's importScripts globals. CPU worker inference avoids
offscreen software-GPU stalls observed in browser verification.

Each capture schedules one inference at a time, skips superseded sampling work,
rejects results older than 250 ms, and invalidates pending results on close. Report
processed throughput, processing latency and percentile, skipped samples and worker
mode. Browser observation time is not camera exposure time.

Keep six observations per view and select the nearest to the primary observation.
Calibrated reconstruction uses a coherent window of at most 33.3 ms across all
selected views, superseding ADR 0006's 100 ms calibrated window. Body-aligned
fusion retains the legacy 100 ms approximate window. Expose contributing views
and per-landmark reprojection error; never fill calibrated gaps with guessed depth.
Primary loss still stops the group. A supplementary loss in a three-view live
session may continue with the remaining two views, visibly degraded; reopen all
configured views before grouped recording or a new robot session.

Setup displays all source feeds beside an orbitable reconstructed skeleton. Camera
frustums use the calibrated reference frame and appear only with calibrated
reconstruction, not hip-relative monocular estimates. Grouped recordings expose
every retained source on the primary timeline using stored per-view offsets, plus
the reconstructed skeleton and URDF. Calibration has an explicit JSON export.

These changes bound observation matching and processing, not actual exposure
skew or unknown IP-camera buffering. Calibrated rig accuracy and physical motion
tracking still require their separate acceptance measurements.
