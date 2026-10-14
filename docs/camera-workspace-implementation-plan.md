# Camera workspace and multi-camera motion capture: implementation plan

Status: proposed implementation, 2026-10-14. This document refines the local
Camera draft; it does not change runtime behavior or replace accepted ADRs.

## Outcome and scope

Make live processing the default and provide one explicit action to start a
physical robot session. Preserve and promote single-, two-, and three-camera
capture with any supported mixture of USB and IP inputs. Give setup and
calibration enough space to inspect every view simultaneously. Keep the URDF
preview as the motion reference and measure how closely the physical robot
follows it.

Demonstrations remain the primary artifact. Source videos remain Local recordings.
Perception models produce Landmark frames; the simple behavior-model MLP still
learns robot demonstrations. Full-body observation does not enable leg control.
Retain primitive URDF support and the existing physical control boundaries.

## Existing foundation

- `CameraTeachingPage.tsx` currently defaults to offline processing; preview speed
  is 3 rad/s. `RobotConnectionPanel.tsx` defaults to mock and 1 rad/s hardware motion.
- `useMultiCameraCapture.ts` already supports up to three independent USB/IP inputs,
  grouped recording, and per-view detection using MediaPipe Holistic.
- `multiCameraPose.ts` implements body-aligned fusion and calibrated triangulation.
  It matches observations within 100 ms of the primary view; primary loss stops
  fused output. Browser observation timestamps are not exposure timestamps.
- Triangulation already checks calibration dimensions, visibility, ray geometry,
  and reprojection error. Hands currently come from the primary camera.
- Calibration exists as an optional OpenCV CLI with checkerboard videos and JSON
  import. Its workflow requires export, terminal processing, and re-import.
- ADRs 0004, 0006, 0008, and 0009 define motion, recording, process isolation,
  and upper-body control contracts to preserve or explicitly supersede.

## Workspace specification

Use four Camera subtabs: **Live**, **Camera setup**, **Calibration**, **Recordings**.
A session coordinator above the subtabs owns streams, detectors, recording, and
robot ownership. Switching views must not reopen devices or lose active resources.
An active hardware session keeps its status and Stop robot control visible in all
subtabs. Changing configuration or starting calibration requires stopped control;
simply inspecting the setup is available while running.

### Live

- Primary actions: Start live preview and Run on physical robot. Live preview
  starts all sources in the selected saved setup, not only camera 1.
- Show the URDF reference and the selected camera view, plus a compact all-view
  strip and a visible link to Camera setup. Include setup count and calibration
  health in the session summary so multi-camera capability remains discoverable.
- Run opens the configured sources, initializes detection, connects DDS, completes
  stream ownership/handshake, checks fresh state and usable targets, then arms.
  Its label and nearby copy clearly describe physical movement. No second Arm
  click is needed. Visiting Camera or restoring settings never arms.
- Use bounded startup stages, cancellation, attempt IDs, and explicit success/error
  results from hooks. Do not chain today's error-swallowing operations blindly.
- A failed or canceled attempt cannot arm later. Release owned partial robot
  resources; preserve an already running preview. Retry requires another click.
- Stop robot releases hardware control while preview and recording remain usable.
  Finishing recording stays on Live. Leaving the Camera workspace releases control.
- Default transport: Unitree DDS; G1 EDU 29 DOF; direct Ethernet `eth0`, domain 0,
  multicast, three waist axes, current arm-strength default. Preserve explicit
  saved network/mapping overrides. Never silently fall back to ROS bridge or mock.
- One-click operation applies after first-time permissions and setup validation.
  An unavailable configured camera produces an actionable setup error; do not
  replace it with another device and reuse its calibration.

### Camera setup

Prominent selectable menu: **1 camera / 2 cameras / 3 cameras**. Replace the
incremental Add camera / Remove last camera workflow. Default is one local camera;
returning users reopen their saved arrangement.

Every slot has a stable ID, editable label, USB/IP source selector, exact USB
device or IP endpoint, actual resolution/FPS, connection status, and test action.
Support USB+USB, USB+IP, IP+IP, and all three-source mixtures. Prevent duplicate
USB assignments and warn about duplicate IP sources. Changing count stops capture
before releasing/removing resources and requires revalidation of calibration.

Desktop layout: two cameras side by side; three cameras plus a reconstructed
3D skeleton in a 2x2 grid. All source previews remain visible together, with
consistent aspect ratios, overlays, and source IDs. Include a maximized inspection
view without replacing the overview. On small screens use a scrollable grid with
a persistent overall health summary; do not shrink three feeds into unreadable tiles.

