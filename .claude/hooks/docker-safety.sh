#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Block docker compose down --volumes (destroys PostgreSQL data)
if echo "$COMMAND" | grep -qiE 'docker\s+compose.*down.*(-v|--volumes)'; then
  echo "BLOCKED: 'docker compose down --volumes' destroys PostgreSQL data volumes. Use 'docker compose down' without --volumes." >&2
  exit 2
fi

# Block docker system prune -a (removes all cached layers)
if echo "$COMMAND" | grep -qiE 'docker\s+(system\s+prune|volume\s+prune|image\s+prune\s+-a)'; then
  echo "BLOCKED: Docker prune operations could remove cached layers. Run manually if needed." >&2
  exit 2
fi

exit 0
