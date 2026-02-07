# Entity Wiki + Description Pipeline — План реализации

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Цель:** Реализовать интерактивную энциклопедию книги (milestones, events, roles, recap) и улучшить description pipeline (type-based подсветка, точность, peek).

**Архитектура:** Двухфазный LLM pipeline: Phase 1 — per-chapter extraction (events, context, is_focus), Phase 2 — post-book synthesis (milestones, roles, relationship evolution). RAW-кэш с on-the-fly фильтрацией по главе. Фронтенд: position-aware strategies, type-based highlighting, entity name highlighting.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic | React 19 + TypeScript 5.7 + TanStack Query | Gemini 3.0 Flash | PostgreSQL + Redis

**Дизайн-документ:** `docs/plans/2026-02-06-entity-wiki-design.md`

---

## Фаза 1: Backend — Модели и миграции ✅ ЗАВЕРШЕНА

> **Коммит:** `cf5d08d` feat(models): add EntityEvent model, biography milestones, relationship evolution, is_focus
> **Что сделано:** EntityEvent модель, biography_milestones + base_role в Entity, relationship_milestones в EntityRelationship, is_focus в DescriptionEntity, 2 миграции.
> **Отклонения от плана:** Tasks 2-4 объединены в одну миграцию `2026_02_07_0002` для атомарности. Тесты будут запущены при развёртывании (нет локального venv).

### Task 1: Модель EntityEvent + миграция

**Файлы:**
- Создать: `backend/app/models/entity_event.py`
- Изменить: `backend/app/models/__init__.py`
- Создать: `backend/alembic/versions/2026_02_07_0001_add_entity_events_table.py`
- Тест: `backend/tests/models/test_entity_event.py`

**Шаг 1: Создать модель EntityEvent**

```python
# backend/app/models/entity_event.py
from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID
import uuid as uuid_module

from sqlalchemy import Text, Integer, ForeignKey, DateTime, Index
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func

from ..core.database import Base

if TYPE_CHECKING:
    from .entity import Entity
    from .chapter import Chapter


class EntityEvent(Base):
    __tablename__ = "entity_events"
    __table_args__ = (
        Index("idx_entity_events_entity_chapter", "entity_id", "chapter_number"),
    )

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid_module.uuid4
    )
    entity_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chapter_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("chapters.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    chapter_number: Mapped[int] = mapped_column(Integer, nullable=False)
    event_action: Mapped[str] = mapped_column(Text, nullable=False)
    event_inner_state: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    entity: Mapped["Entity"] = relationship("Entity", back_populates="events", lazy="raise")
    chapter: Mapped["Chapter"] = relationship("Chapter", lazy="raise")
```

**Шаг 2: Добавить relationship в Entity модель**

В `backend/app/models/entity.py` добавить import и relationship:

```python
# В TYPE_CHECKING секцию:
from .entity_event import EntityEvent

# После incoming_relations relationship:
events: Mapped[list["EntityEvent"]] = relationship(
    "EntityEvent",
    back_populates="entity",
    cascade="all, delete-orphan",
    lazy="raise",
)
```

**Шаг 3: Зарегистрировать в `__init__.py`**

В `backend/app/models/__init__.py` добавить:
```python
from .entity_event import EntityEvent
```

И включить `EntityEvent` в `__all__` (если есть).

**Шаг 4: Создать миграцию**

```bash
cd backend && alembic revision --autogenerate -m "add entity_events table"
```

Проверить сгенерированную миграцию: таблица `entity_events`, индексы, FK constraints.

**Шаг 5: Применить миграцию**

```bash
cd backend && alembic upgrade head
```

**Шаг 6: Коммит**

```bash
git add backend/app/models/entity_event.py backend/app/models/__init__.py backend/app/models/entity.py backend/alembic/versions/
git commit -m "feat(models): add EntityEvent model for chapter-level entity tracking"
```

---

### Task 2: Новые поля Entity (biography_milestones, base_role)

**Файлы:**
- Изменить: `backend/app/models/entity.py`
- Создать: миграция через autogenerate

**Шаг 1: Добавить поля в Entity модель**

В `backend/app/models/entity.py` после `first_mention_cfi`:

```python
biography_milestones: Mapped[list[dict] | None] = mapped_column(
    JSONB, nullable=True
)

base_role: Mapped[str | None] = mapped_column(
    String(50), nullable=True, index=True
)
```

**Шаг 2: Создать и применить миграцию**