Each tile reports received FPS, processed FPS, dropped/late frames, landmark
coverage, and timing status. Distinguish measured values from unavailable estimates.
The 3D panel shows camera positions/frustums only after calibration, contributor
count per joint, and reconstructed skeleton quality. Before calibration, placement
guidance is schematic and explicitly labeled as such.

Provide Test all cameras, Save setup, and Continue to Live. Show specific blockers:
missing source, duplicate device, inadequate overlap, stale input, unknown timing,
calibration mismatch. A visible image alone does not establish capture readiness.

### Calibration

Build a guided in-app calibration workflow with all source views visible:

1. Verify selected cameras, fixed resolution, orientation, crop, zoom, and focus.
2. Choose a printable ChArUco board, enter/verify measured square and marker sizes,
   and show printing instructions. Keep existing checkerboard/JSON compatibility.
3. Show detected board corners and per-camera coverage while capturing diverse
   positions and tilts across the intended movement volume.
4. Solve camera intrinsics/distortion and relative extrinsics in a separate
   perception/calibration worker, outside the DDS process. Report progress/cancel.
5. Inspect per-camera and camera-pair reprojection errors, usable board samples,
   overlap/connectivity, and camera placement. Validate on held-out board poses,
   not only the observations used to fit calibration.
6. Verify timing with a shared visible event/movement. Report offset, jitter, and
   confidence separately; geometric calibration cannot remove variable buffering.
7. Save a versioned calibration linked to stable camera identities and settings.
   Return to the 3D setup preview for a known-distance/slow-motion validation.

Use OpenCV pinhole intrinsics plus supported distortion as the initial camera
model. Reject unsupported fisheye/wide-angle configurations explicitly; add a
separate fisheye model only with calibration and projection tests.

Initial release requires common board observations across all selected cameras,
matching the existing solver. Pairwise ChArUco overlap and joint refinement can
follow; disconnected camera groups must never be accepted. Camera movement
invalidates extrinsics; changed optics, crop, or resolution requires revalidation
and usually recalibration. Do not claim arbitrary camera motion can be detected
automatically. Provide a clear 'Camera moved / recalibrate' action.

Preserve the existing 12-pose and 2 px RMS rejection checks for the legacy
checkerboard path. Establish ChArUco thresholds using actual lens/resolution tests;
neither low RMS nor a sample count alone certifies accurate body reconstruction.
Store units, coordinate convention, reference camera, board definition, identities,
dimensions, optical settings where available, solver version, and quality report.

## Pose-estimation and projection specification

Do not require training a new multi-camera neural network. Start with a detector
per view plus explicit geometry. Separate the controls currently combined under
'Pose model' into **Landmark detector** and **3D reconstruction**.

| Choice | Camera count | Calibration | Role |
| --- | --- | --- | --- |
| Single-view estimate | 1 | Not required | Fast live preview with inferred depth |
| Body-aligned fusion | 2–3 | Not required | Existing approximate fusion; label inferred depth |
| Calibrated triangulation | 2–3 | Required | Preferred motion-capture reconstruction |
| RTMPose/RTMW detector adapter | 1–3 | Depends on reconstruction | Later benchmarked detector alternative |

For a newly selected multi-camera arrangement recommend calibrated triangulation
and guide the user through calibration. Offer approximate fusion explicitly for
quick experimentation; never silently substitute it during a calibrated session.

Proposed pipeline:

`USB/IP frames -> time alignment -> per-view 2D landmarks -> undistortion ->`
`robust triangulation -> quality gates -> causal smoothing -> retargeting ->`
`URDF reference / independently bounded physical commands`

Each calibrated camera uses projection `P_i = K_i [R_i | t_i]`; distortion is
handled consistently before triangulation and during reprojection. Store transforms
in one documented metric rig frame. Do not average monocular hip-relative world
coordinates as though they were measured points in that frame. Adapt detector
landmark schemas explicitly to the existing retargeting contract.

Require at least two valid observations for each triangulated joint. With three
views, use pair hypotheses and a third-view consistency test, then refine using
accepted views. Preserve existing ray-angle and reprojection rejection. Expose
per-joint contributing views and error instead of one misleading global score.
Use causal filtering for live operation and preserve raw observations for offline
reprocessing. Avoid long smoothing windows that conceal robot-control latency.

