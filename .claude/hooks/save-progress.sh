#!/bin/bash
# PreCompact hook: Save progress before context compaction
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$CLAUDE_PROJECT_DIR/.claude/backups"
mkdir -p "$BACKUP_DIR"

# Save current git diff as backup
cd "$CLAUDE_PROJECT_DIR" 2>/dev/null && git diff > "$BACKUP_DIR/diff_${TIMESTAMP}.patch" 2>/dev/null
exit 0
