"""Add UNIQUE constraint on entities(book_id, lower(name))

Prevents duplicate entity names within the same book.
Handles existing duplicates by keeping the one with highest importance.

Revision ID: add_unique_entity_name
Revises: drop_entities_mentioned
Create Date: 2026-01-25 19:30:00

"""
from alembic import op


revision = 'add_unique_entity_name'
down_revision = 'drop_entities_mentioned'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Step 1: Remove duplicates keeping entity with highest importance
    # Uses ROW_NUMBER to guarantee exactly one winner per (book_id, lower(name)) group
    # Priority: highest importance → earliest created_at → lowest id (tiebreaker)
    op.execute("""
        DELETE FROM entities
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY book_id, lower(name)
                           ORDER BY importance DESC, created_at ASC, id ASC
                       ) as rn
                FROM entities
            ) ranked
            WHERE rn > 1
        );
    """)
    
    # Step 2: Create unique index (idempotent)
    op.execute("""
        DO $$ BEGIN
            CREATE UNIQUE INDEX IF NOT EXISTS ix_entities_book_id_name_lower
            ON entities (book_id, lower(name));
        END $$;
    """)


def downgrade() -> None:
    op.execute("""
        DROP INDEX IF EXISTS ix_entities_book_id_name_lower;
    """)