```bash
cd backend && alembic revision --autogenerate -m "add biography_milestones and base_role to entity"
cd backend && alembic upgrade head
```

**Шаг 3: Коммит**

```bash
git add backend/app/models/entity.py backend/alembic/versions/
git commit -m "feat(models): add biography_milestones JSONB and base_role to Entity"
```

---

### Task 3: Relationship evolution (relationship_milestones)

**Файлы:**
- Изменить: `backend/app/models/entity_relationship.py`
- Создать: миграция

**Шаг 1: Добавить поле**

В `backend/app/models/entity_relationship.py` после `relationship_metadata`:

```python
relationship_milestones: Mapped[list[dict] | None] = mapped_column(
    JSONB, nullable=True
)
```

**Шаг 2: Создать и применить миграцию**

```bash
cd backend && alembic revision --autogenerate -m "add relationship_milestones to entity_relationship"
cd backend && alembic upgrade head
```

**Шаг 3: Коммит**

```bash
git add backend/app/models/entity_relationship.py backend/alembic/versions/
git commit -m "feat(models): add relationship_milestones JSONB to EntityRelationship"
```

---

### Task 4: DescriptionEntity.is_focus

**Файлы:**
- Изменить: `backend/app/models/description_entity.py`
- Создать: миграция

**Шаг 1: Добавить поле**

В `backend/app/models/description_entity.py` после `mention_text`:

```python
from sqlalchemy import Boolean
# ...
is_focus: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
```

**Шаг 2: Создать и применить миграцию**

```bash
cd backend && alembic revision --autogenerate -m "add is_focus to description_entity"
cd backend && alembic upgrade head
```

**Шаг 3: Коммит**

```bash
git add backend/app/models/description_entity.py backend/alembic/versions/
git commit -m "feat(models): add is_focus to DescriptionEntity for gallery filtering"
```

---

## Фаза 2: Backend — Сервисы и API

### Task 5: Исправить кэширование (RAW cache + фильтрация)

**Файлы:**
- Изменить: `backend/app/services/entity_service.py`
- Тест: `backend/tests/services/test_entity_service.py`

**Шаг 1: Написать тест на фильтрацию по главе**

В `backend/tests/services/test_entity_service.py` добавить:

```python
class TestChapterFiltering:
    """Тесты RAW cache + on-the-fly фильтрации."""

    def test_filter_milestones_by_chapter(self):
        """Возвращает milestone до текущей главы."""
        milestones = [
            {"up_to_chapter": 1, "biography": "Студент", "dynamic_role": "Студент", "importance": 5},
            {"up_to_chapter": 5, "biography": "Убийца", "dynamic_role": "Убийца", "importance": 9},
            {"up_to_chapter": 10, "biography": "Каторжник", "dynamic_role": "Каторжник", "importance": 8},
        ]
        result = EntityService._get_current_milestone(milestones, current_chapter=5)
        assert result["biography"] == "Убийца"
        assert result["dynamic_role"] == "Убийца"

    def test_filter_milestones_between_chapters(self):
        """Если нет milestone на текущей главе — берём последний до неё."""
        milestones = [
            {"up_to_chapter": 1, "biography": "Студент"},
            {"up_to_chapter": 10, "biography": "Убийца"},
        ]
        result = EntityService._get_current_milestone(milestones, current_chapter=7)
        assert result["biography"] == "Студент"

    def test_filter_milestones_no_milestones(self):
        """Без milestones возвращает None."""
        result = EntityService._get_current_milestone(None, current_chapter=5)
        assert result is None

    def test_filter_events_by_chapter(self):
        """События фильтруются по chapter_number."""
        events = [
            {"chapter_number": 1, "action": "Появляется"},
            {"chapter_number": 5, "action": "Убивает"},
            {"chapter_number": 10, "action": "Арестован"},
        ]
        result = EntityService._filter_events_by_chapter(events, current_chapter=5)
        assert len(result) == 2
        assert result[-1]["action"] == "Убивает"

    def test_filter_relationship_milestones(self):
        """Тип связи актуальный для текущей главы."""
        milestones = [
            {"up_to_chapter": 3, "type": "ENEMY", "weight": -60},
            {"up_to_chapter": 10, "type": "ALLY", "weight": 70},
        ]
        result = EntityService._get_current_relationship_milestone(milestones, current_chapter=5)
        assert result["type"] == "ENEMY"
```

**Шаг 2: Запустить тест — убедиться что падает**

```bash
cd backend && pytest tests/services/test_entity_service.py::TestChapterFiltering -v
```

