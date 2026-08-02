"""Remove dead NLP feature flags left over after the NER and pgvector removals

USE_DESCRIPTION_CLASSIFIER, USE_HYBRID_PIPELINE и USE_PGVECTOR_EMBEDDINGS
пережили удаление NER-ветки (S4) и таблицы chapter_embeddings: читающего их
кода в репозитории нет, а включать им теперь нечего в принципе. Как и в
c7d8e9f0a1b2, FeatureFlagManager.initialize() умеет только добавлять
недостающие записи и никогда не удаляет лишние, поэтому без forward-миграции
в уже развёрнутых БД остались бы мёртвые переключатели, видимые в админке
и через API.

Revision ID: e5f6a7b8c9d0
Revises: d4a5b6c7e8f9
Create Date: 2026-08-04 00:00:01.000000+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "d4a5b6c7e8f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


REMOVED_FLAGS = (
    "USE_DESCRIPTION_CLASSIFIER",
    "USE_HYBRID_PIPELINE",
    "USE_PGVECTOR_EMBEDDINGS",
)


def upgrade() -> None:
    op.execute(
        sa.text("DELETE FROM feature_flags WHERE name IN :names").bindparams(
            sa.bindparam("names", value=REMOVED_FLAGS, expanding=True)
        )
    )


def downgrade() -> None:
    # Возвращаем флаги выключенными: кода, который их читает, больше нет,
    # поэтому значение может быть только False.
    # id генерируем в SQL: в модели default=uuid4 задан на стороне Python,
    # server_default отсутствует, поэтому raw INSERT обязан подставить его сам.
    op.execute(
        sa.text("""
            INSERT INTO feature_flags (id, name, enabled, category, description, default_value)
            VALUES
                (gen_random_uuid(), 'USE_DESCRIPTION_CLASSIFIER', false, 'nlp',
                 'Использовать TF-IDF/sentence-transformer для классификации описаний', false),
                (gen_random_uuid(), 'USE_HYBRID_PIPELINE', false, 'nlp',
                 'Активировать полный гибридный pipeline (NER + classifier + synthesis)', false),
                (gen_random_uuid(), 'USE_PGVECTOR_EMBEDDINGS', false, 'nlp',
                 'Использовать pgvector embeddings для контекстного обогащения при synthesis', false)
            ON CONFLICT (name) DO NOTHING
            """)
    )
