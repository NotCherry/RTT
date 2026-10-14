# Configured IP camera access and detector comparison

Browser USB and direct browser-readable HTTP/MJPEG are supported. RTSP and
authenticated HTTP feeds use the API's isolated OpenCV/FFmpeg camera gateway.
Set `RTT_CAMERA_SOURCES` on the API process to a JSON object of stable identities:

```json
{"side":{"name":"Side view","url":"rtsp://camera-host/live"}}
```

Select **Configured · Side view** in a camera slot's IP source menu. Keep
credentials in the backend environment. The browser receives only identities,
names, decoded JPEG frames and timing metadata. Endpoints are configured by the
operator; the service is not an arbitrary URL proxy. The local Compose workflows
forward this environment variable into the API service. Do not commit
credentials to Compose files or source control.

Up to three sources run in separate bounded decoder processes. Each retains
one latest frame, reports a source epoch and monotonic sequence, rejects decoded
frames older than 250 ms, and exits after ten seconds without requests. Browser
polling permits one outstanding request per source and invalidates a restarted
source. The controller remains a separate process. This initial transport uses
JPEG snapshots rather than WebRTC. Identical downsampled IP pixels stop refreshing
tracking after 250 ms; this conservative check can hold an entirely static scene
and is not a hardware frame counter. Hardware buffering and bandwidth must be
measured on the intended mixed USB/IP rig. Decode time is not exposure time.

**Landmark detector** is separate from **3D reconstruction**. Holistic retains
primary-view hands; Pose Full provides body-only landmarks. Both use Pose Full
with capacity for two people to reject detected ambiguity. This does not guarantee
person identity or detection of every additional person. Holistic's guard adds
inference cost, included in the comparison. Camera images are processed locally.
No new robot behavior model is required for calibrated triangulation.

In Recordings, close live capture and disconnect control, then choose **Compare
detectors**. The same first three seconds of retained video are sampled at 10 Hz
for each detector in a fresh worker. Export includes observed mean/p95 processing,
coverage and browser identity. Processing FPS excludes source decoding and model
initialization. Coverage is not accuracy. No synthetic recording result establishes
physical mocap performance. RTMPose/RTMW remain researched, optional future
adapters; the implementation does not claim they are installed or benchmarked.
