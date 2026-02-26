"""Fix entity chapter indexing: migrate 0-indexed to 1-indexed data.

Background
----------
book_tasks.py used `enumerate(chapters)` which produces idx=0,1,2,...
while Chapter.chapter_number in DB is stored as 1,2,3,...

This caused four fields to be stored with 0-indexed chapter numbers:
  1. entities.first_mention_chapter       (scalar int)
  2. entity_events.chapter_number         (scalar int)
  3. entities.aliases_with_reveal         (JSONB array, field "reveal_chapter")
  4. entities.visual_summary              (text, [Глава N] markers)

This migration increments all four by 1 to restore 1-indexed consistency.

Revision ID: 2026_02_26_0001
Revises: 2026_02_25_0002
Create Date: 2026-02-26
"""
import re
import json
from alembic import op
import sqlalchemy as sa


revision = "2026_02_26_0001"
down_revision = "2026_02_25_0002"
branch_labels = None
depends_on = None

BATCH_SIZE = 500


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fix_aliases_with_reveal(aliases: list, delta: int) -> list:
    """Increment (or decrement) reveal_chapter in each alias by delta."""
    result = []
    for alias in aliases:
        if not isinstance(alias, dict):
            result.append(alias)
            continue
        reveal_ch = alias.get("reveal_chapter")
        if reveal_ch is not None:
            alias = dict(alias)
            alias["reveal_chapter"] = reveal_ch + delta
        result.append(alias)
    return result


def _fix_visual_summary(text: str, delta: int) -> str:
    """Increment (or decrement) chapter numbers in [Глава N] markers by delta."""
    def replace_chapter(m):
        n = int(m.group(1))
        return f"[Глава {n + delta}]"
    return re.sub(r"\[Глава (\d+)\]", replace_chapter, text)


# ---------------------------------------------------------------------------
# upgrade / downgrade
# ---------------------------------------------------------------------------

def upgrade() -> None:
    _run_migration(delta=+1)


def downgrade() -> None:
    _run_migration(delta=-1)


def _run_migration(delta: int) -> None:
    direction = "upgrade (+1)" if delta > 0 else "downgrade (-1)"
    conn = op.get_bind()

    # 1. entities.first_mention_chapter
    result = conn.execute(sa.text(
        "UPDATE entities "
        "SET first_mention_chapter = first_mention_chapter + :delta "
        "WHERE first_mention_chapter IS NOT NULL"
    ), {"delta": delta})
    print(f"  [entity chapter indexing {direction}] "
          f"first_mention_chapter: {result.rowcount} rows updated")

    # 2. entity_events.chapter_number
    result = conn.execute(sa.text(
        "UPDATE entity_events SET chapter_number = chapter_number + :delta"
    ), {"delta": delta})
    print(f"  [entity chapter indexing {direction}] "
          f"entity_events.chapter_number: {result.rowcount} rows updated")

    # 3. entities.aliases_with_reveal (JSONB, Python backfill)
    # Plain SQL cannot do arithmetic inside JSONB array elements,
    # so we fetch and patch in Python batches.
    aliases_updated = 0
    aliases_skipped = 0
    last_id = "00000000-0000-0000-0000-000000000000"
    while True:
        rows = conn.execute(sa.text(
            "SELECT id, aliases_with_reveal FROM entities "
            "WHERE id > :last_id "
            "AND aliases_with_reveal IS NOT NULL "
            "AND jsonb_array_length(aliases_with_reveal) > 0 "
            "ORDER BY id LIMIT :batch"
        ), {"last_id": last_id, "batch": BATCH_SIZE}).fetchall()

        if not rows:
            break

        for row in rows:
            aliases = row.aliases_with_reveal
            if not isinstance(aliases, list):
                try:
                    aliases = json.loads(aliases)
                except Exception:
                    aliases_skipped += 1
                    last_id = str(row.id)
                    continue

            fixed = _fix_aliases_with_reveal(aliases, delta)
            conn.execute(sa.text(
                "UPDATE entities SET aliases_with_reveal = CAST(:val AS jsonb) WHERE id = :id"
            ), {"val": json.dumps(fixed, ensure_ascii=False), "id": row.id})
            aliases_updated += 1

        last_id = str(rows[-1].id)

    print(f"  [entity chapter indexing {direction}] "
          f"aliases_with_reveal: {aliases_updated} rows updated, "
          f"{aliases_skipped} skipped (invalid JSON)")

    # 4. entities.visual_summary ([Глава N] markers, Python backfill)
    summary_updated = 0
    last_id = "00000000-0000-0000-0000-000000000000"
    while True:
        rows = conn.execute(sa.text(
            "SELECT id, visual_summary FROM entities "
            "WHERE id > :last_id "
            "AND visual_summary LIKE '%[Глава %' "
            "ORDER BY id LIMIT :batch"
        ), {"last_id": last_id, "batch": BATCH_SIZE}).fetchall()

        if not rows:
            break

        for row in rows:
            if not row.visual_summary:
                last_id = str(row.id)
                continue
            fixed = _fix_visual_summary(row.visual_summary, delta)
            if fixed != row.visual_summary:
                conn.execute(sa.text(
                    "UPDATE entities SET visual_summary = :val WHERE id = :id"
                ), {"val": fixed, "id": row.id})
                summary_updated += 1

        last_id = str(rows[-1].id)

    print(f"  [entity chapter indexing {direction}] "
          f"visual_summary markers: {summary_updated} rows updated")