Keep one tracked person in the capture volume. Multiple-person ambiguity blocks
control; multi-person identity association is a separate feature. Initial hands
remain explicitly primary-view estimates. Multi-view hand reconstruction is a
later phase requiring left/right association, sufficient hand pixels, and its own
quality tests; do not imply full finger mocap from body triangulation.

Retain MediaPipe Holistic for initial compatibility. Benchmark a body-only
MediaPipe path when hands are unused, and RTMPose/RTMW as optional local worker
adapters. Compare actual rig accuracy, latency, resource cost, landmark coverage,
and deployment/license constraints before choosing. Published benchmark FPS does
not establish performance for our three-camera end-to-end pipeline. The robot
behavior-model editor and its MLP do not change to support these detectors.

## USB/IP ingestion and synchronization

- Preserve direct browser USB and browser-readable HTTP/MJPEG sources first.
  Name supported protocols; an arbitrary IP-camera URL is not automatically usable.
- For RTSP-only cameras, plan a local camera gateway that converts supported
  streams to browser-readable low-latency video, preferably WebRTC. This is a
  camera service, unrelated to the robot ROS bridge. Keep credentials out of
  URLs/logs and restrict backend fetching to configured camera endpoints.
- Run inference off the UI thread with a bounded scheduler. Keep independent
  temporal detector state per camera; cap work to prevent three streams from
  creating an ever-growing inference queue. Drop superseded live work.
- Track capture/source timestamps when available, receive time, inference time,
  sequence, clock source, estimated offset, and uncertainty. Never relabel browser
  arrival time as exposure time. Detect repeated/stalled MJPEG observations.
- Align against a rig timeline, with small bounded buffers and late-frame rejection.
  Target at most one frame period of inter-view skew initially (about 33 ms at
  30 FPS), then validate against motion speed. This is a proposed engineering
  target, not a promise of hardware synchronization or sufficient fast-motion accuracy.
- The current 100 ms window is too permissive to present as precision mocap.
  A moving landmark at 1 m/s moves 10 cm in 100 ms. Do not pair frames merely
  because they arrived together after different IP-camera buffering delays.
- Show 'timing unverified' where capture-time skew cannot be bounded. Allow setup
  inspection and recording with that provenance, but do not advertise calibrated
  live hardware control as ready until its timing budget is verified.
- Separate the geometric reference camera from the timing coordinator in a later
  change: two remaining calibrated views may reconstruct after primary loss.
  Initially preserve primary-loss behavior. Any later failover must retain the
  same rig frame and pass continuity checks, never silently reset the origin.
- A third-view dropout may continue using two valid calibrated views. With fewer
  than two observations, mark affected joints unavailable and apply existing
  bounded hold/release rules. Never silently switch to guessed monocular depth.

Calibration worker jobs should accept image/corner observations and return a
versioned solution with diagnostics. Prefer transferring detected board corners
over video where feasible. A local perception service for heavy models or RTSP
must declare where images are processed; do not silently upload video remotely.
Keep capture/perception overload isolated from the physical-controller watchdog.

## Physical motion matching

Keep the requested URDF trajectory visible as the reference. Add optional commanded
and measured overlays; showing only measured motion would hide failure to match.
Use the physical model's joint names/geometry when comparing physical motion,
including current single-arm holding and waist-axis contracts.

Instrument timestamps and sequence IDs across capture, accepted landmarks,
retargeted reference, command generation, and robot feedback. Measure steady-state
lag, joint error, velocity/acceleration clipping, and startup engagement separately.
Separate sensor latency from commanded-trajectory lag and physical tracking lag.

Implement a Match preview profile that removes the independent 1 rad/s default
for arms only after controlled validation of a candidate 3 rad/s profile. Tune
acceleration against measured behavior; changing a speed dropdown alone is not
completion. Keep engagement, joint limits, watchdogs, and tracking-error release.
Waist limits remain separately visible; increasing them requires its own hardware
validation. Where the reference exceeds verified physical capability, display the
limit and tracking error rather than silently slowing the reference or claiming parity.

## Recordings, persistence, and ownership

Persist named setups with stable slot/device bindings, selected detector/reconstruction,
calibration version, and actual capture settings. Device identifiers may change with
browser permissions; require explicit remapping rather than binding by list order.
Keep grouped videos, per-frame timing, raw per-view landmarks, fused frames, and
provenance together. Store large video data locally, separate from metadata.
The Archive retains demonstrations and provenance, never source videos.

