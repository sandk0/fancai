"""Migrate entities_mentioned data to description_entities table

Revision ID: 2026_01_25_0003
Revises: 2026_01_25_0002
Create Date: 2026-01-25

"""
from alembic import op
import sqlalchemy as sa
import json
import uuid

revision = '2026_01_25_0003'
down_revision = '2026_01_25_0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    
    descriptions = conn.execute(
        sa.text("""
            SELECT d.id, d.entities_mentioned, c.book_id
            FROM descriptions d
            JOIN chapters c ON d.chapter_id = c.id
            WHERE d.entities_mentioned IS NOT NULL 
            AND d.entities_mentioned != ''
            AND d.entities_mentioned != '[]'
        """)
    ).fetchall()
    
    entities_cache = {}
    
    for desc_id, entities_mentioned, book_id in descriptions:
        entity_names = _parse_entities_mentioned(entities_mentioned)
        
        for entity_name in entity_names:
            if not entity_name or not entity_name.strip():
                continue
                
            entity_name_clean = entity_name.strip()
            cache_key = (book_id, entity_name_clean.lower())
            
            if cache_key not in entities_cache:
                result = conn.execute(
                    sa.text("""
                        SELECT id FROM entities 
                        WHERE book_id = :book_id AND LOWER(name) = :name
                        LIMIT 1
                    """),
                    {"book_id": book_id, "name": entity_name_clean.lower()}
                ).fetchone()
                
                entities_cache[cache_key] = result[0] if result else None
            
            entity_id = entities_cache[cache_key]
            
            if entity_id:
                try:
                    conn.execute(
                        sa.text("""
                            INSERT INTO description_entities (id, description_id, entity_id, confidence, mention_text, created_at)
                            VALUES (:id, :description_id, :entity_id, :confidence, :mention_text, NOW())
                            ON CONFLICT (description_id, entity_id) DO NOTHING
                        """),
                        {
                            "id": str(uuid.uuid4()),
                            "description_id": desc_id,
                            "entity_id": entity_id,
                            "confidence": 1.0,
                            "mention_text": entity_name_clean[:500],
                        }
                    )
                except Exception:
                    pass


def _parse_entities_mentioned(value):
    if not value:
        return []
    
    value = value.strip()
    
    if value.startswith('['):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                result = []
                for item in parsed:
                    if isinstance(item, str):
                        result.append(item)
                    elif isinstance(item, dict) and 'name' in item:
                        result.append(item['name'])
                return result
        except json.JSONDecodeError:
            pass
    
    if value.startswith('{'):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return list(parsed.keys())
        except json.JSONDecodeError:
            pass
    
    if ',' in value:
        return [v.strip() for v in value.split(',') if v.strip()]
    
    return [value] if value else []


def downgrade() -> None:
    op.execute("DELETE FROM description_entities")