**Шаг 3: Реализовать статические методы фильтрации**

В `backend/app/services/entity_service.py` добавить:

```python
@staticmethod
def _get_current_milestone(
    milestones: list[dict] | None, current_chapter: int
) -> dict | None:
    if not milestones:
        return None
    valid = [m for m in milestones if m.get("up_to_chapter", 0) <= current_chapter]
    if not valid:
        return None
    return max(valid, key=lambda m: m["up_to_chapter"])

@staticmethod
def _filter_events_by_chapter(
    events: list[dict], current_chapter: int
) -> list[dict]:
    return [e for e in events if e.get("chapter_number", 0) <= current_chapter]

@staticmethod
def _get_current_relationship_milestone(
    milestones: list[dict] | None, current_chapter: int
) -> dict | None:
    if not milestones:
        return None
    valid = [m for m in milestones if m.get("up_to_chapter", 0) <= current_chapter]
    if not valid:
        return None
    return max(valid, key=lambda m: m["up_to_chapter"])
```

**Шаг 4: Обновить кэш-ключ и логику**

В `get_book_entity_network()` изменить:
- cache_key: `f"book:{book_id}:entity_network_raw_v4"` (без current_chapter)
- Кэшировать RAW данные ДО фильтрации
- Применить `_get_current_milestone()`, `_filter_events_by_chapter()` после загрузки из кэша

**Шаг 5: Запустить тесты**

```bash
cd backend && pytest tests/services/test_entity_service.py -v
```

**Шаг 6: Коммит**

```bash
git commit -m "fix(cache): RAW cache + on-the-fly chapter filtering for milestones"
```

---

### Task 6: Event dedup в ConsistencyManager

**Файлы:**
- Изменить: `backend/app/services/consistency_manager.py`
- Тест: `backend/tests/services/test_event_dedup.py`

**Шаг 1: Написать тест**

```python
# backend/tests/services/test_event_dedup.py
from backend.app.services.consistency_manager import ConsistencyManager

class TestEventDedup:
    def test_dedup_similar_events(self):
        """Похожие events (>0.8) дедуплицируются, остаётся длинный."""
        events = [
            {"action": "Гарри получает письмо", "inner": None},
            {"action": "Гарри получает письмо из Хогвартса", "inner": None},
        ]
        result = ConsistencyManager._deduplicate_events(events)
        assert len(result) == 1
        assert "Хогвартса" in result[0]["action"]

    def test_keep_different_events(self):
        """Разные events сохраняются."""
        events = [
            {"action": "Гарри получает письмо", "inner": None},
            {"action": "Гарри летит на метле", "inner": None},
        ]
        result = ConsistencyManager._deduplicate_events(events)
        assert len(result) == 2
```

**Шаг 2: Реализовать**

```python
@staticmethod
def _deduplicate_events(events: list[dict]) -> list[dict]:
    from difflib import SequenceMatcher
    if len(events) <= 1:
        return events
    result = []
    used = set()
    for i, ev_a in enumerate(events):
        if i in used:
            continue
        best = ev_a
        for j, ev_b in enumerate(events[i + 1:], start=i + 1):
            if j in used:
                continue
            ratio = SequenceMatcher(
                None, ev_a["action"], ev_b["action"]
            ).ratio()
            if ratio > 0.8:
                used.add(j)
                if len(ev_b["action"]) > len(best["action"]):
                    best = ev_b
        result.append(best)
    return result
```

**Шаг 3: Тесты + коммит**

```bash
cd backend && pytest tests/services/test_event_dedup.py -v
git commit -m "feat(dedup): add event deduplication in ConsistencyManager (SequenceMatcher >0.8)"
```

---

### Task 7: Расширение extraction prompt (Phase 1)

**Файлы:**
- Изменить: `backend/app/services/gemini_extractor.py`
- Тест: `backend/tests/services/test_gemini_extractor.py`

**Шаг 1: Добавить поля в GeminiEntitySchema**

В `gemini_extractor.py`, класс `GeminiEntitySchema`:

```python
chapter_event_action: str | None = None
chapter_event_inner: str | None = None
```

**Шаг 2: Добавить инструкции в EXTRACTION_PROMPT**

После секции entity extraction, добавить:

```
Для каждой сущности укажи главное СОБЫТИЕ этой главы:
- chapter_event_action: что персонаж ДЕЛАЕТ (одно предложение, или null если просто упоминается)
- chapter_event_inner: что персонаж ЧУВСТВУЕТ/ДУМАЕТ (одно предложение, или null)
```

