"""Add entity_type ENUM and performance indexes

Revision ID: 2026_01_25_0004
Revises: 2026_01_25_0003
Create Date: 2026-01-25
"""
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM

revision = '2026_01_25_0004'
down_revision = '2026_01_25_0003'
branch_labels = None
depends_on = None

entity_type_enum = ENUM('character', 'location', 'object', name='entitytype', create_type=False)


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE entitytype AS ENUM ('character', 'location', 'object');
        EXCEPTION
            WHEN duplicate_object THEN null;
        END $$;
    """)
    
    op.execute("""
        UPDATE entities 
        SET type = LOWER(type) 
        WHERE type IS NOT NULL AND type != LOWER(type)
    """)
    
    op.execute("""
        DO $$ BEGIN
            ALTER TABLE entities 
            ALTER COLUMN type TYPE entitytype 
            USING type::entitytype;
        EXCEPTION
            WHEN others THEN null;
        END $$;
    """)
    
    op.create_index(
        'ix_entity_mentions_entity_id_chapter_id',
        'entity_mentions',
        ['entity_id', 'chapter_id'],
        unique=False
    )
    
    op.create_index(
        'ix_description_entities_description_id',
        'description_entities',
        ['description_id'],
        unique=False
    )
    
    op.create_index(
        'ix_description_entities_entity_id',
        'description_entities',
        ['entity_id'],
        unique=False
    )
    
    op.create_index(
        'ix_entities_book_id_type',
        'entities',
        ['book_id', 'type'],
        unique=False
    )
    
    op.create_index(
        'ix_entities_book_id_importance',
        'entities',
        ['book_id', 'importance'],
        unique=False
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_entities_book_id_importance")
    op.execute("DROP INDEX IF EXISTS ix_entities_book_id_type")
    op.execute("DROP INDEX IF EXISTS ix_description_entities_entity_id")
    op.execute("DROP INDEX IF EXISTS ix_description_entities_description_id")
    op.execute("DROP INDEX IF EXISTS ix_entity_mentions_entity_id_chapter_id")
    
    op.execute("""
        DO $$ BEGIN
            ALTER TABLE entities 
            ALTER COLUMN type TYPE VARCHAR(50) 
            USING type::text;
        EXCEPTION
            WHEN others THEN null;
        END $$;
    """)
    
    op.execute("DROP TYPE IF EXISTS entitytype")
