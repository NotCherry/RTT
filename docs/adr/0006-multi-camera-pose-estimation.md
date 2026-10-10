# Two/three-camera capture and pose estimation

## Decision

Extend Camera with one primary and up to two supplementary inputs, each selecting
an exact USB device or its own browser-readable IP stream. Keep single-camera
recording and extraction compatible. Distinct USB selections are required for a
multi-camera capture; opening failure closes all views. Source changes and camera
count changes require closing the capture. Expanding the robot retains resources.

Run the bundled MediaPipe Holistic estimator independently per view. Two explicit
fusion modes follow detection; neither changes the robot behavior-model MLP:

- **Body-aligned fusion** maps confident monocular world landmarks into the
  primary body's basis and torso scale, then combines agreeing estimates with
  squared confidence weights. It requires visible shoulders/hips for an
  additional view, rejects torso-scale differences above 35% and landmark
  disagreement above 0.18 m. This is inferred geometry, not metric calibration
  or a new jointly trained neural network. Primary single-view fallback remains.
- **Calibrated 3D triangulation** undistorts image landmarks, intersects rays
  in one calibrated frame, and requires at least two confident views per point.
  It rejects reprojection errors above six pixels, near-parallel rays below
  roughly two degrees, changed capture dimensions and invalid calibration.
  Pair hypotheses reject a disagreeing third view. Monocular hip-relative world
  points never fill gaps in triangulated camera-frame coordinates.

The primary view drives timestamps and continuity. Additional observations must
be within 100 ms; an absent primary supplies no target. Repeated local video
frames do not refresh detection. Timestamps describe browser observation time,
not hardware exposure synchronization; MJPEG cannot establish source latency.
Keep one person in all views. Existing motion bounds, re-acquisition, transport
ownership and explicit arming still apply. Hand landmarks remain from the primary
view, with existing observability limits; hand triangulation is outside this stage.

Image landmarks stay in primary image coordinates for overlay and continuity.
Multi-view confidence gates world landmarks independently, permitting a
reconstructed/estimated elbow hidden in the primary image to be retargeted.

## Local recordings and calibration

A grouped Local recording retains every video, raw per-view landmarks, start
offset, and fused landmarks. Finalization waits for all recorders. A recorder
failure cancels the group. Storage preserves existing version-two/three data;
video payloads remain in the video store and are excluded from list metadata.
Re-extraction processes all views, applies offsets and fuses on the primary
timeline. Cancellation and missing-view errors leave the prior extraction intact.
The Archive receives fused landmarks and fusion/calibration provenance, never video.

The optional local OpenCV tool calibrates the fixed rig from shared checkerboard
video poses. It requires at least 12 shared diverse poses, a baseline of at least
5 cm and maximum calibration/stereo RMS of two pixels. JSON identifies view-1/2/3
and stores five distortion coefficients and world-to-camera transforms. No
perception dependency is added to the DDS runtime. See [setup](../multi-camera-pose.md).

## Verification limits

Synthetic known geometry tests cover depth, rotated estimates, occlusion, stale
views, lens distortion, outliers and missing support. Calibration tests recover
known baselines, reject misaligned frames and detect rendered checkerboards in
real encoded videos. Browser journeys exercise independent streams, grouped
storage, reload, real WASM re-extraction, mobile layout and adjacent single-camera
flows. Actual accuracy and throughput with a physical camera rig remain to be
measured. Confidence and geometric agreement do not establish person identity.

Implementation verification on 2026-10-10 passed 185 frontend unit tests, the
production build, 152 backend tests with the optional OpenCV dependencies, and
all nine camera browser journeys against the canonical local stack. Desktop and
390 px layouts were inspected. The requested code-review skill was unavailable
in this environment; the changes received a manual review of geometry, capture
lifecycle, storage compatibility and calibration failure handling.

## Sources

- [MediaPipe Holistic landmarks](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/holistic.md)
- [OpenCV calibration, stereo transforms and lens distortion](https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html)
