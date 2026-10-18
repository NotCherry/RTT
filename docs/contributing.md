# Contributing and CI

Each change belongs to one branch and worktree. GitHub Actions validates the
combined application before a merge. There is no continuous deployment, registry
publishing, Render configuration, or Jenkins pipeline in this repository.

## Start an independent change

From the main checkout, inspect existing work before creating a worktree:

```bash
git status --short
git worktree list
git fetch origin
git remote set-head origin --auto
BASE=$(git symbolic-ref --short refs/remotes/origin/HEAD)
git worktree add -b codex/describe-task ../RTT-describe-task "$BASE"
cd ../RTT-describe-task
```

Use a different branch and directory for each task. Continue existing work in its
own worktree. In Codex, use the managed worktree tools when available, then create
the `codex/<task>` branch in that worktree. The original checkout stays available
for other work. Install dependencies separately in each worktree; do not share a
writable `node_modules`, virtual environment, or test database between tasks.

The canonical `./start-local.sh` uses a fixed `rtt` project and ports 8080/8000.
Only one worktree should use it at a time. To run another simulation stack,
choose unused ports and a unique project name, and start only the preview services:

```bash
export PREVIEW_FRONTEND_PORT=8100 PREVIEW_BACKEND_PORT=8101
docker compose --project-directory . -p rtt-describe-task \
  -f infra/docker-compose.yml -f infra/docker-compose.preview.yml \
  --profile preview up -d --build --wait backend-preview frontend-preview
```

The project name isolates image names and the preview data volume. Open
`http://localhost:8100`. Test the built preview from `apps/web` with
`npm run test:e2e -- --spec cypress/e2e/stack-smoke.cy.ts --config baseUrl=http://localhost:8100`.
For all camera journeys, start a separate Vite server from `apps/web`:

```bash
VITE_API_PROXY_TARGET=http://localhost:8101 VITE_WS_PROXY_TARGET=ws://localhost:8101 \
  npm run dev -- --port 5174 --strictPort
# In another terminal in this worktree's apps/web:
npm run test:e2e -- --config baseUrl=http://localhost:5174
```

Choose a different Vite port for each task too. Stop the containers with the same project,
files, and environment, replacing the `up ...` arguments with `down`. Omit
`--volumes` when retaining local demonstrations. The `infra/scripts/preview.sh`
convenience wrapper uses a shared project; use the explicit command above for
concurrent worktrees.

## Checks and failure diagnostics

The `CI` workflow runs on every pull request, pushes to `master`/`main`, merge
queue `checks_requested` events, and manual dispatch. Pull requests use GitHub's
test merge commit, so checks cover the proposed integration with the target
branch. There are no path filters or draft skips that leave required checks
pending. New commits cancel superseded runs for that PR; default branch and
merge queue runs finish independently.

| Check | Coverage |
| --- | --- |
| Infrastructure | Patch whitespace, Actionlint, shell syntax, infrastructure tests, Compose configurations |
| Web | Node 22, locked npm install, design conventions, Vitest, TypeScript and Vite production build |
| API | Python 3.11, development requirements, all backend pytest tests |
| Container and browser integration | Cached image builds, health checks, a real pose capture through Nginx/API, then all Cypress journeys through Vite with the API container using Electron |
| CI passed | Fails unless all four checks succeeded, including when a dependency was skipped or cancelled |

The four checks run independently for quick feedback. CI uses read-only repository
permissions and requires no deployment secrets, camera credentials, or robot
hardware. The integration stack has fresh disposable data and uses the simulation
image. Four native DDS/SDK test modules skip when the optional Unitree SDK is
absent; physical robot behavior still needs separate hardware validation.
Browser tests use their existing fake camera/mock transport fixtures.
No test automatically arms a physical robot.

The production smoke journey observes real API requests without stubbing them.
The full suite runs against Vite because existing camera perception fixtures
intercept source-module requests. Both runs use the same simulation backend.

