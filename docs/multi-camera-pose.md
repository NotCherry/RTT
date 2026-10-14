# Camera setup for two or three views

The Camera workspace now has separate **Camera setup** and **Calibration** tabs.
Select **1 camera**, **2 cameras**, or **3 cameras** in Camera setup, configure each
USB/IP source, and inspect all views together. **Save setup** retains exact source
bindings on this device. **Start live preview** opens the selected arrangement;
the explicitly labeled **Run on physical robot** also connects and arms DDS once
tracking and measured state are ready. Finishing a recording keeps capture open.

For guided calibration, open all sources and go to Calibration with robot control
disconnected. Download the ChArUco board, mount it flat, measure its square and
marker edges, and enter those dimensions. Hold the board still for each **Capture
board pose**, varying its tilt, location and distance. The latest snapshots show
detected corners in all views. Capture at least 14 diverse shared poses, then
**Solve calibration**. The fitting uses at least 12 poses and independently checks
two held-out poses; errors over two pixels are rejected. Select Calibrated
triangulation in Camera setup and save the resulting setup.

Calibration runs in a bounded spawned worker outside the DDS process. Camera
snapshots are transient and are not saved to Archive. Geometric calibration does
not verify exposure timing. The existing checkerboard CLI and JSON import remain
available below for older calibrations.

Camera now supports USB webcams, IP streams, or a mixture. Use **Add camera**
once for two views or twice for three. Each view runs the bundled MediaPipe
Holistic model; the pose estimator combines the results before retargeting.
Single-camera workflows and the robot behavior-model MLP remain available.

## Start without calibration

1. Open a robot, then Camera. Keep one person visible in every camera.
2. Use **Detect cameras** to allow access and refresh device names. Add the
   additional views and choose a different **USB camera** for each. For a phone
   or IP camera, choose its source and supply its browser-readable stream URL.
3. Put camera 1 in front, with the other views looking from different angles.
   Keep shoulders and hips visible. Keep all cameras unmirrored. USB bandwidth,
   permissions and browser CORS still apply to each independent input.
4. Choose **MediaPipe + body-aligned fusion**, then **Live preview** processing.
   Open cameras. The mapping inspector reports contributing views and fused
   landmarks. Depth here remains an estimate from the individual models.
5. Start at 10 or 15 fps with three views; increase if the device keeps up.
   Observe arm landmarks while one view is occluded. Compare the mapped robot
   preview to the motion before using the explicitly armed physical connection.

The primary view supplies timing and image continuity. Its loss stops new targets;
secondary views do not keep an old primary frame fresh. An additional view needs
a usable torso reference to contribute. Estimates that disagree are rejected.
This mode improves available coverage in tested synthetic occlusion cases;
physical accuracy gains are not yet measured.

## Calibrate for reconstructed 3D

Triangulation uses camera geometry rather than averaging inferred depths. Each
landmark needs two matching visible views. With three cameras, a limb hidden in
the primary view can still be reconstructed from cameras 2 and 3. Hands continue
using primary-view landmarks.

1. Fix the camera arrangement, focus and capture resolution. Place the cameras
   with overlapping views; avoid almost identical viewpoints. Do not move them
   after calibration. The first camera is the reference for all transforms.
2. Print the [9 × 6 inner-corner board](assets/camera-checkerboard-9x6-25mm.svg)
   at actual size, with no fit-to-page scaling. Mount it flat and measure a
   square: the supplied board uses 25 mm edges. Use that measured value below.
3. In Camera, add and select all inputs. Keep the body-aligned model selected
   while recording the calibration clip; choose **Record then process**.
4. Record the board in every view for 20–40 seconds. Hold at least 12 distinct
   positions/orientations still for a moment, with varied tilts, distances and
   image locations. Keep the same front of the board fully visible in all views.
5. Stop recording. In Recordings use **Export camera videos**. Keep
   `view-1.webm`, `view-2.webm`, optional `view-3.webm`, and `camera-timing.json`
   together. Allow this browser's multiple-file download when prompted.
6. Run the optional calibration tool locally, then import its JSON in Camera.
   Select **MediaPipe + calibrated 3D triangulation** and open the same inputs
   at the same resolutions. The inspector reports reconstructed landmarks.

From the repository root, in a separate Python environment (not the DDS venv):

```bash
python3 -m venv .venv-camera
.venv-camera/bin/python -m pip install -r apps/api/requirements-camera.txt
.venv-camera/bin/python apps/api/tools/calibrate_camera_rig.py \
  /path/to/view-1.webm /path/to/view-2.webm /path/to/view-3.webm \
  --timing /path/to/camera-timing.json --columns 9 --rows 6 --square-m 0.025 \
  --output /path/to/camera-calibration.json
```

Omit view-3 for a two-camera rig. PowerShell uses `py -3.12 -m venv .venv-camera`
and `.venv-camera\Scripts\python.exe` in place of the Unix executable.
The calibration tool is optional and adds no dependency to the running DDS adapter.

The tool refuses insufficient poses, lack of movement/tilt diversity, weak camera
baseline and calibration/stereo reprojection RMS above two pixels. Re-record a
better board clip instead of increasing the error threshold. Import also rejects
RMS above two pixels. Calibration IDs follow input order, not OS device enumeration:
ensure the same physical device is assigned to each view when reopening.

## Record and inspect movement

**Start recording** records all configured views. Stop waits for each recorder,
stores the source videos locally and produces one fused landmark timeline.
**Extract stick figure** and **Re-extract stick figure** use all retained videos,
the captured start offsets, and the recording's saved model/calibration.
Missing video or cancellation preserves the previous extraction. Playback shows
the primary video with the fused robot demonstration. Exported camera videos
allow individual view inspection. Deleting the Local recording removes all its
videos; demonstrations already saved to Archive remain.

The Archive contains the fused landmark frames and estimator provenance,
including calibration for triangulated capture. It does not contain videos.

## Practical limits and acceptance

USB/MJPEG feeds are not hardware-synchronized. Matching observations within
100 ms reduces mismatches but does not correct unknown IP-camera buffering or
exposure timing. For fast motion, use matched cameras, reduce buffering, and
compare retained views at the same moment. Incorrect timing can look like
incorrect depth even with a good calibration. The primary camera must remain
available and sufficiently fresh. Calibration cannot establish person identity.

Measure improvement on the actual arrangement: inspect a stationary pose,
slow arm motion, a known elbow angle, primary-view occlusion and view dropout.
Compare single-camera, body-aligned and triangulated results using the same
movement. Watch effective latency, reconstructed landmark count, joint jitter
and measured robot response while disarmed before a supervised motor test.
Synthetic tests validate geometry and failure handling, not a physical accuracy
benchmark. Moving a camera or changing its crop/resolution requires recalibration.

See [ADR 0006](adr/0006-multi-camera-pose-estimation.md) for the estimator and
ownership boundaries.
