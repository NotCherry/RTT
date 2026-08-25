# Preview & deploy options

## Goal
- Branch → PR → CI → phone-check on mobile (coding agents).
- Contributors can reproduce locally without cloud.

## Three options (implement 1 + parity layer)

| Option | Runner | Phone URL | Needs laptop on? | Friction |
|---|---|---|---|---|
| **A Laptop + Tailscale serve (recommended)** | self-hosted `[preview]` | `https://<machine>.<tailnet>.ts.net` via tailnet | yes | low |
| **B Cloud PR preview** | `ubuntu-latest` → push to GHCR → Fly/Render | public `https://pr-123.robots.fly.dev` | no | needs Fly token |
| **C Jenkins on laptop** | Jenkins agent `[preview]` | same as A via `tailscale serve` | yes | Jenkins upkeep |

### Common parity layer (all options)
`infra/docker-compose.preview.yml` + `infra/scripts/preview.sh`:

```bash
./infra/scripts/preview.sh --port 8100        # local, isolated volumes/ports
./infra/scripts/preview.sh --port 8100 --tailscale   # + tailscale serve
./infra/scripts/preview.sh --port 8100 --funnel      # + tailscale funnel (public)
./infra/scripts/preview.sh --down
```

Main stack stays on 8080/8000, preview on 8100/8101 with `robot-data-preview` volume.

### GitHub Actions
- `.github/workflows/ci.yml` — always runs on PR: web `test:unit`+`build`, api `pytest`, `docker build`.
- `.github/workflows/preview.yml` — requires label `preview` or branch `preview/*` and a self-hosted runner `preview`. Runs same `preview.sh` + `tailscale serve/funnel`. Skips if no runner (safe for forks).

Setup self-hosted preview runner on your laptop:
1. Repo → Settings → Actions → Runners → New self-hosted runner → labels `preview`.
2. `sudo tailscale up` and `tailscale serve --bg http://127.0.0.1:8100` once.
3. Push branch `preview/my-fix` or add label `preview` to PR.

### Jenkins alternative (`Jenkinsfile`)
Same stages, same `preview.sh`. Set `TAILSCALE_MODE=serve|funnel|off`. Any contributor can run locally without Jenkins.

### Recommendation
Start with **A + parity layer** (this PR). Add B later via `vars.ENABLE_CLOUD_PREVIEW` if you need laptop-independent reviews.