**Шаг 3: Добавить context и is_focus в TSA prompt**

В TSA_EXTRACTION_PROMPT добавить инструкцию для каждого описания:

```
Дополнительно для каждого описания:
- context: 1 предложение — кто присутствует и что происходит в сцене
- is_focus_entity: имя entity, которой ПОСВЯЩЕНО описание, или null если общая сцена
```

**Шаг 4: Тест + коммит**

```bash
cd backend && pytest tests/services/test_gemini_extractor.py -v
git commit -m "feat(extraction): add chapter_event_action/inner, context, is_focus to prompts"
```

---

### Task 8: Entity Synthesis Service (Phase 2)

**Файлы:**
- Создать: `backend/app/services/entity_synthesis_service.py`
- Тест: `backend/tests/services/test_entity_synthesis.py`

**Шаг 1: Написать тесты**

```python
# backend/tests/services/test_entity_synthesis.py
import pytest
from unittest.mock import AsyncMock, patch

class TestEntitySynthesisService:
    def test_build_synthesis_prompt_includes_genre(self):
        """Prompt содержит жанр книги."""
        from backend.app.services.entity_synthesis_service import EntitySynthesisService
        prompt = EntitySynthesisService._build_synthesis_prompt(
            entities_data=[{"name": "Гарри", "type": "character", "events": [], "visual_summary": ""}],
            all_entity_names=["Гарри"],
            genre="FANTASY",
            language="ru",
        )
        assert "FANTASY" in prompt
        assert "ru" in prompt

    def test_build_synthesis_prompt_type_aware(self):
        """Prompt содержит type-aware инструкции."""
        from backend.app.services.entity_synthesis_service import EntitySynthesisService
        prompt = EntitySynthesisService._build_synthesis_prompt(
            entities_data=[{"name": "Хогвартс", "type": "location", "events": [], "visual_summary": ""}],
            all_entity_names=["Хогвартс"],
            genre="FANTASY",
            language="ru",
        )
        assert "location" in prompt

    def test_batch_entities(self):
        """Entities > 80 разбиваются на batch'и по ~50."""
        from backend.app.services.entity_synthesis_service import EntitySynthesisService
        entities = [{"name": f"Entity_{i}"} for i in range(120)]
        batches = EntitySynthesisService._batch_entities(entities, batch_size=50)
        assert len(batches) == 3
        assert len(batches[0]) == 50
        assert len(batches[2]) == 20

    def test_parse_synthesis_response(self):
        """Парсинг JSON ответа synthesis."""
        from backend.app.services.entity_synthesis_service import EntitySynthesisService
        response = {
            "entities": [{
                "name": "Гарри",
                "base_role": "protagonist",
                "milestones": [
                    {"up_to_chapter": 1, "biography": "Сирота", "visual_summary_clean": "Мальчик", "dynamic_role": "Ученик", "importance": 8}
                ]
            }],
            "relationship_milestones": []
        }
        result = EntitySynthesisService._parse_synthesis_response(response)
        assert len(result["entities"]) == 1
        assert result["entities"][0]["base_role"] == "protagonist"
```

**Шаг 2: Запустить — убедиться что падает**

```bash
cd backend && pytest tests/services/test_entity_synthesis.py -v
```

**Шаг 3: Реализовать сервис**

Создать `backend/app/services/entity_synthesis_service.py`:

```python
"""
Entity Synthesis Service — Phase 2 post-book processing.

Генерирует biography milestones, roles, relationship evolution
на основе EntityEvents и visual_summary.
"""
import json
import logging
from typing import Any

from tenacity import retry, stop_after_attempt, wait_exponential

from ..core.config import settings

logger = logging.getLogger(__name__)

SYNTHESIS_PROMPT_TEMPLATE = """..."""  # Полный промпт из дизайн-документа секция 4.2

class EntitySynthesisService:
    def __init__(self, gemini_client=None):
        self.gemini_client = gemini_client

    @staticmethod
    def _build_synthesis_prompt(
        entities_data: list[dict],
        all_entity_names: list[str],
        genre: str,
        language: str,
    ) -> str:
        # Сформировать prompt с genre-aware и type-aware инструкциями
        ...

    @staticmethod
    def _batch_entities(entities: list[dict], batch_size: int = 50) -> list[list[dict]]:
        return [entities[i:i + batch_size] for i in range(0, len(entities), batch_size)]

    @staticmethod
    def _parse_synthesis_response(response: dict) -> dict:
        # Валидация и парсинг JSON ответа
        ...

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
    async def _call_gemini(self, prompt: str) -> dict:
        # Вызов Gemini с retry
        ...

    async def synthesize_book_entities(
        self, book_id, entities, events, genre, language
    ) -> dict:
        # Основной метод: batching → LLM calls → parse → save
        ...
```

