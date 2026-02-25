"""Revert descriptiontype enum values to lowercase

Revision ID: 2026_02_25_0001
Revises: 2026_02_24_0001
Create Date: 2026-02-25

Renames UPPERCASE enum values to lowercase to match StrEnum in Python code.
Uses conditional logic to handle the case where lowercase 'object' already
exists (added in 2026_01_21_0001).

RENAME VALUE is transactionally safe in PostgreSQL 10+ (unlike ADD VALUE).
"""
from alembic import op

revision = '2026_02_25_0001'
down_revision = '2026_02_24_0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use DO $$ block for conditional RENAME VALUE.
    # 'object' might already exist as lowercase from migration 2026_01_21_0001.
    # RENAME VALUE fails if the target label already exists, so we check first.
    op.execute("""
    DO $$
    BEGIN
        -- LOCATION -> location
        IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumtypid = 'descriptiontype'::regtype AND enumlabel = 'location'
        ) THEN
            ALTER TYPE descriptiontype RENAME VALUE 'LOCATION' TO 'location';
        END IF;

        -- CHARACTER -> character
        IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumtypid = 'descriptiontype'::regtype AND enumlabel = 'character'
        ) THEN
            ALTER TYPE descriptiontype RENAME VALUE 'CHARACTER' TO 'character';
        END IF;

        -- ATMOSPHERE -> atmosphere
        IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumtypid = 'descriptiontype'::regtype AND enumlabel = 'atmosphere'
        ) THEN
            ALTER TYPE descriptiontype RENAME VALUE 'ATMOSPHERE' TO 'atmosphere';
        END IF;

        -- OBJECT -> object (might already exist from 2026_01_21_0001)
        IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumtypid = 'descriptiontype'::regtype AND enumlabel = 'object'
        ) THEN
            ALTER TYPE descriptiontype RENAME VALUE 'OBJECT' TO 'object';
        END IF;

        -- ACTION -> action
        IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumtypid = 'descriptiontype'::regtype AND enumlabel = 'action'
        ) THEN
            ALTER TYPE descriptiontype RENAME VALUE 'ACTION' TO 'action';
        END IF;
    END $$;
    """)

    # Update any rows that still have UPPERCASE values (e.g., 'OBJECT' rows
    # when lowercase 'object' was already added but rows weren't migrated).
    # Split into individual statements for asyncpg compatibility.
    op.execute("UPDATE descriptions SET type = 'location' WHERE type = 'LOCATION'")
    op.execute("UPDATE descriptions SET type = 'character' WHERE type = 'CHARACTER'")
    op.execute("UPDATE descriptions SET type = 'atmosphere' WHERE type = 'ATMOSPHERE'")
    op.execute("UPDATE descriptions SET type = 'object' WHERE type = 'OBJECT'")
    op.execute("UPDATE descriptions SET type = 'action' WHERE type = 'ACTION'")


def downgrade() -> None:
    op.execute("""
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumtypid = 'descriptiontype'::regtype AND enumlabel = 'LOCATION'
        ) THEN
            ALTER TYPE descriptiontype RENAME VALUE 'location' TO 'LOCATION';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumtypid = 'descriptiontype'::regtype AND enumlabel = 'CHARACTER'
        ) THEN
            ALTER TYPE descriptiontype RENAME VALUE 'character' TO 'CHARACTER';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumtypid = 'descriptiontype'::regtype AND enumlabel = 'ATMOSPHERE'
        ) THEN
            ALTER TYPE descriptiontype RENAME VALUE 'atmosphere' TO 'ATMOSPHERE';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumtypid = 'descriptiontype'::regtype AND enumlabel = 'OBJECT'
        ) THEN
            ALTER TYPE descriptiontype RENAME VALUE 'object' TO 'OBJECT';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM pg_enum
            WHERE enumtypid = 'descriptiontype'::regtype AND enumlabel = 'ACTION'
        ) THEN
            ALTER TYPE descriptiontype RENAME VALUE 'action' TO 'ACTION';
        END IF;
    END $$;
    """)

    # Split into individual statements for asyncpg compatibility.
    op.execute("UPDATE descriptions SET type = 'LOCATION' WHERE type = 'location'")
    op.execute("UPDATE descriptions SET type = 'CHARACTER' WHERE type = 'character'")
    op.execute("UPDATE descriptions SET type = 'ATMOSPHERE' WHERE type = 'atmosphere'")
    op.execute("UPDATE descriptions SET type = 'OBJECT' WHERE type = 'object'")
    op.execute("UPDATE descriptions SET type = 'ACTION' WHERE type = 'action'")
