#!/bin/bash
# Auto-format after Edit/Write operations
# PostToolUse hooks receive tool input via stdin as JSON

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.file // empty')

# Skip if no file path or file doesn't exist
[ -z "$FILE" ] && exit 0
[ ! -f "$FILE" ] && exit 0

EXT="${FILE##*.}"

case "$EXT" in
  ts|tsx|js|jsx|json|css|md)
    if command -v npx &> /dev/null; then
      npx prettier --write "$FILE" 2>/dev/null
    fi
    ;;
  py)
    if command -v black &> /dev/null; then
      black --quiet "$FILE" 2>/dev/null
    fi
    ;;
esac

exit 0
