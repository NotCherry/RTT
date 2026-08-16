# Robot Learning Workbench

A vertical MVP for uploading primitive-geometry URDF robots, visualizing them in Three.js, controlling joints, capturing target poses, and training a small behavior-cloning MLP with a FastAPI/PyBullet backend.

## Local development

```bash
npm install
python -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --app-dir backend --reload
npm run dev
```

Open `http://localhost:5173`. The sample arm works without an upload. Uploaded URDFs must use boxes, cylinders, or spheres; external mesh assets are rejected in this MVP.

## Docker

```bash
docker compose up --build
```

Then open `http://localhost:8080`.
