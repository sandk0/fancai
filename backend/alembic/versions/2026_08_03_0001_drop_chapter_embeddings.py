"""drop chapter_embeddings and the GLiNER feature flag

Ветка GLiNER2 удалена целиком (решение S4): `NERService`, её вызовы в
`book_tasks`, метрики и модель `ChapterEmbedding`. Таблица `chapter_embeddings`
пуста и в dev, и в проде — эмбеддинги никогда не писались, флаг
`USE_GLINER_NER` никогда не включался.

Почему отдельная forward-миграция, а не откат `c3f7a2b8d901`: её `downgrade()`
делает `DROP EXTENSION IF EXISTS vector` и снимает колонки `extraction_source`
и `pipeline_version` с `entities`/`descriptions`. Колонки остаются в работе,
а расширение — общий ресурс базы. Здесь удаляется ровно то, что стало мёртвым.

`FeatureFlagManager.initialize()` только добавляет недостающие записи и никогда
не удаляет лишние, поэтому строку `USE_GLINER_NER` из `feature_flags` убирает
миграция — иначе мёртвый переключатель остался бы видимым в админке и в API.

Комментарии к `extraction_source` и `pipeline_version` ссылались на GLiNER2 и
на OpenRouter как на единственного LLM-провайдера. Приводятся к коду: иначе
`alembic revision --autogenerate` показывал бы вечный дифф по комментариям.

Revision ID: d4a5b6c7e8f9
Revises: c7d8e9f0a1b2
Create Date: 2026-08-03 00:00:01.000000+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

# revision identifiers, used by Alembic.
revision: str = "d4a5b6c7e8f9"
down_revision: Union[str, None] = "c7d8e9f0a1b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


EXTRACTION_SOURCE_COMMENT = "Extraction source; the current pipeline writes only 'llm'"
PIPELINE_VERSION_COMMENT = (
    "Pipeline version tag; the current LLM pipeline leaves it null"
)

OLD_EXTRACTION_SOURCE_COMMENT = (
    "Source: 'llm'=OpenRouter LLM, 'gliner'=local GLiNER2, 'hybrid'=combined"
)
OLD_PIPELINE_VERSION_COMMENT = (
    "Pipeline version: null=legacy LLM, 'hybrid_v1'=GLiNER2+classifier"
)


def upgrade() -> None:
    # Индексы и unique-constraint уезжают вместе с таблицей.
    op.drop_table("chapter_embeddings")

    op.execute(
        sa.text("DELETE FROM feature_flags WHERE name = :name").bindparams(
            sa.bindparam("name", value="USE_GLINER_NER")
        )
    )

    for table in ("entities", "descriptions"):
        op.alter_column(
            table,
            "extraction_source",
            existing_type=sa.String(20),
            existing_nullable=False,
            existing_server_default="llm",
            comment=EXTRACTION_SOURCE_COMMENT,
            existing_comment=OLD_EXTRACTION_SOURCE_COMMENT,
        )
        op.alter_column(
            table,
            "pipeline_version",
            existing_type=sa.String(50),
            existing_nullable=True,
            comment=PIPELINE_VERSION_COMMENT,
            existing_comment=OLD_PIPELINE_VERSION_COMMENT,
        )


def downgrade() -> None:
    for table in ("entities", "descriptions"):
        op.alter_column(
            table,
            "extraction_source",
            existing_type=sa.String(20),
            existing_nullable=False,
            existing_server_default="llm",
            comment=OLD_EXTRACTION_SOURCE_COMMENT,
            existing_comment=EXTRACTION_SOURCE_COMMENT,
        )
        op.alter_column(
            table,
            "pipeline_version",
            existing_type=sa.String(50),
            existing_nullable=True,
            comment=OLD_PIPELINE_VERSION_COMMENT,
            existing_comment=PIPELINE_VERSION_COMMENT,
        )

    # Флаг возвращается выключенным: кода, который его читает, больше нет.
    # id генерируется в SQL — в модели default=uuid4 задан на стороне Python.
    op.execute(sa.text("""
            INSERT INTO feature_flags
                (id, name, enabled, category, description, default_value)
            VALUES
                (gen_random_uuid(), 'USE_GLINER_NER', false, 'nlp',
                 'Использовать GLiNER2 для локальной entity extraction вместо LLM',
                 false)
            ON CONFLICT (name) DO NOTHING
            """))

    # Расширение vector создано миграцией c3f7a2b8d901 и здесь не трогается.
    op.create_table(
        "chapter_embeddings",
        sa.Column(
            "id",
            sa.UUID(),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "chapter_id",
            sa.UUID(),
            sa.ForeignKey("chapters.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("chunk_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("chunk_text", sa.Text(), nullable=False),
        sa.Column("embedding", Vector(384), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "chapter_id", "chunk_index", name="uq_chapter_embeddings_chapter_chunk"
        ),
    )
    op.create_index(
        "ix_chapter_embeddings_embedding_hnsw",
        "chapter_embeddings",
        ["embedding"],
        postgresql_using="hnsw",
        postgresql_with={"m": 16, "ef_construction": 64},
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )
