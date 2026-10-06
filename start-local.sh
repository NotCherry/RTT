#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_NAME="rtt"
COMPOSE_FILE=""
COMPOSE=()
FORCE_BUILD=0
FOLLOW_LOGS=0
DEV_MODE=0
STOP_STACK=0
SHOW_STATUS=0

usage() {
    cat <<'EOF'
Usage: ./start-local.sh [options]

Starts the local Robot Learning Workbench with Podman Compose. Podman reuses
existing images and containers by default; use --build when Dockerfiles or
dependency lockfiles have changed. Use --dev for bind-mounted source and live
reload during application development.

Options:
  --build       Rebuild images using Podman's layer and package caches.
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
    SOURCE_COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.dev.yml"
else
    SOURCE_COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.yml"
fi

if ! command -v podman >/dev/null 2>&1; then
    echo "Podman is required. Install Podman and its Compose provider first." >&2
    exit 1
fi

if ! command -v podman-compose >/dev/null 2>&1; then
    echo "podman-compose is required. Install Podman's Compose provider first." >&2
    exit 1
fi

if ! podman info >/dev/null 2>&1; then
    echo "Podman is installed but its machine/service is not running." >&2
    exit 1
fi

# podman-compose resolves build contexts and bind mounts relative to the
# compose file, unlike Docker Compose's --project-directory behavior. Place a
# short-lived copy in the repository root so the existing root-relative paths
# continue to work with both normal and --dev stacks.
COMPOSE_FILE="$(mktemp "$ROOT_DIR/.podman-compose.XXXXXX.yml")"
trap 'rm -f "$COMPOSE_FILE"' EXIT
cp "$SOURCE_COMPOSE_FILE" "$COMPOSE_FILE"
COMPOSE=(podman-compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE")

if ((STOP_STACK)); then
    "${COMPOSE[@]}" down
    exit 0
fi

if ((SHOW_STATUS)); then
    "${COMPOSE[@]}" ps
    exit 0
fi

images_missing=0
for image in "${PROJECT_NAME}_backend" "${PROJECT_NAME}_frontend"; do
    if ! podman image exists "$image"; then
        images_missing=1
    fi
done

if ((DEV_MODE)); then
    echo "Building the development images with the existing Podman cache."
    "${COMPOSE[@]}" build
elif ((FORCE_BUILD || images_missing)); then
    echo "Building with the existing Podman cache (use --no-cache manually for a clean build)."
    "${COMPOSE[@]}" build
fi

# --no-build makes the default path a true start-only operation. Use --build
# after source or dependency changes when using the production-style images.
# podman-compose does not implement Docker Compose's `up --wait` option.
"${COMPOSE[@]}" up -d --no-build --remove-orphans

wait_for_health() {
    local service="$1"
    local container=""
    local health=""
    local state=""

    for _ in {1..120}; do
        container="$(podman ps -aq \
            --filter "label=io.podman.compose.project=$PROJECT_NAME" \
            --filter "label=io.podman.compose.service=$service" | head -n 1 || true)"
        if [[ -n "$container" ]]; then
            state="$(podman inspect --format '{{.State.Status}}' "$container" 2>/dev/null || true)"
            if [[ "$state" == "exited" || "$state" == "dead" ]]; then
                echo "$service stopped before becoming healthy." >&2
                "${COMPOSE[@]}" logs --tail=50 "$service" >&2 || true
                return 1
            fi
            health="$(podman inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || true)"
            if [[ "$health" == "healthy" ]]; then
                return 0
            fi
            if [[ "$health" == "unhealthy" ]]; then
                echo "$service failed its health check." >&2
                "${COMPOSE[@]}" logs --tail=50 "$service" >&2 || true
                return 1
            fi
        fi
        sleep 1
    done

    echo "Timed out waiting for $service to become healthy." >&2
    "${COMPOSE[@]}" logs --tail=50 "$service" >&2 || true
    return 1
}

wait_for_health backend
wait_for_health frontend

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"

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
