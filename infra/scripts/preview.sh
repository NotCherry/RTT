#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Force stable project name so GH runner (rtt) and local (robots) share same preview stack/ports
export COMPOSE_PROJECT_NAME=robots
COMPOSE=(docker compose --project-directory "$ROOT_DIR" -p robots -f "$ROOT_DIR/infra/docker-compose.yml" -f "$ROOT_DIR/infra/docker-compose.preview.yml")

PORT="${1:-}"
if [[ "$1" == "--port" ]]; then
  PORT="$2"
fi
FRONTEND_PORT="${PREVIEW_FRONTEND_PORT:-${PORT:-8100}}"
BACKEND_PORT="${PREVIEW_BACKEND_PORT:-8101}"
export PREVIEW_FRONTEND_PORT="$FRONTEND_PORT"
export PREVIEW_BACKEND_PORT="$BACKEND_PORT"

usage() {
  cat <<EOF
Usage: ./infra/scripts/preview.sh [--port 8100] [--down|--logs|--status|--tailscale]

Local PR preview — same images as prod, isolated ports/volumes.

  --port <n>      Frontend preview port (default 8100, backend is +1)
  --down          Stop preview stack
  --logs          Follow preview logs
  --status        Show preview ps
  --tailscale     Expose via 'tailscale serve' (requires Tailscale on this host)
  --funnel        Expose via 'tailscale funnel' (public https, requires funnel enabled)
  -h, --help      Show help
EOF
}

ACTION="up"
TAILSCALE_MODE=""
while (($# > 0)); do
  case "$1" in
    --port) FRONTEND_PORT="$2"; BACKEND_PORT="$((FRONTEND_PORT+1))"; export PREVIEW_FRONTEND_PORT="$FRONTEND_PORT"; export PREVIEW_BACKEND_PORT="$BACKEND_PORT"; shift 2;;
    --down) ACTION="down"; shift;;
    --logs) ACTION="logs"; shift;;
    --status) ACTION="status"; shift;;
    --tailscale) TAILSCALE_MODE="serve"; shift;;
    --funnel) TAILSCALE_MODE="funnel"; shift;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown arg: $1" >&2; usage >&2; exit 2;;
  esac
done

case "$ACTION" in
  down)
    "${COMPOSE[@]}" --profile preview down
    if [[ -n "$TAILSCALE_MODE" ]]; then tailscale serve --https=443 --bg "http://127.0.0.1:${FRONTEND_PORT}" 2>/dev/null || true; fi
    exit 0;;
  logs)
    "${COMPOSE[@]}" --profile preview logs -f
    exit 0;;
  status)
    "${COMPOSE[@]}" --profile preview ps
    exit 0;;
  up)
    echo "Starting preview: frontend http://localhost:${FRONTEND_PORT} backend http://localhost:${BACKEND_PORT}"
    "${COMPOSE[@]}" --profile preview up -d --wait
    cat <<EOF

Preview is running:
  Frontend: http://localhost:${FRONTEND_PORT}
  Backend:  http://localhost:${BACKEND_PORT}/api/health
  Health:   curl http://localhost:${BACKEND_PORT}/api/health

Other contributors: git fetch && ./infra/scripts/preview.sh --port ${FRONTEND_PORT}
EOF
    if [[ "$TAILSCALE_MODE" == "serve" ]]; then
      if ! command -v tailscale >/dev/null; then echo "tailscale not found, skipping serve" >&2; exit 0; fi
      tailscale serve --bg "http://127.0.0.1:${FRONTEND_PORT}"
      echo "Tailscale serve: https://$(tailscale status --json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get(\"Self\",{}).get(\"DNSName\",\"your-tailnet\"))' 2>/dev/null || echo 'your-tailnet')  (tailscale serve status)"
      tailscale serve status || true
    elif [[ "$TAILSCALE_MODE" == "funnel" ]]; then
      if ! command -v tailscale >/dev/null; then echo "tailscale not found" >&2; exit 0; fi
      tailscale funnel --bg "http://127.0.0.1:${FRONTEND_PORT}"
      tailscale funnel status || true
    fi
    ;;
esac
