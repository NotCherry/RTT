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

## Optional direct development

The direct workflow is useful when hot reload is needed, but it requires local Node and Python dependencies. Docker remains the default workflow.

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

Open `http://localhost:5173`. The sample arm works without an upload. Capture poses or record gestures from the joint controls, then use the `Demonstrations` tab to rename, preview, replay, edit, and delete archived behavior. The `Test` tab shows training loss history and evaluates the selected demonstration after training. Uploaded URDFs must use boxes, cylinders, or spheres; external mesh assets are rejected in this MVP.

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

The current visual language, tokens, component recipes, and Tailwind migration rules are documented in [`docs/design-reference.md`](./docs/design-reference.md).
