"""Add name_lower column to entities for locale-independent case-insensitive matching.

Replaces the broken functional index ix_entities_book_id_name_lower (which used
PostgreSQL lower() that only handles ASCII under locale C) with a stored column
name_lower populated by Python str.casefold().

Revision ID: 2026_02_25_0002
Revises: 2026_02_25_0001
Create Date: 2026-02-25

"""
from alembic import op
import sqlalchemy as sa


revision = '2026_02_25_0002'
down_revision = '2026_02_25_0001'
branch_labels = None
depends_on = None

# Batch size for Python-based backfill (avoid locking entire table)
BACKFILL_BATCH_SIZE = 1000


def upgrade() -> None:
    # Step 1: Add name_lower column (nullable initially to not break existing rows)
    op.add_column('entities', sa.Column(
        'name_lower', sa.String(255), nullable=True,
        comment='Casefolded name for locale-independent case-insensitive matching'
    ))

    # Step 2: Backfill name_lower using Python casefold() via op.get_bind()
    # CRITICAL: We cannot use PostgreSQL lower() because under locale C it is
    # ASCII-only — Cyrillic characters are returned unchanged.
    # Python str.casefold() is locale-independent and handles all Unicode correctly.
    conn = op.get_bind()
    total_updated = 0
    while True:
        # Fetch a batch of rows that still need backfill
        result = conn.execute(
            sa.text(
                "SELECT id, name FROM entities "
                "WHERE name_lower IS NULL "
                "LIMIT :batch_size"
            ),
            {"batch_size": BACKFILL_BATCH_SIZE},
        )
        rows = result.fetchall()
        if not rows:
            break
        for row in rows:
            casefolded = (row.name or "").casefold()[:255]  # truncation guard
            conn.execute(
                sa.text("UPDATE entities SET name_lower = :nl WHERE id = :id"),
                {"nl": casefolded, "id": row.id},
            )
        total_updated += len(rows)
    print(f"    [name_lower backfill] Updated {total_updated} rows with Python casefold()")

    # Step 3: Set NOT NULL
    op.alter_column('entities', 'name_lower', nullable=False)

    # Step 4: Handle potential duplicates that may arise from casefolding
    # Two entities that differ only in case (e.g. "ГАРРИ" and "Гарри") now have
    # the same name_lower ("гарри") and would collide on the unique index.
    # Keep the one with highest importance; ties broken by created_at then id.
    # NOTE: CASCADE on FK (entity_mentions, description_entities, etc.) will
    # automatically clean up dependent rows.
    dup_count_result = conn.execute(sa.text("""
        SELECT count(*) FROM (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY book_id, name_lower
                ORDER BY importance DESC NULLS LAST, created_at ASC, id ASC
            ) as rn
            FROM entities
        ) ranked
        WHERE rn > 1
    """))
    dup_count = dup_count_result.scalar()
    if dup_count and dup_count > 0:
        print(f"    [name_lower dedup] Found {dup_count} duplicate entities to remove (CASCADE)")
    op.execute("""
        DELETE FROM entities
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY book_id, name_lower
                           ORDER BY importance DESC NULLS LAST, created_at ASC, id ASC
                       ) as rn
                FROM entities
            ) ranked
            WHERE rn > 1
        );
    """)
    if dup_count and dup_count > 0:
        print(f"    [name_lower dedup] Removed {dup_count} duplicate entities")

    # Step 5: Create new unique index on (book_id, name_lower)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ix_entities_book_id_name_lower_v2
        ON entities (book_id, name_lower)
    """)

    # Step 6: Drop old functional index
    op.execute("DROP INDEX IF EXISTS ix_entities_book_id_name_lower")


def downgrade() -> None:
    # Restore old functional index
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ix_entities_book_id_name_lower
        ON entities (book_id, lower(name))
    """)

    # Drop new index
    op.execute("DROP INDEX IF EXISTS ix_entities_book_id_name_lower_v2")

    # Drop column
    op.drop_column('entities', 'name_lower')
