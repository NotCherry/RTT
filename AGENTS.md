# Agent guide

## Start here

This repository is a demonstration-first robot teaching environment. Read [`CONTEXT.md`](./CONTEXT.md) before changing domain terminology, and read the relevant ADR in [`docs/adr/`](./docs/adr/) before changing product scope.

The canonical local entrypoint is `./start-local.sh`. Prefer the Docker workflow because it starts the complete stack without requiring Node or Python dependencies on the host.

## Repository boundaries

- `apps/web/` — React, Vite, Three.js, Tailwind, frontend unit tests, and Cypress journeys. Run frontend commands from this directory.
- `apps/api/` — FastAPI, PyBullet, PyTorch, backend tests, and Python dependency files. Run backend commands from this directory.
- `infra/` — Docker Compose orchestration and deployment-level configuration. Keep app implementation out of this directory.
- `packages/` — reserved for a genuinely shared library. Add a package only when at least two apps need the same stable contract or utility.
- `docs/` — design reference and durable architectural decisions.

Keep changes inside the owning app unless the change is truly cross-cutting. Do not create a shared package merely to move code; first establish real reuse and an explicit interface.

## Verification loop

After frontend changes:

```bash
cd apps/web
npm run test:unit
npm run build
```

After backend changes:

```bash
cd apps/api
python -m pytest -q tests
```

For an end-to-end user-flow check, start the stack with `./start-local.sh`, then run `cd apps/web && npm run test:e2e` against the configured frontend URL.

Before finishing any change, run `git diff --check` and report any test that could not run because of an environment limitation.

## Change confidence

For every behavior change, assess whether a focused test would protect the user-visible or core behavior; add that test when it would be beneficial. Prefer a frontend journey or component test for interactive controls. Before finishing, exercise the changed flow and its adjacent core functionality, and report any verification that could not run because of an environment limitation.

## Commits

Commit after each completed goal or task, once the Verification loop passes.
Use Conventional Commits extended syntax: `type(scope): subject`, blank line, meaningful body stating what changed and why, `Refs:` footer with the goal/task id when one exists.
Allowed types: feat, fix, refactor, test, docs, chore. Scopes: web, api, infra, docs. Keep one logical change per commit.
Never finish with uncommitted work: run `git status --porcelain` before stopping and commit everything, including formatter output. The tree must be clean when the work is done.

## Finishing

Before marking a goal complete, run the code-review skill on the branch diff and address its findings.
After UI changes, self-check layout and styling against `apps/web/src/styles.css` and the surrounding panels (alignment, spacing, no duplicated actions); reuse system classes instead of inline styles and fix issues without being asked.

## Product guardrails

- Demonstrations are the primary product artifact; training metrics are secondary diagnostics.
- Preserve primitive URDF support: boxes, cylinders, and spheres. External mesh assets remain rejected.
- Keep the initial behavior model MLP-oriented and simple.
- Use the existing domain terms in `CONTEXT.md`; if a new term is needed, update the glossary before using it broadly.
