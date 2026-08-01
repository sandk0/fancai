"""Remove Modal feature flags after Modal pipeline removal

Удаление кода Modal (Волна 2 обновления стека) убрало USE_MODAL_PIPELINE и
USE_BATCH_MODE из DEFAULT_FEATURE_FLAGS, но FeatureFlagManager.initialize()
только добавляет недостающие записи и никогда не удаляет лишние. Без этой
миграции в уже развёрнутых БД остались бы мёртвые переключатели, видимые
в админке и через API, — включение которых ни на что не влияет.

Revision ID: c7d8e9f0a1b2
Revises: a1e2f3b4c5d6
Create Date: 2026-08-01 00:00:01.000000+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "c7d8e9f0a1b2"
down_revision: Union[str, None] = "a1e2f3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


REMOVED_FLAGS = ("USE_MODAL_PIPELINE", "USE_BATCH_MODE")


def upgrade() -> None:
    op.execute(
        sa.text("DELETE FROM feature_flags WHERE name IN :names").bindparams(
            sa.bindparam("names", value=REMOVED_FLAGS, expanding=True)
        )
    )
    # error_classifier стал провайдер-нейтральным: 'modal_error' был не
    # столько «ошибкой Modal», сколько бакетом «неизвестная ошибка».
    # Исторические строки переименовываются, иначе один и тот же класс
    # ошибок в chapters.error_type хранился бы под двумя именами.
    op.execute(
        sa.text(
            "UPDATE chapters SET error_type = 'provider_error' "
            "WHERE error_type = 'modal_error'"
        )
    )


def downgrade() -> None:
    # Возвращаем флаги выключенными: кода, который их читает, больше нет,
    # поэтому значение может быть только False.
    # id генерируем в SQL: в модели default=uuid4 задан на стороне Python,
    # server_default отсутствует, поэтому raw INSERT обязан подставить его сам.
    op.execute(sa.text("""
            INSERT INTO feature_flags (id, name, enabled, category, description, default_value)
            VALUES
                (gen_random_uuid(), 'USE_MODAL_PIPELINE', false, 'system',
                 'Использовать Modal self-hosted LLM + image gen вместо OpenRouter', false),
                (gen_random_uuid(), 'USE_BATCH_MODE', false, 'system',
                 'Batch обработка глав через Modal vLLM batch API (Phase 37)', false)
            ON CONFLICT (name) DO NOTHING
            """))
    op.execute(
        sa.text(
            "UPDATE chapters SET error_type = 'modal_error' "
            "WHERE error_type = 'provider_error'"
        )
    )
