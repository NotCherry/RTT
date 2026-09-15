#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export COMPOSE_PROJECT_NAME=robots
COMPOSE=(docker compose --project-directory "$ROOT_DIR" -p robots -f "$ROOT_DIR/infra/docker-compose.yml" -f "$ROOT_DIR/infra/docker-compose.preview.yml")

FRONTEND_PORT="${PREVIEW_FRONTEND_PORT:-8100}"
BACKEND_PORT="${PREVIEW_BACKEND_PORT:-8101}"

usage() {
  cat <<'EOF'
Usage: ./infra/scripts/preview.sh [--port 8100] [--down|--logs|--status]

Starts an isolated local preview using the production images.

  --port <n>      Frontend preview port (default 8100; backend is n + 1)
  --down          Stop the preview stack
  --logs          Follow preview logs
  --status        Show preview status
  -h, --help      Show this help
EOF
}

ACTION="up"
while (($# > 0)); do
  case "$1" in
    --port)
      FRONTEND_PORT="$2"
      BACKEND_PORT="$((FRONTEND_PORT + 1))"
      shift 2
      ;;
    --down) ACTION="down"; shift ;;
    --logs) ACTION="logs"; shift ;;
    --status) ACTION="status"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

export PREVIEW_FRONTEND_PORT="$FRONTEND_PORT"
export PREVIEW_BACKEND_PORT="$BACKEND_PORT"

case "$ACTION" in
  down) "${COMPOSE[@]}" --profile preview down ;;
  logs) "${COMPOSE[@]}" --profile preview logs -f ;;
  status) "${COMPOSE[@]}" --profile preview ps ;;
  up)
    "${COMPOSE[@]}" --profile preview up -d --wait
    cat <<EOF

Preview is running:
  Frontend: http://localhost:${FRONTEND_PORT}
  Backend:  http://localhost:${BACKEND_PORT}/api/health
EOF
    ;;
esac
