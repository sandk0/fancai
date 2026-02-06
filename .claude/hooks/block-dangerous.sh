#!/bin/bash
# PreToolUse hook: Block dangerous bash commands
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if echo "$COMMAND" | grep -qE '(rm -rf /|rm -rf ~|rm -rf \.|drop table|DROP TABLE|truncate |TRUNCATE |chmod 777|> /dev/sda|git push --force|git reset --hard)'; then
  echo "BLOCKED: Dangerous command detected: $COMMAND" >&2
  exit 2
fi
exit 0
