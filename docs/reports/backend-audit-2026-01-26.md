# Backend Audit Report — 26 января 2026

## Executive Summary

**Общая оценка зрелости backend: 6.5/10**

### Сильные стороны
1. **Современный стек** — FastAPI 0.125, SQLAlchemy 2.0.45 async, google-genai 1.59
2. **Resilient patterns** — tenacity retry с exponential backoff везде
3. **Полная типизация** — Pydantic models, Mapped[] для SQLAlchemy

### Критические проблемы
1. **P0: DescriptionEntity не создаются** — связь Description↔Entity отсутствует, `notes=[]` на фронтенде
2. **P0: Dead code langextract_processor.py** — 816 строк мёртвого кода
3. **P1: Бизнес-логика в роутерах** — `images.py` 1189 строк, `descriptions.py` 903 строки

---

## Детальный анализ

### 1. Система парсинга описаний (КРИТИЧНО)

#### 1.1 Pipeline (текущий)

```
Router descriptions.py:174
  → langextract_processor.extract_descriptions() [DEAD WRAPPER]
    → gemini_extractor._extract_from_chunk()
      → _call_gemini_with_retry()
        → google.genai.Client.models.generate_content()

Celery book_tasks.py:357
  → gemini_extractor.analyze_chapter() [DIRECT]
    → _call_gemini_with_retry()
```

#### 1.2 Проблема: DescriptionEntity не создаются

**Файл:** `backend/app/tasks/book_tasks.py:368-402`

**Корневая причина:**
1. `gemini_extractor.analyze_chapter()` возвращает `ChapterAnalysisResult` с `descriptions[].entities: list[str]`
2. `consistency_manager.process_chapter_analysis()` возвращает `entity_map: Dict[str, Entity]`
3. В `book_tasks.py:390-402` добавлен код создания DescriptionEntity, НО:
   - Имена сущностей в `description.entities` могут НЕ совпадать с ключами `entity_map`
   - Gemini может вернуть "Иван" в description.entities, а в entity_map будет "Иван Петров"

**Решение:** Добавить fuzzy matching или нормализацию имён.

#### 1.3 Проблема: langextract_processor.py — мёртвый код

**Файл:** `backend/app/services/langextract_processor.py` (816 строк)

**Факты:**
- Имеет собственный `EXTRACTION_PROMPT` (не используется)
- Просто делегирует в `gemini_extractor._extract_from_chunk()`
- Router `descriptions.py` импортирует его, но реальная работа в `gemini_extractor`

**Решение:** Удалить файл, обновить импорты.

### 2. Архитектура роутеров

#### 2.1 images.py (1189 строк) — РЕФАКТОРИНГ НЕОБХОДИМ

**Проблемы:**
- ~600 строк SQL и бизнес-логики
- Endpoint `/generate` содержит: валидацию, проверку квот, выбор модели, генерацию, сохранение
- Нарушает Single Responsibility

**Решение:** Создать `ImageService` с методами:
- `check_generation_quota(user_id) -> QuotaResult`
- `select_generation_model(user) -> ModelConfig`
- `generate_and_save(description_id, user) -> GeneratedImage`

#### 2.2 descriptions.py (903 строки) — ДУБЛИРОВАНИЕ

**Проблемы:**
- Строки 155-229: основная extraction логика
- Строки 711-824: `_background_extract_descriptions` — копипаста
- Бизнес-логика смешана с API handlers

**Решение:** Создать `DescriptionExtractionService`.

### 3. Celery Tasks

**Файл:** `backend/app/tasks/book_tasks.py`

#### 3.1 Transaction boundaries

**Проблема:**
- Per-chapter commit без book-level транзакции
- Crashed chapters пропускаются навсегда (нет retry tracking)

**Решение:** Обернуть в book-level транзакцию с savepoints.

#### 3.2 Redis lock

**Проблема:**
- `timeout=10800` (3 часа) без renewal
- Lock может истечь во время обработки большой книги

**Решение:** Добавить periodic lock renewal.

### 4. google-genai SDK Usage

#### 4.1 Текущий подход (manual JSON parsing)

```python
# gemini_extractor.py:610
response = client.models.generate_content(
    model='gemini-3-flash-preview',
    contents=prompt,
    config={'response_mime_type': 'application/json'},
)
result = json.loads(response.text)  # Manual parsing
```

#### 4.2 Рекомендуемый подход (response_schema)

```python
from pydantic import BaseModel
from google.genai import types

class ChapterAnalysis(BaseModel):
    descriptions: list[Description]
    entities: list[Entity]

response = client.models.generate_content(
    model='gemini-3-flash-preview',
    contents=prompt,
    config=types.GenerateContentConfig(
        response_mime_type='application/json',
        response_schema=ChapterAnalysis,  # Auto-parsing!
    ),
)
result = response.parsed  # Pydantic object directly
```

**Преимущества:**
- Гарантированная валидация схемы
- Автоматический retry при ошибках формата
- Type safety