**Шаг 4: Тесты + коммит**

```bash
cd backend && pytest tests/services/test_entity_synthesis.py -v
git commit -m "feat(synthesis): add EntitySynthesisService with genre/type-aware prompts and batching"
```

---

### Task 9: Интеграция в book_tasks.py

**Файлы:**
- Изменить: `backend/app/tasks/book_tasks.py`
- Изменить: `backend/app/services/consistency_manager.py`

**Шаг 1: Создание EntityEvent в map phase**

В `consistency_manager.py`, в `process_chapter_analysis()`, после создания EntityMention добавить:

```python
# Создать EntityEvent если есть action
if entity_data.get("chapter_event_action"):
    event = EntityEvent(
        entity_id=entity.id,
        chapter_id=chapter.id,
        chapter_number=chapter.chapter_number,
        event_action=entity_data["chapter_event_action"],
        event_inner_state=entity_data.get("chapter_event_inner"),
    )
    session.add(event)
```

**Шаг 2: Добавить synthesis step в book_tasks.py**

После LLM dedup phase (шаг 7 в pipeline), перед Graph PageRank:

```python
# Phase: Entity Synthesis
logger.info(f"Book {book_id}: Starting entity synthesis...")
synthesis_service = EntitySynthesisService()
await synthesis_service.synthesize_book_entities(
    book_id=book_id,
    entities=all_entities,
    events=all_events,
    genre=book.genre,
    language=book.language,
)
```

**Шаг 3: Коммит**

```bash
git commit -m "feat(pipeline): integrate EntityEvent creation and synthesis into book_tasks"
```

---

### Task 10: API схемы и Recap endpoint

**Файлы:**
- Изменить: `backend/app/schemas/responses/entities.py`
- Изменить: `backend/app/routers/books/entities.py`
- Тест: `backend/tests/routers/test_entities_router.py`

**Шаг 1: Обновить EntityDetailSchema**

```python
class EntityEventSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    chapter_number: int
    event_action: str
    event_inner_state: Optional[str] = None

class EntityDetailSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    type: str
    avatar_url: Optional[str] = None
    importance: int = 5

    mentions: List[int] = []
    first_mention_cfi: Optional[str] = None
    first_mention_offset: Optional[int] = None
    first_mention_chapter: Optional[int] = None
    aliases: List[str] = []

    # Новые поля (из milestone)
    biography: Optional[str] = None
    base_role: Optional[str] = None
    dynamic_role: Optional[str] = None
    visual_summary_clean: Optional[str] = None
    events: List[EntityEventSchema] = []
```

**Шаг 2: Добавить RecapSchema и endpoint**

```python
class RecapEntitySchema(BaseModel):
    id: UUID
    name: str
    avatar_url: Optional[str] = None
    dynamic_role: Optional[str] = None
    last_event: Optional[EntityEventSchema] = None

class RecapResponse(BaseModel):
    entities: List[RecapEntitySchema]
```

Endpoint в `backend/app/routers/books/entities.py`:

```python
@router.get("/{book_id}/entities/recap", response_model=RecapResponse)
async def get_book_recap(
    book_id: UUID,
    current_chapter: int = Query(...),
    db: AsyncSession = Depends(get_database),
    current_user: User = Depends(get_current_active_user),
):
    book = await get_user_book(db, current_user.id, book_id)
    recap = await EntityService.get_recap(db, book_id, current_chapter)
    return recap
```

**Шаг 3: Тесты + коммит**

```bash
cd backend && pytest tests/routers/test_entities_router.py -v
git commit -m "feat(api): update EntityDetailSchema with milestones, add recap endpoint"
```

---

## Фаза 3: Frontend — Типы и утилиты

### Task 11: Обновить TypeScript типы

**Файлы:**
- Изменить: `frontend/src/types/entity.ts`

**Шаг 1: Обновить интерфейсы**

