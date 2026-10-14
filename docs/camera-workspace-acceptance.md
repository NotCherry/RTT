# Camera workspace delivery and remaining hardware acceptance

Implementation reference: camera-workspace-2026-10-14, CAM-01 through CAM-07.
The operator confirmed that the G1 and intended USB/IP rig are unavailable.

## Delivered software

| Requirement | Implemented behavior / evidence |
| --- | --- |
| Live first | Live processing is the default; recording stops without closing preview. |
| One-click preview | Starts every source and detector in the chosen arrangement; no robot connection. |
| One-click physical session | Unitree DDS defaults; sources, processing, ownership, stream, tracking and measured state precede explicit arming through Run. Cancellation/late completion cannot arm later. |
| Multi-camera discoverability | Separate Camera setup and Calibration tabs; selectable 1/2/3 arrangement, independent USB/IP slots, labels, exact saved bindings, all-view grid and expandable views. |
| Geometry | Guided ChArUco board download, measured dimensions, corner snapshots, isolated fitting, two held-out poses, reprojection reports, import/export and camera-moved invalidation. |
| Timing | Independent worker per view, one inference at a time, bounded history, 33.3 ms calibrated alignment, late/repeated-frame rejection and explicit observation provenance. |
| Timing readiness | Operator shared-event evidence with at least five offsets per view, measured uncertainty and variability gate; saved offsets correct view alignment. Calibrated multi-camera Run is blocked without this evidence. |
| Reconstruction | Existing robust calibrated triangulation with contributors/error per landmark; body-aligned inferred depth remains explicit. No silent monocular fallback during calibrated loss. |
| Perception models | Separate Holistic/body-only Pose Full and reconstruction selectors; detected multiple people rejected; real worker comparison uses the same retained pixels. MLP behavior model unchanged. |
| IP sources | Direct browser HTTP/MJPEG and configured RTSP/HTTP gateway; credentials remain backend-side; one latest decoded frame per isolated process. |
| Recordings | Retained grouped pixels, offsets, raw per-view landmarks and provenance; synchronized source inspection, 3D skeleton and URDF. Re-extraction retains original model and calibration. Archive excludes videos. |
| Motion reference | URDF reference remains independent; named reference, raw target, limited command and fresh measurement are compared, with bounded trace export and separate delay fits. |
| Candidate matching | Selectable arm profile capped at 3 rad/s, 10 rad/s²; conservative default retained until G1 validation. Waist limits, source URDF velocity limits, engagement and release remain. |

## Hardware checks still required

1. **DDS and motion:** verify the intended G1 variant, waist axes, backend interface,
   domain and ownership; start disarmed. Compare conservative and Match preview
   profiles with slow/rapid arm motion and raised poses. Export traces and measure
   steady-state command lag, physical tracking lag and mean/p95 joint error;
   evaluate startup engagement separately. Tune acceleration from actual behavior
   before promoting a faster default. Validate Stop, tracking loss, feedback loss,
   connection loss and local robot stop. No physical speed parity is claimed.
2. **Rig combinations:** exercise 1 USB, 1 IP, 2 USB, USB+IP, 2 IP, 3 USB,
   2 USB+IP, USB+2 IP and 3 IP with intended resolutions. Check bandwidth, decoder
   buffering, stalls, camera loss/replacement and long-running clock drift. Software
   mixture tests and local MJPEG decoding are not acceptance of the actual devices.
3. **Geometry and timing:** use the rigid measured board throughout the capture
   volume, inspect held-out error and validate known distances. Record repeated
   visible events over the session and establish offsets, jitter and uncertainty.
   Browser receipt/processing and backend decode timestamps are not exposure
   timestamps. Revalidate optics, arrangement, buffering or source changes.
4. **Mocap quality:** compare detector and rig latency, reconstruction error,
   static jitter, occlusion/dropout, left/right consistency and detected ambiguity
   on the intended machine. Inspect overload at three views. Keep hands explicitly
   primary-view estimates; Pose Full is body-only. Detection coverage alone is not
   accuracy, and neither detector guarantees person identity.

## Scope and limitations

The gateway currently transfers bounded JPEG snapshots, not WebRTC. RTMPose/RTMW
are researched future adapter candidates, not installed or benchmarked. Pairwise
calibration connectivity, moving-camera recalibration, geometric-reference failover,
multi-person identity association and multi-view finger reconstruction remain
explicit later phases from the implementation plan. The initial rig requires
common board observations and preserves primary-loss behavior.

Timing validation is entered from retained shared-event evidence; it is not an
automatic hardware synchronization certificate. Completely unchanged IP pixels
may hold tracking conservatively. Received FPS is reported where browser video
counters support it and is marked unavailable otherwise. Physical acceptance
thresholds and detector choices must come from actual measurements.

## Verification and review

The canonical `./start-local.sh --dev` workflow starts healthy frontend/backend
containers. Camera browser journeys include real retained video, actual WASM
workers, mixed USB/IP pixels, desktop/mobile bounds and authenticated mock control.
Final software verification: 229 frontend unit tests, production build, 193
backend tests in the SDK-enabled image, eight launcher tests and all 28 browser
journeys passed. No SDK protocol modules were skipped in the final backend run.
These protect lifecycle, geometry, timing, recording/storage and controller
behavior. The simulation-image run separately passed 168 tests with four SDK
modules skipped before the full robot-image verification.

The required code-review skill is not installed or available in this session;
filesystem discovery found no code-review SKILL.md. Manual branch review covers
the full change since `d2930d9`, including source ownership, cancellation, stale
results, calibration provenance, timing gates, recording playback during live
control, credential exposure, process teardown and motion-reference isolation.
Findings addressed include camera-tile alignment, configuration locks while
connected, repeated IP pixels, abandoned connections, calibration cancellation,
delayed initial state vectors, and empty gateway configuration forwarding. Startup
readiness failures remain disarmed and report the specific missing conditions.

Design lint reports existing raw headings in App.tsx and the typography component.
The changed Camera panels use existing typography and system classes. No source
changes to those unrelated headings were made.