### 5. Отсутствующие индексы

**Проверить/добавить:**

```sql
-- entities.entity_metadata (для JSONB запросов)
CREATE INDEX idx_entities_metadata_gin ON entities USING GIN (entity_metadata);

-- entity_relationships (reverse lookup)
CREATE INDEX idx_entity_rel_target_type ON entity_relationships (target_entity_id, relationship_type);

-- descriptions (composite для частых запросов)
CREATE INDEX idx_descriptions_chapter_type_score ON descriptions (chapter_id, type, priority_score DESC);
```

### 6. Observability

**Текущее состояние:**
- Только internal stats в singleton (`gemini_extractor._stats`)
- Нет Prometheus метрик
- Нет structured logging для LLM операций

**Рекомендации:**
- Добавить `prometheus_client` метрики: latency, tokens, errors
- Structured logging с request_id, model, tokens
- Response caching в Redis для повторных extraction

---

## Технический долг

| ID | Описание | Файл(ы) | Сложность | Приоритет |
|----|----------|---------|-----------|-----------|
| **TD-001** | DescriptionEntity: fuzzy matching для entity lookup | book_tasks.py:390-402 | M | **P0** |
| **TD-002** | Удалить langextract_processor.py | langextract_processor.py | S | **P0** |
| **TD-003** | Добавить логирование в entity lookup для диагностики | book_tasks.py | S | **P0** |
| TD-004 | Вынести extraction логику в DescriptionExtractionService | descriptions.py | L | P1 |
| TD-005 | Вынести бизнес-логику из images.py в ImageService | images.py | L | P1 |
| TD-006 | Book-level транзакция с savepoints | book_tasks.py | M | P1 |
| TD-007 | GIN индексы на entity JSONB поля | migrations | S | P1 |
| TD-008 | Redis lock renewal | book_tasks.py | S | P1 |
| TD-009 | Prometheus метрики для LLM | gemini_extractor.py | M | P2 |
| TD-010 | LLM response caching в Redis | gemini_extractor.py | M | P2 |
| TD-011 | mention_cfi не заполняется | consistency_manager.py:61-67 | M | P2 |
| TD-012 | Перейти на response_schema с Pydantic | gemini_extractor.py | M | P1 |
| TD-013 | Добавить Instructor для auto-retry | gemini_extractor.py | M | P1 |
| TD-014 | Semantic validation (entity in source) | gemini_extractor.py | S | P1 |
| TD-015 | Confidence threshold fallback (flash → pro) | gemini_extractor.py | M | P2 |

---

## План доработок

### Фаза 1: Диагностика P0 (1-2 часа)

**TD-003: Добавить логирование для диагностики**

```python
# book_tasks.py:390-402
for desc in descriptions:
    for entity_name in desc.entities:
        if entity_name in entity_map:
            # Create DescriptionEntity
            ...
        else:
            logger.warning(
                f"Entity '{entity_name}' from description not found in entity_map. "
                f"Available keys: {list(entity_map.keys())}"
            )
```

**Действия:**
1. Добавить логирование
2. Задеплоить на production
3. Запустить парсинг книги
4. Собрать логи, понять причину mismatch

### Фаза 2: Исправление P0 (2-4 часа)

**TD-001: Fuzzy matching для entity lookup**

```python
from difflib import get_close_matches

def find_entity(entity_name: str, entity_map: dict[str, Entity]) -> Entity | None:
    # Exact match first
    if entity_name in entity_map:
        return entity_map[entity_name]
    
    # Fuzzy match
    matches = get_close_matches(entity_name, entity_map.keys(), n=1, cutoff=0.8)
    if matches:
        logger.info(f"Fuzzy matched '{entity_name}' to '{matches[0]}'")
        return entity_map[matches[0]]
    
    return None
```

**TD-002: Удалить langextract_processor.py**

1. Найти все импорты: `grep -r "langextract_processor" backend/`
2. Заменить на прямые вызовы `gemini_extractor`
3. Удалить файл
4. Запустить тесты

### Фаза 3: Улучшение LLM Integration (P1)

**TD-012: Перейти на response_schema**

```python
from pydantic import BaseModel, Field
from google.genai import types

class GeminiDescriptionSchema(BaseModel):
    content: str = Field(description="Описание сцены или персонажа")
    type: str = Field(description="Тип: scene, character, setting")
    entities: list[str] = Field(description="Связанные сущности")
    confidence: float = Field(ge=0.0, le=1.0)

class ChapterAnalysisResult(BaseModel):
    descriptions: list[GeminiDescriptionSchema]
    entities: list[GeminiEntitySchema]
    relationships: list[GeminiRelationshipSchema]

# Usage
response = client.models.generate_content(
    model='gemini-3-flash-preview',
    contents=prompt,
    config=types.GenerateContentConfig(
        response_mime_type='application/json',
        response_schema=ChapterAnalysisResult,
        temperature=0.1,
    ),
)
result: ChapterAnalysisResult = response.parsed
```

