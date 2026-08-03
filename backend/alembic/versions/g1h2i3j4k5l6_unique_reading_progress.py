"""unique reading_progress per (user_id, book_id)

Дефект, который закрывает миграция: у `reading_progress` не было
уникального ограничения на пару «пользователь + книга», а сервис писал
прогресс через read-then-insert. Читалка сохраняет позицию пачками,
поэтому два одновременных запроса оба не находили строку и оба вставляли
свою. Дубль оставался в БД навсегда, а `scalar_one_or_none()` —
и в `BookProgressService.update_reading_progress`, и в
`GET /books/{book_id}/progress` — начинал падать «Multiple rows were found
when one or none was required». Прогресс книги ломался безвозвратно,
включая невозможность его прочитать.

Найдено живым прогоном e2e 2026-08-05.

Upgrade схлопывает существующие дубли в одну строку и ставит ограничение.
Победителем выбирается строка с максимальным `last_read_at`, при равенстве —
с максимальным `current_position`: это самый свежий и самый дальний прогресс,
терять его нельзя. `max_chapter_reached` берётся максимальным по всей группе —
поле монотонное и держит спойлерный гейт, занижать его нельзя даже ради
свежести.

Revision ID: g1h2i3j4k5l6
Revises: e5f6a7b8c9d0
Create Date: 2026-08-05
"""

from alembic import op
import sqlalchemy as sa

revision = "g1h2i3j4k5l6"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None

CONSTRAINT = "uq_reading_progress_user_book"


def upgrade() -> None:
    # 1. Поднимаем max_chapter_reached победителя до максимума по группе:
    #    поле монотонное, от него зависит спойлерный гейт глоссария.
    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                user_id,
                book_id,
                MAX(COALESCE(max_chapter_reached, 1)) OVER (
                    PARTITION BY user_id, book_id
                ) AS group_max_chapter,
                ROW_NUMBER() OVER (
                    PARTITION BY user_id, book_id
                    ORDER BY last_read_at DESC NULLS LAST,
                             current_position DESC NULLS LAST,
                             id
                ) AS rn
            FROM reading_progress
        )
        UPDATE reading_progress rp
        SET max_chapter_reached = ranked.group_max_chapter
        FROM ranked
        WHERE rp.id = ranked.id AND ranked.rn = 1
        """
    )

    # 2. Удаляем проигравшие дубли.
    op.execute(
        """
        DELETE FROM reading_progress
        WHERE id IN (
            SELECT id FROM (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY user_id, book_id
                        ORDER BY last_read_at DESC NULLS LAST,
                                 current_position DESC NULLS LAST,
                                 id
                    ) AS rn
                FROM reading_progress
            ) dups
            WHERE rn > 1
        )
        """
    )

    # 3. Ставим ограничение, ради которого всё затевалось.
    op.create_unique_constraint(
        CONSTRAINT, "reading_progress", ["user_id", "book_id"]
    )


def downgrade() -> None:
    # Схлопнутые дубли не восстанавливаются — они и были повреждением.
    op.drop_constraint(CONSTRAINT, "reading_progress", type_="unique")


# Явная ссылка, чтобы линтеры не считали sa неиспользуемым импортом
_ = sa
