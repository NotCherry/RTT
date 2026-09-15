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
  -h, --help    Show this help.
EOF
}

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

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

cat <<'EOF'

Robot Learning Workbench is running:
  Frontend: http://localhost:8080
  Backend:  http://localhost:8000/api/health

The services are published on all network interfaces (0.0.0.0).
EOF

if [[ -n "$LAN_IP" ]]; then
    cat <<EOF
  LAN frontend: http://${LAN_IP}:8080
  LAN backend:  http://${LAN_IP}:8000/api/health
EOF
fi

cat <<'EOF'

Use --logs to follow service output or --down to stop the stack.
EOF

if ((FOLLOW_LOGS)); then
    "${COMPOSE[@]}" logs -f
fi
