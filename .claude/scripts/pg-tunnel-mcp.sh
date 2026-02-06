#!/bin/bash
# SSH tunnel + PostgreSQL MCP server wrapper
# Opens SSH tunnel to remote PostgreSQL, then starts the MCP server.
# Tunnel: local:5433 -> remote:127.0.0.1:5432 via SSH to root@77.246.106.109
#
# Credentials loaded from .env.mcp (gitignored):
#   DATABASE_URI=postgresql://user:pass@localhost:5433/dbname

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

LOCAL_PORT=5433
REMOTE_HOST=127.0.0.1
REMOTE_PORT=5432
SSH_HOST=root@77.246.106.109

# Load credentials from .env.mcp
if [ -f "$PROJECT_DIR/.env.mcp" ]; then
  set -a
  source "$PROJECT_DIR/.env.mcp"
  set +a
fi

if [ -z "$DATABASE_URI" ]; then
  echo "ERROR: DATABASE_URI not set. Create .env.mcp with:" >&2
  echo '  DATABASE_URI=postgresql://postgres:PASSWORD@localhost:5433/bookreader_dev' >&2
  exit 1
fi

# Check if tunnel already exists
if lsof -i :$LOCAL_PORT -sTCP:LISTEN >/dev/null 2>&1; then
  exec npx -y @crystaldba/postgres-mcp
fi

# Start SSH tunnel in background
ssh -f -N -L ${LOCAL_PORT}:${REMOTE_HOST}:${REMOTE_PORT} ${SSH_HOST} \
  -o ServerAliveInterval=60 \
  -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -o ConnectTimeout=10

# Wait for tunnel to be ready
for i in $(seq 1 10); do
  if lsof -i :$LOCAL_PORT -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# Cleanup tunnel on exit
cleanup() {
  pkill -f "ssh -f -N -L ${LOCAL_PORT}:${REMOTE_HOST}:${REMOTE_PORT} ${SSH_HOST}" 2>/dev/null
}
trap cleanup EXIT

# Start MCP server
exec npx -y @crystaldba/postgres-mcp
