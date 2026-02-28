#!/bin/bash
# PreToolUse hook: Block dangerous bash commands
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -qiE '(rm -rf /|rm -rf ~|rm -rf \.|drop\s+table|truncate\s+table|alter\s+table\s+.*drop|delete\s+from\s+\S+\s*;?\s*$|chmod 777|> /dev/sda|git push --force|git reset --hard)'; then
  echo "BLOCKED: Dangerous command detected: $COMMAND" >&2
  exit 2
fi
exit 0
