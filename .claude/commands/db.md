---
description: Database operations. Usage /db [stats|connections|slow]
allowed-tools: Bash
---

# Database Operations

Usage: `/db stats` | `/db connections` | `/db slow`

### Stats (default)

```bash
ssh fancai "docker exec fancai_postgres psql -U fancai -c \"SELECT tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC LIMIT 15;\""
```

### Connections

```bash
ssh fancai "docker exec fancai_postgres psql -U fancai -c \"SELECT count(*) as total, state FROM pg_stat_activity GROUP BY state;\""
```

### Slow Queries

```bash
ssh fancai "docker exec fancai_postgres psql -U fancai -c \"SELECT query, calls, mean_exec_time::numeric(10,2) as avg_ms FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;\"" 2>/dev/null || echo "pg_stat_statements not enabled"
```

IMPORTANT: Never run INSERT/UPDATE/DELETE/DROP without explicit user confirmation.
