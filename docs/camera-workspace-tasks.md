# Camera workspace implementation tasks

Goal: implement `camera-workspace-implementation-plan.md`.
Goal reference: camera-workspace-2026-10-14.

| Task | Deliverable | Status |
| --- | --- | --- |
| CAM-01 | ADR, ownership contracts and verification environment | Complete |
| CAM-02 | Live-first workspace, persistent 1/2/3-camera setup and one-click robot session | Complete |
| CAM-03 | Guided in-app calibration with isolated solver and versioned calibration | Complete |
| CAM-04 | Timed multi-camera reconstruction, diagnostics and synchronized recording inspection | Complete |
| CAM-05 | Supported IP-camera gateway and detector performance evaluation | Complete |
| CAM-06 | Physical motion-reference diagnostics and matching profile | Software complete; hardware acceptance pending |
| CAM-07 | Integration journeys, layout review, acceptance report and clean commits | Complete; hardware checks documented |

Each implementation task includes focused tests and relevant full suites. Actual
camera accuracy and physical motor acceptance require an available rig; report
those separately from protocol and simulated-flow verification. Do not publish
synthetic results as a physical motion-capture benchmark.

CAM-02 verification: 203 frontend unit tests and production build passed; four
workspace browser journeys passed against the actual mock transport, including
three-camera recording, retained resources, saved setup restoration and one-click
arming. Desktop/mobile bounds were checked. The code-review skill is unavailable;
startup races and the changed UI received a manual review. The canonical WSL
container build was started; a separate container backend plus host Vite server
was used while its frontend dependency download continued.

CAM-03 verification: 206 frontend tests, production build and five workspace
journeys passed. Backend verification passed 162 tests; four Unitree SDK modules
were skipped because the simulation image has no SDK. Calibration tests exercise
real ChArUco pixels, known three-camera geometry, held-out reprojection rejection,
invalid source/board contracts and timeout process reaping. Camera accuracy on an
actual arrangement remains a separate hardware acceptance check.

CAM-04 verification: browser journeys verified real WASM worker processing and
three retained videos seeking on one timeline. Focused tests protect one-inference
scheduling, worker cleanup, stale-result rejection, coherent temporal alignment,
two-view degradation and recording offsets. A 3D setup viewer and per-landmark
reprojection diagnostics expose reconstructed geometry without claiming exposure
synchronization. Full frontend verification and the production build passed.

CAM-05 verification: 219 frontend tests, production build, 164 backend tests
and six workspace journeys passed. Four SDK modules remain skipped in the
simulation image. A real MJPEG source exercises isolated decoding; the browser
compares both real WASM models against the same retained pixels. Hardware RTSP
buffering, mixed-rig timing and accuracy remain unmeasured. See
`camera-ip-gateway.md` for configuration, supported protocols and benchmark scope.

CAM-06 verification: 222 frontend tests, production build, 166 backend tests
and six workspace journeys passed. Tests distinguish a synthetic 80 ms command
delay from a 60 ms tracking delay, prove diagnostic reference values cannot drive
motors, and exercise the candidate through one-click mock control. The physical
profile remains a candidate, not accepted parity. Hardware was explicitly
unavailable; conservative defaults remain until measured G1 validation. Design
lint reports pre-existing raw headings in App.tsx and typography.tsx; changed
camera components use the system typography and styles.

CAM-07 final verification: 229 frontend unit tests and production build passed;
193 backend tests passed in the SDK-enabled robot image, including the previously
skipped DDS, relay, ROS bridge and upper-body protocol modules. Eight launcher
tests passed. All 28 browser journeys passed against the healthy canonical
development stack. Desktop/mobile bounds and the final setup screenshot were
checked. Manual branch review addressed cancellation, timing validation,
configuration locks, saved mapping restoration, delayed initial state, recording playback during armed
control, repeated IP pixels and conflicting OpenCV providers. The code-review
skill remains unavailable; this is explicitly recorded in the acceptance report.

Software delivery is complete. Actual G1 motion-profile acceptance, USB/IP rig
timing and mocap accuracy remain hardware measurements, as requested by the
operator. See `camera-workspace-acceptance.md` for the requirement audit and exact
checks still needed; no physical speed-parity or accuracy claim is made.