```typescript
export interface EntityEvent {
    chapter_number: number;
    event_action: string;
    event_inner_state?: string | null;
}

export interface EntityDetail {
    id: string;
    name: string;
    type: EntityType | string;
    avatar_url?: string | null;
    importance: number;

    mentions: number[];
    first_mention_cfi?: string | null;
    first_mention_offset?: number | null;
    first_mention_chapter?: number | null;
    aliases?: string[];

    // Новые поля (из milestone)
    biography?: string | null;
    base_role?: string | null;
    dynamic_role?: string | null;
    visual_summary_clean?: string | null;
    events: EntityEvent[];
}
```

Удалить `notes: EntityNote[]` и интерфейс `EntityNote`.

**Шаг 2: Коммит**

```bash
git commit -m "feat(types): update EntityDetail with milestones, events, roles; remove notes"
```

---

### Task 12: Entity Labels (roles + relationships)

**Файлы:**
- Создать: `frontend/src/components/Entities/entityLabels.ts`
- Изменить: `frontend/src/locales/ru/translation.json`

**Шаг 1: Создать entityLabels.ts**

```typescript
import i18n from '@/lib/i18n';

export const getEntityTypeLabel = (type: string): string => {
    const key = `entities.type_${type}`;
    const translated = i18n.t(key);
    return translated !== key ? translated : type;
};

export const baseRoleLabels: Record<string, string> = {
    protagonist: 'Главный герой',
    antagonist: 'Антагонист',
    supporting: 'Значимый персонаж',
    episodic: 'Эпизодический',
};

export const relationshipTypeLabels: Record<string, string> = {
    KINSHIP: 'Родство',
    ALLY: 'Союзник',
    ENEMY: 'Враг',
    FRIEND: 'Друг',
    MENTOR: 'Наставник',
    STUDENT: 'Ученик',
    ROMANCE: 'Любовь',
    RIVAL: 'Соперник',
};

export const getBaseRoleLabel = (role: string | null | undefined): string | null => {
    if (!role) return null;
    return baseRoleLabels[role] || role;
};

export const getRelationshipLabel = (type: string): string => {
    return relationshipTypeLabels[type] || type;
};
```

**Шаг 2: Обновить i18n**

В `frontend/src/locales/ru/translation.json` добавить ключи:
```json
"entities": {
    "romance": "Любовь",
    "rival": "Соперник",
    "about": "О персонаже",
    "appearance": "Внешность",
    "by_chapters": "По главам",
    "gallery": "Галерея",
    "aliases_section": "Псевдонимы",
    "recap_title": "Ранее в книге",
    "name_highlighting": "Подсветка имён",
    "description_density": "Плотность описаний",
    "density_all": "Все",
    "density_key": "Ключевые",
    "density_off": "Выкл"
}
```

**Шаг 3: Коммит**

```bash
git commit -m "feat(labels): add baseRoleLabels, relationship labels (ROMANCE, RIVAL), i18n keys"
```

---

### Task 13: Position-aware search strategies

**Файлы:**
- Изменить: `frontend/src/utils/text-search/strategies.ts`
- Изменить: `frontend/src/hooks/epub/useDescriptionHighlighting.ts`
- Тест: `frontend/src/utils/text-search/__tests__/strategies.test.ts`

**Шаг 1: Написать тест**

```typescript
// frontend/src/utils/text-search/__tests__/strategies.test.ts
import { strategies, StrategyResult } from '../strategies';

describe('Position-aware strategies', () => {
    it('returns startIdx and endIdx for S1_First40', () => {
        const result: StrategyResult = strategies[0].fn(
            'библиотека занимала три этажа уставленных книгами от пола до потолка',
            { first40: 'библиотека занимала три этажа устав', /* ... */ },
            100
        );
        expect(result.found).toBe(true);
        expect(result.startIdx).toBe(0);
        expect(result.endIdx).toBeGreaterThan(0);
    });

    it('returns found:false when no match', () => {
        const result = strategies[0].fn('текст без совпадений', { first40: 'что-то другое' }, 50);
        expect(result.found).toBe(false);
        expect(result.startIdx).toBeUndefined();
    });
});
```

**Шаг 2: Обновить интерфейс и стратегии**

```typescript
export interface StrategyResult {
    found: boolean;
    startIdx?: number;
    endIdx?: number;
}

export type SearchStrategy = (
    text: string,
    patterns: SearchPatterns,
    contentLength: number
) => StrategyResult;
```

Каждая стратегия: вместо `return text.includes(pattern)` → `const idx = text.indexOf(pattern); return idx >= 0 ? { found: true, startIdx: idx, endIdx: idx + pattern.length } : { found: false };`

**Шаг 3: Обновить useDescriptionHighlighting для node splitting**

