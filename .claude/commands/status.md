---
description: Quick overview of project health — git, tests, production status
allowed-tools: Bash, Read
---

# Project Status Check

1. Git status:

```bash
echo "=== Git ===" && git branch --show-current && git status --short && git log --oneline -3
```

2. Production health:

```bash
echo "=== Production ===" && curl -s -o /dev/null -w 'fancai.ru: HTTP %{http_code} (%{time_total}s)\n' https://fancai.ru
```

3. Container status (if SSH available):

```bash
echo "=== Containers ===" && ssh fancai "cd /opt/fancai/app && docker compose -f docker-compose.prod.yml ps --format 'table {{.Name}}\t{{.State}}\t{{.Status}}'" 2>/dev/null || echo "SSH not available"
```

4. Current phase: Read `.planning/STATE.md` for current position.

Report all findings in a concise summary.
