---
status: partial
phase: 29-docker-db
source: [29-VERIFICATION.md]
started: 2026-03-24T12:30:00Z
updated: 2026-03-24T12:30:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Миграция PostgreSQL через pg_dump/restore на production
expected: PostgreSQL переезжает с postgres:17.9-alpine на pgvector/pgvector:0.8.2-pg17 без потери данных, ORDER BY на русском тексте корректен (locale=C)
result: [pending]

### 2. Старт celery-worker с реальным PyTorch CPU-only image
expected: Worker стартует за ≤120 секунд, healthcheck проходит, потребление памяти ≤4GB при холодном старте с загрузкой PyTorch
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