Вместо замены всего text node — split на 3 части:

```typescript
if (result.found && result.startIdx !== undefined && result.endIdx !== undefined) {
    const before = text.substring(0, result.startIdx);
    const match = text.substring(result.startIdx, result.endIdx);
    const after = text.substring(result.endIdx);

    const frag = doc.createDocumentFragment();
    if (before) frag.appendChild(doc.createTextNode(before));

    const span = doc.createElement('span');
    span.className = 'description-highlight';
    span.textContent = match;
    frag.appendChild(span);

    if (after) frag.appendChild(doc.createTextNode(after));
    node.parentNode?.replaceChild(frag, node);
}
```

Убрать `break` — продолжать проверку для after-text node.

**Шаг 4: Тесты + коммит**

```bash
cd frontend && npm test -- strategies.test.ts
git commit -m "feat(highlighting): position-aware strategies with node splitting"
```

---

## Фаза 4: Frontend — Компоненты Entity Wiki

### Task 14: EntityEventTimeline

**Файлы:**
- Создать: `frontend/src/components/Entities/EntityEventTimeline.tsx`

**Шаг 1: Реализовать**

```typescript
interface Props {
    events: EntityEvent[];
}

export const EntityEventTimeline: React.FC<Props> = ({ events }) => {
    // Группировка по chapter_number
    // Каждая глава: chapter badge + events list
    // action обычным шрифтом, inner_state курсивом
};
```

**Шаг 2: Коммит**

```bash
git commit -m "feat(ui): add EntityEventTimeline component"
```

---

### Task 15: EntityGallery

**Файлы:**
- Создать: `frontend/src/components/Entities/EntityGallery.tsx`

Компонент показывает изображения, где entity = focus. Использует DescriptionEntity.is_focus для фильтрации.

**Коммит:**
```bash
git commit -m "feat(ui): add EntityGallery with is_focus filtering"
```

---

### Task 16: EntityMiniCard (popup)

**Файлы:**
- Создать: `frontend/src/components/Entities/EntityMiniCard.tsx`

Popup мини-карточка: аватар, имя, dynamic_role badge, visual_summary_clean (truncated), последний event, кол-во связей.

**Коммит:**
```bash
git commit -m "feat(ui): add EntityMiniCard popup component"
```

---

### Task 17: RecapPanel

**Файлы:**
- Создать: `frontend/src/components/Entities/RecapPanel.tsx`
- Создать: `frontend/src/hooks/api/useRecap.ts`

Top-5 entities по importance с последним event. API hook для `/recap` endpoint.

**Коммит:**
```bash
git commit -m "feat(ui): add RecapPanel with useRecap hook"
```

---

### Task 18: Обновить EntityProfile

**Файлы:**
- Изменить: `frontend/src/components/Entities/EntityProfile.tsx`

**Изменения:**
1. Удалить секцию «История» (notes)
2. Добавить role badge (dynamic_role || base_role)
3. Добавить importance stars из milestone
4. Добавить секцию «О персонаже» (biography)
5. Добавить секцию «Внешность» (visual_summary_clean)
6. Заменить секцию «История» на EntityEventTimeline
7. Добавить EntityGallery (с is_focus фильтрацией)
8. Аватары-плейсхолдеры по типу (силуэт / здание / предмет)

**Коммит:**
```bash
git commit -m "feat(ui): update EntityProfile with biography, events, gallery, role badges"
```

---

### Task 19: Обновить EntityCard

**Файлы:**
- Изменить: `frontend/src/components/Entities/EntityCard.tsx`

**Изменения:**
1. Показывать role badge (dynamic_role || base_role)
2. Заменить visual_summary на visual_summary_clean
3. Добавить последний event (одной строкой)
4. Плейсхолдер-иконка по типу

**Коммит:**
```bash
git commit -m "feat(ui): update EntityCard with role badge, clean summary, last event"
```

---

### Task 20: Обновить RelationshipCard

**Файлы:**
- Изменить: `frontend/src/components/Entities/RelationshipCard.tsx`

**Изменения:**
1. Добавить ROMANCE + RIVAL типы с иконками (Heart, Swords)
2. Отображать тип актуальный для текущей главы (relationship_milestones)
3. RU-labels из entityLabels.ts

**Коммит:**
```bash
git commit -m "feat(ui): add ROMANCE, RIVAL relationship types with evolution"
```

---

## Фаза 5: Frontend — Description Pipeline

### Task 21: Type-based highlight цвета + quality tiers

