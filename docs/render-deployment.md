# Deploying to Render

This repository deploys two Render services from `render.yaml`:

- `robot-learning-workbench-api` is the FastAPI/PyBullet/PyTorch web service. It mounts a persistent disk at `/var/data` so uploaded robots survive deploys.
- `robot-learning-workbench-web` is a static Vite site. Its browser build calls the API through `VITE_API_URL`.

GitHub Actions is the deployment gate. The `CI` workflow runs the frontend tests and build, backend tests, and Docker image builds. Only a successful push to `main` or `master` then calls the two Render deploy hooks for that exact Git revision. Pull requests never deploy production.

## One-time setup

1. Push this repository, including `render.yaml`, to GitHub.
2. In Render, select **New** > **Blueprint**, connect the GitHub repository, and select its `render.yaml` file.
3. Keep the API service on a plan with at least 2 GB RAM. The application imports PyTorch and PyBullet, so the free 512 MB plan is not an appropriate production target. The Blueprint selects Render's `1c-2g` plan and a 1 GB persistent disk; review the resulting price before creating it.
4. When Render asks for the two `sync: false` values, enter:

   - `CORS_ORIGINS`: `https://robot-learning-workbench-web.onrender.com`
   - `VITE_API_URL`: `https://robot-learning-workbench-api.onrender.com`

   If Render asks you to change either service name, replace these with the actual public URLs. `VITE_API_URL` is compiled into the static site, so redeploy the web service after changing it.
5. Let the first API and web deploy finish. Confirm `https://robot-learning-workbench-api.onrender.com/api/health` returns `{"status":"ok"}`, then open the web URL and create a sample session.
6. In each Render service, open **Settings** and copy its **Deploy Hook** URL. Treat each URL as a secret.
7. In GitHub, open **Settings** > **Secrets and variables** > **Actions** and create these repository secrets:

   - `RENDER_API_DEPLOY_HOOK_URL` — API service deploy hook
   - `RENDER_WEB_DEPLOY_HOOK_URL` — web service deploy hook

8. Push a small commit to `main` or `master`. The `CI` workflow must pass before it triggers both deploy hooks. View deployment status in the GitHub Actions run and the Render dashboard.

## Ongoing operation

- Use pull requests for validation. They run CI but do not deploy production.
- Merge or push to `main`/`master` to deploy. The workflow includes `ref=$GITHUB_SHA`, which tells Render to deploy the revision that CI validated.
- Before rotating a deploy hook, update its matching GitHub secret. A stale hook makes the production deployment job fail safely.
- If you add a custom domain, update `CORS_ORIGINS` with that exact `https://` origin and redeploy the API. Keep the API's `onrender.com` URL in the list if it remains a supported frontend origin.

## Local development

No Render variables are required locally. Without `DATA_DIR` and `CORS_ORIGINS`, the API keeps its existing `apps/api/data` storage and localhost Vite origins. Continue using `./start-local.sh` for the complete local stack.
