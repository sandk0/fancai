#!/bin/bash
# Auto-format after Edit/Write operations
# Called with file path as argument

FILE="$1"
EXT="${FILE##*.}"

# Skip if file doesn't exist
[ ! -f "$FILE" ] && exit 0

case "$EXT" in
  ts|tsx|js|jsx|json|css|md)
    # Format with Prettier (if available)
    if command -v npx &> /dev/null; then
      npx prettier --write "$FILE" 2>/dev/null
    fi
    ;;
  py)
    # Format with Black (if available)
    if command -v black &> /dev/null; then
      black --quiet "$FILE" 2>/dev/null
    fi
    ;;
esac

exit 0
