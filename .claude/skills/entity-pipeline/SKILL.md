---
name: entity-pipeline
description: Debug and improve the entity extraction, deduplication, and spoiler-free pipeline. Use when entities are missing, duplicated, have wrong spoiler levels, or chunk boundary issues occur.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Entity Pipeline Debugger

## Pipeline Flow

Book → book_parser.py → gemini_extractor.py (LLM) → entity_synthesis_service.py → entity_deduplication_service.py → entity_service.py

## Known Issues

### 1. Chunk Boundary Entity Loss (CRITICAL)

- 100K char chunks with 15% overlap, entities lost at seams
- File: `services/gemini_extractor.py` (chunking logic)

### 2. Fuzzy Matching Threshold Too High

- 0.85 misses "Гарри" vs "Гарри Поттер"
- File: `services/entity_deduplication_service.py`

### 3. Spoiler Leak Risk

- `_apply_chapter_filter()` must NEVER leak future data
- File: `services/entity_service.py`
- Test: entity with mentions in ch 1,5,10 → reading ch 3 shows only ch 1+3

## Diagnostic SQL

```sql
-- Entity counts per book
SELECT book_id, COUNT(*) as entities FROM entities GROUP BY book_id;

-- Duplicates
SELECT book_id, name, COUNT(*) FROM entities GROUP BY book_id, name HAVING COUNT(*) > 1;

-- Mention coverage
SELECT e.name, COUNT(em.id) as mentions, MIN(em.chapter_number), MAX(em.chapter_number)
FROM entities e JOIN entity_mentions em ON e.id = em.entity_id
WHERE e.book_id = '<id>' GROUP BY e.name ORDER BY mentions DESC;
```

## Key Files

- `services/gemini_extractor.py` (1221 lines) — LLM extraction
- `services/entity_service.py` (680 lines) — Entity management
- `services/entity_deduplication_service.py` — Fuzzy + LLM dedup
- `services/entity_synthesis_service.py` — Multi-chunk synthesis
- `services/graph_service.py` — NetworkX graph
- `models/entity.py`, `entity_mention.py`, `entity_relationship.py`