**TD-014: Semantic validation**

```python
def validate_entities_in_text(
    descriptions: list[GeminiDescriptionSchema],
    source_text: str
) -> list[str]:
    """Verify extracted entity names appear in source text."""
    warnings = []
    text_lower = source_text.lower()
    
    for desc in descriptions:
        for entity_name in desc.entities:
            if entity_name.lower() not in text_lower:
                warnings.append(
                    f"Entity '{entity_name}' not found in source text"
                )
    
    return warnings
```

### Фаза 4: Рефакторинг Service Layer (P1)

**TD-004: DescriptionExtractionService**

```python
# backend/app/services/description_extraction_service.py

class DescriptionExtractionService:
    def __init__(
        self,
        db: AsyncSession,
        extractor: GeminiExtractor,
        cache: Redis,
    ):
        self.db = db
        self.extractor = extractor
        self.cache = cache
    
    async def extract_chapter_descriptions(
        self,
        chapter_id: str,
        content: str,
        force_refresh: bool = False,
    ) -> list[Description]:
        """Extract descriptions from chapter content."""
        # Check cache
        cache_key = f"extraction:{chapter_id}"
        if not force_refresh:
            cached = await self.cache.get(cache_key)
            if cached:
                return [Description(**d) for d in json.loads(cached)]
        
        # Extract
        result = await self.extractor.analyze_chapter(content)
        
        # Save to DB
        descriptions = await self._save_descriptions(chapter_id, result)
        
        # Cache
        await self.cache.set(
            cache_key,
            json.dumps([d.model_dump() for d in descriptions]),
            ex=86400,
        )
        
        return descriptions
```

**TD-005: ImageService**

```python
# backend/app/services/image_service.py

class ImageService:
    async def check_generation_quota(
        self,
        user_id: str,
    ) -> QuotaResult:
        """Check if user can generate more images."""
        ...
    
    async def generate_image(
        self,
        description_id: str,
        user: User,
    ) -> GeneratedImage:
        """Generate image for description."""
        # Check quota
        quota = await self.check_generation_quota(user.id)
        if not quota.allowed:
            raise QuotaExceededError(quota.message)
        
        # Select model based on subscription
        model = self._select_model(user.subscription)
        
        # Generate
        image_data = await self.generator.generate(
            description_id=description_id,
            model=model,
        )
        
        # Save
        return await self._save_image(image_data, user.id)
```

---

## Ключевые файлы для работы

| Файл | Строки | Проблема |
|------|--------|----------|
| `backend/app/tasks/book_tasks.py` | 390-402 | Entity lookup может не работать |
| `backend/app/services/langextract_processor.py` | весь | Мёртвый код, удалить |
| `backend/app/routers/descriptions.py` | 155-229, 711-824 | Дублирование |
| `backend/app/services/gemini_extractor.py` | 610 | Manual JSON parsing |
| `backend/app/services/consistency_manager.py` | 29-86 | Возвращает entity_map |
| `backend/app/services/entity_service.py` | 101-116 | Загружает description_entities |

---

## Изменённые файлы (не задеплоено)

```
backend/app/services/consistency_manager.py
  - Строка 29: Изменён return type на Dict[str, Entity]
  - Строка 87: Добавлен return entity_map

backend/app/tasks/book_tasks.py
  - Строки 390-402: Добавлено создание DescriptionEntity
  - Import DescriptionEntity добавлен
```

---

## LSP ошибки (pre-existing, не критичные)

- `consistency_manager.py`: weight type (float vs int)
- `book_tasks.py`: logger import symbol
- `gemini_extractor.py`: genai import

---

## Рекомендации по google-genai SDK (из research)

### Best Practices 2026

1. **Используй `response_schema` с Pydantic** — автоматический parsing через `response.parsed`
2. **Всегда устанавливай `response_mime_type='application/json'`** для structured output
3. **Обрабатывай 429 с exponential backoff** через tenacity + `errors.ClientError`
4. **Ограничивай concurrent requests** через `asyncio.Semaphore`
5. **Gemini 3 Flash**: 1M input / 64K output tokens

### Instructor Library (опционально)

Для production extraction систем рекомендуется Instructor:
- Auto-retry с validation error feedback в LLM
- Cross-provider compatibility
- Pydantic-native validation

```bash
pip install instructor
```

```python
import instructor
from google import genai

client = instructor.from_provider("google/gemini-3-flash-preview")

result = client.chat.completions.create(
    response_model=ChapterAnalysisResult,
    messages=[{"role": "user", "content": prompt}],
    max_retries=3,  # Auto-retry on validation failure
)
```

---

## Следующие шаги

1. **Сейчас**: TD-003 — добавить логирование для диагностики
2. **После логов**: TD-001 — fuzzy matching или нормализация
3. **Затем**: TD-002 — удалить langextract_processor.py
4. **Затем**: TD-012 — перейти на response_schema

---

**Автор:** Claude (Sisyphus)
**Дата:** 26 января 2026
**Версия:** 1.0