Open a failed run's **Artifacts** to download JUnit reports. The integration
artifact also contains Compose status/logs, Cypress screenshots, and videos.
Artifacts are retained for seven days. The final job summary lists each job's
result. BuildKit caches use separate web/API scopes; npm, pip, and Cypress cache downloads,
while dependency installation still runs on each job. Dependabot groups monthly
GitHub Actions updates into a single pull request.

## Reproduce checks locally

Frontend (Node 22, matching the web image):

```bash
cd apps/web
npm ci
npm run lint:design
npm run test:unit
npm run build
```

Backend (Python 3.11, matching the API image; use a local virtual environment):

```bash
cd apps/api
python -m pip install -r requirements-dev.txt
python -m pytest -q tests
```

Infrastructure, from the repository root:

```bash
git diff --check
docker run --rm -v "$PWD:/repo" -w /repo docker.io/rhysd/actionlint:1.7.12 -color
while IFS= read -r -d '' file; do bash -n "$file" || exit; done < <(git ls-files -z '*.sh')
python3 -m unittest discover -s infra/tests -v
for file in infra/docker-compose.yml infra/docker-compose.dev.yml infra/docker-compose.robot.yml; do
  docker compose --project-directory . -f "$file" config --quiet || exit
done
docker compose --project-directory . -f infra/docker-compose.yml -f infra/docker-compose.ci.yml config --quiet
docker compose --project-directory . -f infra/docker-compose.yml -f infra/docker-compose.preview.yml --profile preview config --quiet
```

Reproduce the CI simulation stack on unused default ports (8080/8000):

```bash
export COMPOSE_FILE=infra/docker-compose.yml:infra/docker-compose.ci.yml
export COMPOSE_PROJECT_NAME=rtt-ci-local
docker compose --project-directory . up -d --build --wait --wait-timeout 120
curl --fail http://localhost:8080/api/health
cd apps/web
npm ci
npm run test:e2e -- --browser electron --spec cypress/e2e/stack-smoke.cy.ts
# In another terminal, start `npm run dev` from this worktree's apps/web.
npm run test:e2e -- --browser electron --config baseUrl=http://localhost:5173
cd ../..
docker compose --project-directory . down --volumes --remove-orphans
unset COMPOSE_FILE COMPOSE_PROJECT_NAME
```

This last command deletes only that disposable CI project's data. Do not reuse
the project name for an operator's local stack. Hosted Actions additionally
exercises the Docker Buildx GitHub cache backend, which needs the runner's cache
service and cannot be reproduced by Podman alone.

## Enable the merge gate in GitHub

Repository files define checks; a GitHub ruleset enforces them. After this
workflow has run, configure **Settings → Rules → Rulesets** for the actual default
branch:

1. Require a pull request before merging and require conversation resolution.
2. Require the **CI passed** status check from GitHub Actions. Remove obsolete
   required job names, especially deployment checks. Do not require both this
   aggregate and its individual jobs.
3. Require branches to be up to date before merging. If the repository's plan
   supports merge queues, enable the queue instead to test combinations of queued
   changes against the latest target branch. The workflow already handles
   `merge_group` events.
4. Block force pushes and branch deletion on the default branch. Avoid routine
   bypasses that would allow unchecked changes through.

These settings must be applied by a repository administrator; committing the
workflow does not enable branch protection. No workflow auto-merges changes.
Remove unused `RENDER_API_DEPLOY_HOOK_URL` and `RENDER_WEB_DEPLOY_HOOK_URL` secrets
in repository settings, and disable any external Render/Jenkins integrations if
they still exist. Deleting their repository files does not stop external services.

Before merging another completed task, refresh the task branch:

```bash
git fetch origin
git merge origin/master  # use the actual target branch
```

Resolve conflicts in that task's worktree, rerun affected checks, review the full
branch diff, and commit the result. Require green CI for the current merge
candidate. After the PR is merged, remove its clean worktree and local branch
when no longer needed; retain active task worktrees for review.

References: [required-check behavior](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
and [GitHub merge queues](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue).
