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
    op.execute("""
        DELETE FROM entities e1
        USING entities e2
        WHERE e1.book_id = e2.book_id
          AND lower(e1.name) = lower(e2.name)
          AND e1.id != e2.id
          AND (
              e1.importance < e2.importance
              OR (e1.importance = e2.importance AND e1.created_at > e2.created_at)
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
