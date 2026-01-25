"""Drop entities_mentioned column from descriptions table

This column is now replaced by the description_entities M:N table.
Data was migrated in migration 2026_01_25_0003.

Revision ID: drop_entities_mentioned
Revises: add_entity_type_enum
Create Date: 2026-01-25 17:00:00

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'drop_entities_mentioned'
down_revision = 'add_entity_type_enum'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Drop the legacy entities_mentioned column."""
    # Drop column if exists (idempotent)
    op.execute("""
        DO $$ BEGIN
            ALTER TABLE descriptions DROP COLUMN IF EXISTS entities_mentioned;
        END $$;
    """)


def downgrade() -> None:
    """Restore the entities_mentioned column."""
    # Add column back if it doesn't exist (idempotent)
    op.execute("""
        DO $$ BEGIN
            ALTER TABLE descriptions ADD COLUMN entities_mentioned TEXT;
        EXCEPTION
            WHEN duplicate_column THEN null;
        END $$;
    """)
