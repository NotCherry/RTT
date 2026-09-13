# Robot Learning Workbench

A demonstration-first robot teaching environment for uploading primitive-geometry URDF robots, visualizing them in Three.js, recording named poses and timestamped gestures, archiving expected behavior, and training a small MLP with a FastAPI/PyBullet backend.

## Repository layout

```text
.
├── start-local.sh       # canonical Docker startup entrypoint
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

## Docker development (recommended)

Docker is the only runtime dependency required for the full stack. The root launcher starts the frontend and backend, preserves the named `robot-data` volume, waits for health checks, and uses cached Docker/npm/pip layers.

```bash
./start-local.sh
```

Open `http://localhost:8080`. The backend health endpoint is available at `http://localhost:8000/api/health`.

The normal command does not force a rebuild. After changing a Dockerfile or dependency lockfile, rebuild with the existing cache:

```bash
./start-local.sh --build
./start-local.sh --logs
./start-local.sh --status
./start-local.sh --down
```

For quick feedback while editing application code, use the Docker-backed development mode:

```bash
./start-local.sh --dev
```

This mode builds the development images on startup, bind-mounts `apps/web` and the backend source into their containers, runs Vite and Uvicorn with reload enabled, and keeps the `robot-data` volume separate. The frontend remains available at `http://localhost:8080`, so ordinary source edits do not require an image rebuild or stack restart. Run `./start-local.sh --dev --down` to stop this mode. Use the normal command when you want to inspect the production-style Nginx image instead.

## Optional direct development

The direct workflow is useful when Docker is unavailable, but it requires local Node and Python dependencies. Docker-backed `--dev` mode is the recommended hot-reload workflow.

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

Cypress uses the Docker frontend by default:

```bash
cd apps/web
npm run test:e2e
```

For a Vite dev server instead, use `npm run test:e2e -- --config baseUrl=http://localhost:5173`.

## Frontend design reference

The current visual tokens and layout classes live in [`apps/web/src/styles.css`](./apps/web/src/styles.css); reusable controls live in [`apps/web/src/components/ui/`](./apps/web/src/components/ui/). Run `npm run lint:design` from `apps/web` to check the design-system conventions.
