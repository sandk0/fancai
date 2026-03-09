#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Check if this is an alembic command
if echo "$COMMAND" | grep -qi 'alembic'; then
  # Block downgrade in production-like context
  if echo "$COMMAND" | grep -qi 'downgrade'; then
    echo "BLOCKED: alembic downgrade is dangerous. Create a new migration instead." >&2
    exit 2
  fi

  # Warn on alembic stamp (rewriting history) — ask user to confirm
  if echo "$COMMAND" | grep -qi 'stamp'; then
    echo "WARNING: alembic stamp rewrites migration history. Confirm?" >&2
    exit 1
  fi
fi

# Block destructive raw SQL
if echo "$COMMAND" | grep -qiE '(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)'; then
  echo "BLOCKED: Destructive SQL detected. Use Alembic migrations for schema changes." >&2
  exit 2
fi

exit 0