Recordings gains synchronized inspection of all views plus reconstructed skeleton
and URDF, with one timeline. Re-extraction reuses the recording's saved setup and
calibration rather than today's selection. Failed extraction preserves prior results;
storage/finalization errors must remain visible while live preview continues.

## Delivery sequence and verification

1. **Contracts and architecture:** document proposed superseding ADRs for one-click
   explicit arming, setup ownership, calibration lifecycle, timing, and motion
   matching. Define typed setup/quality/worker contracts; add glossary terms before
   broad use. Keep modules within the owning apps; avoid a speculative shared package.
2. **Live and setup UI:** implement subtabs, 1/2/3 menu, all-view overview, persisted
   setups, live defaults, and cancellable session coordination using current detectors.
3. **Guided calibration:** expose isolated calibration jobs, ChArUco capture and
   validation, versioned import/export, and readable per-view quality reports.
4. **Timed reconstruction:** worker scheduling, timing provenance, bounded alignment,
   robust triangulation diagnostics, and explicit dropout/degraded behavior.
5. **IP gateway and detector evaluation:** validate required IP protocols and mixed
   USB/IP rigs; benchmark optional detector adapters against the MediaPipe baseline.
   Timestamp-aware IP ingestion is required before claiming mixed-rig live accuracy.
6. **Motion matching:** instrument and benchmark reference/command/measured motion,
   then validate candidate hardware profiles with the actual robot.

Acceptance matrix includes 1 USB, 1 IP, 2 USB, USB+IP, 2 IP, 3 USB,
2 USB+IP, USB+2 IP, and 3 IP. Test permissions, unavailable/duplicate sources,
camera replacement, wrong calibration, changed dimensions, clock offset/drift,
variable IP buffering, frame stalls, occlusion, left/right consistency, worker
overload, view loss, recording cancellation, and storage failure.

Protect one-click start/cancel/retry, stale ownership, delayed completion after
navigation, recording without session teardown, and subtab switches with focused
component tests and browser journeys. Geometry tests use known camera matrices,
distortion, outliers, and synthetic timestamps. Replay the same retained multi-view
capture through each estimator; measure reconstruction error with known geometry,
static jitter, dropout rate, processed FPS, and p50/p95 latency on named hardware.
Set final accuracy and lag release thresholds from this measured baseline before
claiming acceptance. Synthetic checks alone do not establish physical mocap quality.

Run frontend unit tests/build, relevant backend tests, Docker camera journeys,
desktop/mobile visual checks, branch review, and `git diff --check`. Physical
acceptance separately compares slow/fast arm movements and controlled occlusions;
initial perception checks run disarmed. Commit each completed verified stage.

## Research basis

Sources checked 2026-10-14; their capabilities inform the proposal, not a promise
of accuracy on this rig.

- [Google MediaPipe Web Pose Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js):
  image/world landmarks; synchronous detection blocks the UI thread, with workers
  recommended. These are Pose Landmarker docs; validate worker compatibility for
  the pinned Holistic implementation separately.
- [OpenCV ChArUco calibration](https://docs.opencv.org/4.13.0/da/d13/tutorial_aruco_calibration.html):
  identified corners and partial board observations support a more usable guided
  calibration workflow. Relative camera calibration remains a separate solve.
- [OpenCV calibration and 3D reconstruction](https://docs.opencv.org/4.13.0/d9/d0c/group__calib3d.html):
  intrinsic/extrinsic projection model, distortion, and reconstruction foundation.
- [FreeMoCap calibration troubleshooting](https://docs.freemocap.org/documentation/calibration-troubleshooting.html):
  rigid boards, shared views, and camera overlap are practical calibration needs.
- [FreeMoCap camera setup](https://docs.freemocap.org/freemocap/docs/guides/camera-setup/):
  ordinary USB multi-camera capture is viable; software alignment is distinct from
  hardware genlock. Use as an architectural reference, not evidence for arbitrary IP feeds.
- [Google per-video-frame timing guidance](https://web.dev/articles/requestvideoframecallback-rvfc):
  WebRTC can expose capture/receive timing metadata; availability and clock alignment
  still need validation. Presentation callbacks alone do not synchronize exposures.
- [RTMPose paper](https://arxiv.org/abs/2303.07399) and
  [MMPose deployment guide](https://github.com/open-mmlab/mmpose/blob/main/docs/en/user_guides/how_to_deploy.md):
  pretrained detector alternatives and ONNX/TensorRT deployment paths to benchmark.
  A faster or richer detector does not replace camera calibration or synchronization.
