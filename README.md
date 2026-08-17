# Robot Learning Workbench

A demonstration-first MVP for uploading primitive-geometry URDF robots, visualizing them in Three.js, recording named poses and timestamped gestures, archiving expected behavior, and training a small MLP with a FastAPI/PyBullet backend.

## Local development

```bash
npm install
python -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --app-dir backend --reload
npm run dev
```

Open `http://localhost:5173`. The sample arm works without an upload. Capture poses or record gestures from the joint controls, then use the `Demonstrations` tab to rename, preview, replay, edit, and delete archived behavior. The `Test` tab shows training loss history and evaluates the selected demonstration after training. Uploaded URDFs must use boxes, cylinders, or spheres; external mesh assets are rejected in this MVP.

## Docker local development

Docker is the only runtime dependency required for the full local stack. The launcher starts the existing Compose images without forcing a rebuild, preserves the named robot-data volume, and enables BuildKit cache mounts for npm and pip dependencies.

```bash
./scripts/start-local.sh
```

Use `./scripts/start-local.sh --build` after changing a Dockerfile or dependency lockfile. The build reuses unchanged Docker layers and package-manager caches. Other useful commands are:

```bash
./scripts/start-local.sh --logs
./scripts/start-local.sh --status
./scripts/start-local.sh --down
```

Then open `http://localhost:8080`. Robot session data remains in the `robot-data` Docker volume when the stack is stopped.

## Frontend design reference

The current visual language, tokens, component recipes, and Tailwind migration rules are documented in [`docs/design-reference.md`](./docs/design-reference.md).

## Tests

Install backend test dependencies with `pip install -r backend/requirements-dev.txt`. Run frontend unit tests with `npm run test:unit`, the focused backend suite with `npm run test:backend`, and start the frontend with `npm run dev` in another terminal before running the Cypress journey with `npm run test:e2e`.
