#!/bin/bash
# PreToolUse hook: Block edits to protected files
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

PROTECTED_PATTERNS=(".env" "package-lock.json" "yarn.lock" ".git/" "alembic/versions/" ".pem" ".key" "credentials")

for pattern in "${PROTECTED_PATTERNS[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "BLOCKED: $FILE_PATH matches protected pattern '$pattern'. Ask user for permission first." >&2
    exit 2
  fi
done
exit 0
