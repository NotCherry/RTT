# Camera workspace implementation tasks

Goal: implement `camera-workspace-implementation-plan.md`.
Goal reference: camera-workspace-2026-10-14.

| Task | Deliverable | Status |
| --- | --- | --- |
| CAM-01 | ADR, ownership contracts and verification environment | Complete |
| CAM-02 | Live-first workspace, persistent 1/2/3-camera setup and one-click robot session | Complete |
| CAM-03 | Guided in-app calibration with isolated solver and versioned calibration | Complete |
| CAM-04 | Timed multi-camera reconstruction, diagnostics and synchronized recording inspection | Complete |
| CAM-05 | Supported IP-camera gateway and detector performance evaluation | In progress |
| CAM-06 | Physical motion-reference diagnostics and matching profile | Pending |
| CAM-07 | Integration journeys, layout review, acceptance report and clean commits | Pending |

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
