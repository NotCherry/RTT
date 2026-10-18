# Robot Learning Workbench

A demonstration-first robot teaching environment for uploading primitive-geometry URDF robots, visualizing them in Three.js, recording named poses and timestamped gestures, archiving expected behavior, and training a small MLP with a FastAPI/PyBullet backend.

## Repository layout

```text
.
├── start-local.sh       # canonical Podman startup entrypoint
├── apps/
│   ├── web/             # React/Vite/Three.js frontend and browser tests
│   └── api/             # FastAPI/PyBullet/PyTorch backend and pytest tests
├── infra/               # Docker Compose orchestration
├── packages/            # reserved for genuinely shared libraries
├── docs/                # design reference and architectural decisions
├── CONTEXT.md           # domain glossary
└── AGENTS.md            # repository guidance for coding agents
```

Read [`AGENTS.md`](./AGENTS.md) for the working agreement and [`CONTEXT.md`](./CONTEXT.md) before changing domain terminology.

## Podman development (recommended)

Podman and `podman-compose` are the only runtime dependencies required for the full stack. The root launcher starts the frontend and backend, preserves the named `robot-data` volume, waits for health checks, and uses cached Podman/npm/pip layers.

```bash
./start-local.sh
```

Open `http://localhost:8080`. The backend health endpoint is available at `http://localhost:8000/api/health`.

Each start builds current source with cached layers and recreates the containers, so source updates take effect without an extra flag. Named robot data volumes are preserved:

```bash
./start-local.sh --build
./start-local.sh --logs
./start-local.sh --status
./start-local.sh --down
```

For quick feedback while editing application code, use the Podman-backed development mode:

```bash
./start-local.sh --dev
```

This mode builds the development images on startup, bind-mounts `apps/web` and the backend source into their containers, runs Vite and Uvicorn with reload enabled, and keeps the `robot-data` volume separate. The frontend remains available at `http://localhost:8080`, so ordinary source edits do not require an image rebuild or stack restart. Run `./start-local.sh --dev --down` to stop this mode. The normal command includes the Unitree SDK and host networking for DDS, with a Vite frontend.

In WSL, run these commands inside your Linux distribution with Linux `podman` and `podman-compose` installed. Run `podman info` to verify the runtime before starting. Base images use full `docker.io/library/...` names, so no short-name aliases or default registry configuration are needed. Open `http://localhost:8080` in your Windows browser once both services are healthy.

The first build downloads base images and dependencies. Later starts reuse cached layers and package-manager caches. `--build` remains accepted for compatibility. `--status` and `--down` do not build. If a service exits or fails its health check, the launcher prints its recent logs.

## Optional direct development

The direct workflow is useful when Podman is unavailable, but it requires local Node and Python dependencies. Podman-backed `--dev` mode is the recommended hot-reload workflow.

```bash
cd apps/web
npm ci
npm run dev
```

In another terminal:

```bash
cd apps/api
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open `http://localhost:5173/teach/pose`. The sample arm works without an upload. The routed workspace now provides separate full-page workflows:

- `/teach/pose` — multi-joint pose editing with precise numeric controls alongside sliders.
- `/teach/timeline` — a Blender-inspired animation editor with a time ruler, playhead, per-joint channels, diamond keyframes, interpolation, and replay.
- `/archive` — demonstrations and robot-scoped dataset organization.
- `/train` — temporal MLP training from authored keyframes and incremental next-state deltas.
- `/evaluate` — expected-versus-predicted trajectory playback and per-keyframe diagnostics.

Authored keyframes are the source of truth. Derived playback/training samples are not presented as editable timeline keys. Uploaded URDFs must use boxes, cylinders, or spheres; external mesh assets are rejected in this MVP. See [archive and session ownership](./docs/adr/0001-archive-and-session-ownership.md) for persistence, dataset membership, and simulation concurrency decisions.

## Tests

Frontend unit tests:

```bash
cd apps/web
npm run test:unit
```

Backend API and unit tests:

```bash
cd apps/api
pip install -r requirements-dev.txt
python -m pytest -q tests
```

Cypress uses the Podman frontend started by `./start-local.sh` by default:

```bash
cd apps/web
npm run test:e2e
```

For a Vite dev server instead, use `npm run test:e2e -- --config baseUrl=http://localhost:5173`.

## CI and parallel development

GitHub Actions validates pull requests, merge-queue candidates, and pushes to `master`/`main`. It checks infrastructure, frontend tests/design/build, backend tests, and container-backed browser journeys. The final `CI passed` check is the merge gate. There is no automated deployment or image publishing.

See [the contribution and CI guide](./docs/contributing.md) for worktree setup, reproducing checks, failure artifacts, and the GitHub ruleset needed to enforce the merge gate. Coding agents must use a separate branch and worktree for each task so independent changes can proceed at the same time.

The contribution guide also shows how to start a simulation preview with a unique Compose project and ports for each worktree.

## Frontend design reference

The current visual tokens and layout classes live in [`apps/web/src/styles.css`](./apps/web/src/styles.css); reusable controls live in [`apps/web/src/components/ui/`](./apps/web/src/components/ui/). Run `npm run lint:design` from `apps/web` to check the design-system conventions.
