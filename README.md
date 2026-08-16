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

## Docker

```bash
docker compose up --build
```

Then open `http://localhost:8080`.
