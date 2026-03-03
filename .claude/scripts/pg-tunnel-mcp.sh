#!/bin/bash
# SSH tunnel + PostgreSQL MCP server wrapper
# Tunnel: local:5433 -> remote:127.0.0.1:5432 via root@77.246.106.109
# Credentials: .env.mcp (gitignored)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

LOCAL_PORT=5433
REMOTE_HOST=127.0.0.1
REMOTE_PORT=5432
SSH_HOST=root@77.246.106.109

# Load DATABASE_URI from .env.mcp
if [ -f "$PROJECT_DIR/.env.mcp" ]; then
  set -a
  source "$PROJECT_DIR/.env.mcp"
  set +a
fi

if [ -z "$DATABASE_URI" ]; then
  echo "ERROR: DATABASE_URI not set. Create .env.mcp with:" >&2
  echo '  DATABASE_URI=postgresql://postgres:PASSWORD@localhost:5433/fancai_dev' >&2
  exit 1
fi

# Start tunnel if not already running
if ! lsof -i :$LOCAL_PORT -sTCP:LISTEN >/dev/null 2>&1; then
  ssh -f -N -L ${LOCAL_PORT}:${REMOTE_HOST}:${REMOTE_PORT} ${SSH_HOST} \
    -o ServerAliveInterval=60 \
    -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes \
    -o ConnectTimeout=10

  for i in $(seq 1 10); do
    lsof -i :$LOCAL_PORT -sTCP:LISTEN >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

cleanup() {
  pkill -f "ssh -f -N -L ${LOCAL_PORT}:${REMOTE_HOST}:${REMOTE_PORT} ${SSH_HOST}" 2>/dev/null
}
trap cleanup EXIT

exec npx -y @crystaldba/postgres-mcp
