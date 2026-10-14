# Camera workspace implementation tasks

Goal: implement `camera-workspace-implementation-plan.md`.
Goal reference: camera-workspace-2026-10-14.

| Task | Deliverable | Status |
| --- | --- | --- |
| CAM-01 | ADR, ownership contracts and verification environment | Complete |
| CAM-02 | Live-first workspace, persistent 1/2/3-camera setup and one-click robot session | Complete |
| CAM-03 | Guided in-app calibration with isolated solver and versioned calibration | In progress |
| CAM-04 | Timed multi-camera reconstruction, diagnostics and synchronized recording inspection | Pending |
| CAM-05 | Supported IP-camera gateway and detector performance evaluation | Pending |
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
