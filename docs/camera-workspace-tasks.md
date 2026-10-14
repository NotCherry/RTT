# Camera workspace implementation tasks

Goal: implement `camera-workspace-implementation-plan.md`.
Goal reference: camera-workspace-2026-10-14.

| Task | Deliverable | Status |
| --- | --- | --- |
| CAM-01 | ADR, ownership contracts and verification environment | In progress |
| CAM-02 | Live-first workspace, persistent 1/2/3-camera setup and one-click robot session | Pending |
| CAM-03 | Guided in-app calibration with isolated solver and versioned calibration | Pending |
| CAM-04 | Timed multi-camera reconstruction, diagnostics and synchronized recording inspection | Pending |
| CAM-05 | Supported IP-camera gateway and detector performance evaluation | Pending |
| CAM-06 | Physical motion-reference diagnostics and matching profile | Pending |
| CAM-07 | Integration journeys, layout review, acceptance report and clean commits | Pending |

Each implementation task includes focused tests and relevant full suites. Actual
camera accuracy and physical motor acceptance require an available rig; report
those separately from protocol and simulated-flow verification. Do not publish
synthetic results as a physical motion-capture benchmark.
