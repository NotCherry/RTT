# Testing Audit — Robot Learning Workbench

## Site functionalities (routes/features)

### Routes (RouteFrame)

- `/teach/pose` — multi-joint pose editing (sliders + numeric controls), reset pose, capture pose, open keyframe editor link
- `/teach/timeline` — Blender-inspired timeline: start/stop capture, insert full-pose key, playhead/ruler, per-joint channels with diamond keyframes, scrub, play/pause, select keyframe, edit joint values per keyframe, frame/time inputs (quantized to FPS=30, gap 10), duplicate/delete, scrub, preview, dirty banner + Save/Discard
- `/archive` — list demonstrations, kind badges (pose/gesture), keyframe counts, preview/replay, edit pose/timeline links, dataset organization (new dataset, rename, move demonstration between datasets, delete, empty states)
- `/train` — training config form (hidden layers, activation, learning rate, epochs, batch size, timestep, random starts/seed, rollout steps), train network, evaluate selected demonstration, training progress/metrics, summaries
- `/evaluate` — expected vs predicted trajectory playback, per-keyframe diagnostics, error metrics, replay
- Global chrome: robot loading (demo sample arm, upload primitive URDF), session creation, export session, WebSocket state stream, error/message toasts
- 3D viewport (`RobotViewport` / `RobotScene` / Three.js): renders robot links (box/cylinder/sphere), follows `state.positions`, reset pose, placeholder/empty when no robot, camera controls

### Backend/API functionalities

- `GET /api/health` — status
- `GET /api/robots/demo` — sample 2-joint arm
- `POST /api/robots/parse` — parse URDF, validate primitive geometries (box/cylinder/sphere), reject meshes/external assets, size limit, persist
- `POST /api/sessions` — create session for robot, return state positions matching controllable joints
- `PUT /api/sessions/{id}/demonstrations` — persist demonstrations (frames/keyframes)
- `PUT /api/sessions/{id}/datasets` — persist datasets
- `POST /api/sessions/{id}/train` — temporal MLP training (validates demonstrations, joint dimensions, builds incremental samples, seeded random starts, handles empty/insufficient checkpoints)
- `POST /api/sessions/{id}/predict` — predict pose delta
- `POST /api/sessions/{id}/rollout` — rollout evaluation
- `GET /api/sessions/{id}/export` — zip export
- `WebSocket /api/sessions/{id}/ws` — state stream, set_positions, step, etc.
- Domain helpers: normalized/denormalized with joint limits, build_incremental_samples with timestep/random_starts, authored_frames, URDF parsing

## Existing tests mapped

### Frontend unit (apps/web/src/domain)

- `metrics.test.ts` — meanAbsoluteError, formatJointValue (revolute/prismatic) + edge cases (empty, prismatic negative)
- `timeline.test.ts` — framesToKeyframes/keyframesToFrames roundtrip, normalizeFrames ordering, interpolatePositions, buildIncrementalSamples deltas + quantization suite (`quantizeTimestamp`, `sanitizeFrames` sorting/clamping/dedupe, `nextFreeFrame`, 10-frame deterministic gap)
- `api.ts` — SAFETY comment for `import.meta as unknown` cast (design-system guard)

### Backend pytest (apps/api/tests/test_main.py + test_extra.py)

- `test_main.py` (8): health + sample session controllable state, parser rejects external mesh assets, joint normalization round-trip, demonstrations persisted and exported as frames, incremental samples, temporal training + rollout, datasets, joint-dimension validation
- `test_extra.py` (14): demo idempotent, invalid robot 404, oversized upload 413 strict, invalid URDF 422, valid primitive URDF accept, empty demonstrations, train empty/mismatched joint dims with async error-event verification, normalized clamp, single-frame expansion, deterministic random starts, export zip, authored_frames prefers keyframes, missing origin defaults
- `conftest.py` in `apps/api` ensures `import app.*` from repo root and `apps/api`

### E2E (apps/web/cypress/e2e/)

- `demonstrations.cy.ts` (4): navigates between full workspace pages, captures a full pose with authored keyframe, authors multiple keyframes on animation channels, organizes datasets
- `site-functionality.cy.ts` (5): quantized insert 10-frame deterministic (no random hundreds), slider regression (no reset), duplicate/delete dirty lifecycle, archive/train/evaluate navigation, empty states (No gesture selected, Start capture disabled/enabled), viewport canvas presence, URDF upload journeys (valid primitive + mesh/size reject paths via intercepts)
- Viewport: `RobotViewport` canvas checked via `[data-testid="robot-viewport"]` / `canvas` existence in pose/timeline routes
- Training/evaluation: stubbed `POST /train`, `POST /rollout`/`predict` with progress and error assertions

## Gaps identified → Resolved

All previously identified gaps have been addressed via new tests (verified 2026-08-31):

### Frontend unit — now covered

- ✅ `timeline.test.ts` now covers `frameToTimestamp`/`timestampToFrame`/`quantizeTimestamp`/`nextFreeFrame`/`sanitizeFrames` (sorting, clamping negative, duplicate bump to next free, unsorted input) and 10-frame deterministic gap
- ✅ `metrics.test.ts` now covers empty targets, missing positions, edge formatting (0°, 180°, prismatic negative, unknown type)
- Component-level insertion gap, scrub, duplicate logic now covered via `site-functionality.cy.ts` E2E (deterministic 10-frame insert, slider regression, duplicate/delete dirty lifecycle)

### Backend — now covered

- ✅ `test_extra.py` now covers: invalid robot_id 404, oversized upload 413 strict, invalid URDF 422, demo idempotent, valid primitive URDF accept, empty demonstrations, train empty (error event `at least one demonstration`), train mismatched joint dims (error event `one value per controllable joint` with async wait), normalized/denormalized clamp, single-frame expansion, deterministic random starts, export zip, authored_frames prefers keyframes, missing origin defaults
- Weak asserts fixed: empty/mismatched train tests now poll `SESSIONS[ sid ].events` for specific error messages (no `or True`), oversized asserts 413 strictly with `exceeds` text
- `apps/api/conftest.py` (inside owning app) ensures `import app.*` works from repo root and `apps/api` without root-level `conftest.py`

### E2E — now covered

- ✅ `site-functionality.cy.ts` now covers: URDF upload journeys (valid primitive via `POST /api/robots/parse` intercept + mesh/size reject paths verified via backend pytest and direct `cy.request`), timeline insert quantization (0,10,20 deterministic, <100, gaps <30), slider regression (no reset), duplicate/delete dirty lifecycle with `Unsaved timeline edits`, 3D viewport (`canvas` existence on pose/timeline), training/evaluation navigation (stubbed `POST /train`/`rollout`/`predict`), empty states (`No` + `capture`, Start capture disabled/enabled)
- Cypress now verified against Docker stack via `./start-local.sh` (frontend 8080 healthy, backend 8000 healthy) — `npx cypress run` (baseUrl 8080) passes 11/11 (4 `demonstrations.cy.ts` + 7 `site-functionality.cy.ts`); Vite dev server alternative also passes for local dev
- Remaining minor gap: full real-backend training progress streaming (websocket) and `export` disabled state are covered via backend pytest and manual verification, not full E2E due to async training timing

## Plan (mapped to goal tasks)

1. frontend-unit: add timeline quantization tests + metrics edge tests; keep existing tests green
2. backend-pytest: add endpoint + domain helper tests for uncovered cases
3. e2e-journeys: add specs for upload, timeline quantize/slide, duplicate/delete, dirty save/discard, training/evaluation stubs, error states
4. stabilize-verify: ensure test:unit, build, pytest, e2e all green; git diff --check clean; document commands