**Файлы:**
- Изменить: `frontend/src/hooks/epub/useDescriptionHighlighting.ts`

**Изменения:**
1. CSS-классы по типу: `.desc-location` (голубой), `.desc-character` (фиолетовый), `.desc-atmosphere` (янтарный), `.desc-object` (зелёный)
2. Solid/dashed border по наличию изображения
3. Фильтрация по priority_score: Highlighted (>50) vs Hidden
4. Настройка плотности через prop

**Коммит:**
```bash
git commit -m "feat(highlighting): type-based colors, image indicator, quality tiers"
```

---

### Task 22: Description Peek

**Файлы:**
- Создать: `frontend/src/components/Reader/DescriptionPeek.tsx`
- Изменить: `frontend/src/hooks/epub/useDescriptionHighlighting.ts`

Long press → thumbnail 150x150 или scene_context popup. Тап → полный модал.

**Коммит:**
```bash
git commit -m "feat(ui): add DescriptionPeek (long press thumbnail preview)"
```

---

### Task 23: ImageModal — «Книга vs AI»

**Файлы:**
- Изменить: `frontend/src/components/Images/ImageModal.tsx`

**Изменения:**
1. Показывать scene_context как заголовок
2. Показывать оригинальный текст автора (description content)
3. AI-изображение ниже
4. Скрыть технический content (Imagen prompt)

**Коммит:**
```bash
git commit -m "feat(ui): update ImageModal with 'Book vs AI' layout"
```

---

### Task 24: Entity Name Highlighting

**Файлы:**
- Создать: `frontend/src/hooks/epub/useEntityNameHighlighting.ts`
- Создать: `frontend/src/components/Entities/EntityMiniCard.tsx` (уже в Task 16)

**Реализация:**
1. Для каждой entity — найти первое упоминание в тексте главы
2. Обернуть в `<span class="entity-mention">` с dotted underline
3. На тап — показать EntityMiniCard popup
4. Toggle в настройках

**Коммит:**
```bash
git commit -m "feat(highlighting): add entity name highlighting with dotted underline"
```

---

### Task 25: ReaderControls — новые настройки

**Файлы:**
- Изменить: `frontend/src/components/Reader/ReaderControls.tsx`

**Изменения:**
1. Toggle: «Подсветка имён» (вкл/выкл)
2. Плотность описаний: «Все» / «Ключевые» / «Выкл»

**Коммит:**
```bash
git commit -m "feat(ui): add name highlighting toggle and description density controls"
```

---

## Фаза 6: Интеграция и тестирование

### Task 26: Интеграционные тесты backend

**Файлы:**
- Создать: `backend/tests/services/test_entity_synthesis_integration.py`

Тесты полного цикла: extraction → events → synthesis → API response.

**Коммит:**
```bash
git commit -m "test(integration): add entity synthesis pipeline integration tests"
```

---

### Task 27: Финальная проверка

**Шаг 1:** Запустить все backend тесты:
```bash
cd backend && pytest -v
```

**Шаг 2:** Запустить все frontend тесты:
```bash
cd frontend && npm test
```

**Шаг 3:** Запустить build:
```bash
cd frontend && npm run build
```

**Шаг 4:** Коммит всех оставшихся изменений

---

## Порядок зависимостей

```
Task 1-4 (миграции) — параллельно, нет зависимостей
    ↓
Task 5 (кэш) ← зависит от Task 2 (milestones поля)
Task 6 (event dedup) ← нет зависимостей
Task 7 (prompts) ← зависит от Task 1 (EntityEvent модель)
    ↓
Task 8 (synthesis) ← зависит от Task 1, 2, 3, 7
Task 9 (pipeline) ← зависит от Task 8, 6
Task 10 (API) ← зависит от Task 1, 2, 5
    ↓
Task 11-12 (типы, labels) — параллельно, нет backend зависимостей
Task 13 (strategies) — независимый
    ↓
Task 14-20 (компоненты) ← зависят от Task 11-12
Task 21-25 (description) ← зависят от Task 13
    ↓
Task 26-27 (тесты) — финал
```

**Параллелизация:** Tasks 1-4 параллельно. Tasks 11-13 параллельно. Tasks 14-20 параллельно. Tasks 21-25 параллельно.

---

*План содержит 27 задач. Расчётное время: Backend (Tasks 1-10) ~4-6 часов, Frontend (Tasks 11-25) ~4-6 часов, Testing (Tasks 26-27) ~1 час.*
