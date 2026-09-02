#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose --project-directory "$ROOT_DIR")
FORCE_BUILD=0
FOLLOW_LOGS=0
DEV_MODE=0
STOP_STACK=0
SHOW_STATUS=0

usage() {
    cat <<'EOF'
Usage: ./start-local.sh [options]

Starts the local Robot Learning Workbench with Docker Compose. Docker Compose
reuses existing images and containers by default; use --build when Dockerfiles
or dependency lockfiles have changed. Use --dev for bind-mounted source and
live reload during application development.

Options:
  --build       Rebuild images using Docker's layer and package caches.
  --dev         Start bind-mounted frontend/backend development servers with live reload.
  --logs        Follow backend and frontend logs after startup.
  --down        Stop and remove the Compose containers, keeping robot data.
  --status      Show the current Compose service status.
  --tailscale   Expose frontend via 'tailscale serve' (tailnet only, https)
  --funnel      Expose frontend via 'tailscale funnel' (public https)
  -h, --help    Show this help.
EOF
}

TAILSCALE_MODE="${TAILSCALE_MODE:-}"
while (($# > 0)); do
    case "$1" in
    --build)
        FORCE_BUILD=1
        ;;
    --dev)
        DEV_MODE=1
        ;;
    --logs)
        FOLLOW_LOGS=1
        ;;
    --down)
        STOP_STACK=1
        ;;
    --status)
        SHOW_STATUS=1
        ;;
    --tailscale)
        TAILSCALE_MODE="serve"
        ;;
    --funnel)
        TAILSCALE_MODE="funnel"
        ;;
    -h | --help)
        usage
        exit 0
        ;;
    *)
        echo "Unknown option: $1" >&2
        usage >&2
        exit 2
        ;;
    esac
    shift
done

if ((DEV_MODE)); then
    COMPOSE+=(-f "$ROOT_DIR/infra/docker-compose.dev.yml")
else
    COMPOSE+=(-f "$ROOT_DIR/infra/docker-compose.yml")
fi

if ((STOP_STACK)); then
    "${COMPOSE[@]}" down
    # Best-effort: clear any previous tailscale serve/funnel for the local frontend.
    if command -v tailscale >/dev/null 2>&1; then
        tailscale serve --https=443 off >/dev/null 2>&1 || true
        tailscale funnel --https=443 off >/dev/null 2>&1 || true
    fi
    exit 0
fi

if ((SHOW_STATUS)); then
    "${COMPOSE[@]}" ps
    exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required. Install Docker Desktop or Docker Engine first." >&2
    exit 1
fi

if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed but the Docker daemon is not running." >&2
    exit 1
fi

# BuildKit keeps Dockerfile layers and package-manager cache mounts reusable.
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

images_missing=0
while IFS= read -r image; do
    if ! docker image inspect "$image" >/dev/null 2>&1; then
        images_missing=1
    fi
done < <("${COMPOSE[@]}" config --images)

if ((DEV_MODE)); then
    echo "Building the development images with the existing Docker cache."
    "${COMPOSE[@]}" build
elif ((FORCE_BUILD || images_missing)); then
    echo "Building with the existing Docker cache (use --no-cache manually for a clean build)."
    "${COMPOSE[@]}" build
fi

# --no-build makes the default path a true start-only operation. Use --build
# after source or dependency changes when using the production-style images.
"${COMPOSE[@]}" up -d --no-build --remove-orphans --wait

cat <<'EOF'

Robot Learning Workbench is running:
  Frontend: http://localhost:8080
  Backend:  http://localhost:8000/api/health

Use --logs to follow service output or --down to stop the stack.
EOF

if [[ "$TAILSCALE_MODE" == "serve" ]]; then
    if ! command -v tailscale >/dev/null 2>&1; then
        echo "tailscale not found, skipping 'tailscale serve'." >&2
    else
        echo "Exposing frontend via Tailscale serve (tailnet only)..."
        if tailscale serve --bg "http://127.0.0.1:8080" 2>&1; then
            tailscale serve status || true
            DNS="$(tailscale status --json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("Self",{}).get("DNSName",""))' 2>/dev/null || true)"
            if [[ -n "$DNS" ]]; then
                echo "Tailscale URL: https://${DNS}"
            else
                echo "Tailscale serve active: https://<your-machine>.<tailnet>.ts.net"
            fi
        else
            echo "tailscale serve failed (is Tailscale up? try 'sudo tailscale up')." >&2
        fi
    fi
elif [[ "$TAILSCALE_MODE" == "funnel" ]]; then
    if ! command -v tailscale >/dev/null 2>&1; then
        echo "tailscale not found, skipping 'tailscale funnel'." >&2
    else
        echo "Exposing frontend via Tailscale funnel (public https)..."
        if tailscale funnel --bg "http://127.0.0.1:8080" 2>&1; then
            tailscale funnel status || true
            DNS="$(tailscale status --json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("Self",{}).get("DNSName",""))' 2>/dev/null || true)"
            if [[ -n "$DNS" ]]; then
                echo "Tailscale funnel URL: https://${DNS}"
            fi
        else
            echo "tailscale funnel failed (is funnel enabled? see 'tailscale funnel --help')." >&2
        fi
    fi
fi

if ((FOLLOW_LOGS)); then
    "${COMPOSE[@]}" logs -f
fi
