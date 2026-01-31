# Анализ регрессии функциональности обработки книг

**Дата:** 31 января 2026  
**Версия:** 1.0  
**Статус:** Анализ завершён, рекомендации готовы к внедрению

---

## Резюме (Executive Summary)

За период 20-31 января 2026 года были проведены масштабные правки Backend LLM-функциональности. Выявлено **7 критических проблем**, влияющих на качество обработки книг:

| # | Проблема | Критичность | Корневая причина |
|---|----------|-------------|------------------|
| 1 | Мало коротких описаний | **CRITICAL** | "Синдром вахтёра" в промптах (Top-15, Importance<7=ИГНОРИРОВАТЬ) |
| 2 | Описания не отображаются в карточках | **HIGH** | Backend не сохраняет context в relationships + Frontend hardcoded |
| 3 | Visual summary статичное | **HIGH** | Логика "Wiper" — сохраняется только самое длинное описание |
| 4 | Мало сущностей и связей | **CRITICAL** | Те же ограничения Top-15 + Importance фильтрация |
| 5 | Нет информации о главе в карточках | **MEDIUM** | Frontend не получает chapter_index из entity metadata |
| 6 | Баг защиты от спойлеров | **HIGH** | Глобальная дедупликация без учёта reveal_chapter |
| 7 | Несовпадение текста описаний | **MEDIUM** | TSA offset расхождения + highlight matching issues |

**Ключевые рекомендации:**
1. Убрать ограничения Top-15 и Importance<7 из промптов
2. Увеличить min_description_chars с 50 до 150 символов
3. Исправить сохранение context в relationships
4. Добавить reveal_chapter для алиасов сущностей
5. Расширить таксономию связей на Frontend

---

## 1. Обзор изменений за период 20-31 января 2026

### 1.1 Ключевые коммиты

```
50e5507 fix(backend): improve LLM extraction robustness and relax entity filtering
9d79fa0 feat(reader): comprehensive architecture and stability improvements  
dc98fb5 feat(frontend): Deep Audit v3 - comprehensive UX/UI improvements
d75f063 fix(backend): unify Gemini model version to 3.0 Flash Preview
```

### 1.2 Изменённые файлы (LLM-функциональность)

| Файл | Тип изменений | Влияние |
|------|---------------|---------|
| `gemini_extractor.py` | Новые промпты TSA, Pydantic schemas | Изменена логика извлечения |
| `consistency_manager.py` | Batch entity resolution, relationship processing | Логика слияния сущностей |
| `book_tasks.py` | Параллельная обработка глав | Оркестрация |
| `entity_deduplication_service.py` | Унификация Gemini модели | Дедупликация |

### 1.3 Документы для контекста

- `llm-book-processing-analysis-2026-01-30.md` — полный анализ архитектуры
- `llm-book-processing-analysis-2026-01-31.md` — предварительная диагностика проблем

---

## 2. Анализ существующих отчётов

### Из отчёта 2026-01-31

> **Причина "мало описаний":** Внедрение "Синдрома Вахтёра" в промпты.
> - До рефакторинга: "Выдели ВСЕ сущности"
> - Сейчас: "Выдели ТОЛЬКО ГЛАВНЫХ (Top-15)... 1-6 ИГНОРИРОВАТЬ"

> **Причина "Visual Summary статичное":** Логика "Wiper" в consistency_manager.py.
> - Код: `if len(raw.visual_summary) > len(entity.visual_summary): entity.visual_summary = raw.visual_summary`
> - При слиянии сохраняется только самое длинное описание

### Из отчёта 2026-01-30

- Полная архитектура двухэтапной обработки (синхронный парсинг + асинхронный Celery)
- TSA режим для точного определения позиций
- Entity deduplication pipeline (Phase 1-3)

---

## 3. Детальный анализ каждой проблемы

### 3.1 Проблема #1: Количество и размер описаний

**Ожидаемое поведение:** Много длинных описаний (200-500 символов), достаточных для генерации изображений через Imagen 4.

**Текущее поведение:** Мало коротких описаний (50-100 символов), непригодных для качественной генерации.

#### Локализация

| Компонент | Файл | Строки |
|-----------|------|--------|
| Промпт извлечения | `gemini_extractor.py` | 383-411 |
| Минимальная длина | `gemini_extractor.py` | 199 |
| Фильтрация confidence | `gemini_extractor.py` | 201 |

#### Причина регрессии

**EXTRACTION_PROMPT** содержит жёсткие ограничения:

```python
# Строки 386-390 gemini_extractor.py
"1. Выдели ТОЛЬКО ГЛАВНЫХ персонажей и КЛЮЧЕВЫЕ локации (Top-15 для сюжета). 
    Игнорируй обычные предметы и фоновых персонажей.
2. Оцени ВАЖНОСТЬ (importance) каждой сущности от 1 до 10.
   - 1-6: ИГНОРИРОВАТЬ."
```

**Конфигурация:**
```python
min_description_chars: int = 50  # Слишком низкий порог
max_descriptions_per_chunk: int = 10  # Ограничение на чанк
```

#### Рекомендация

1. **Убрать ограничение Top-15** — заменить на "Извлекай ВСЕ визуально значимые сущности"
2. **Снять барьер Importance<7** — разрешить сущности с importance >= 3
3. **Увеличить min_description_chars до 150** — фильтровать слишком короткие описания
4. **Добавить min_visual_summary_chars = 100** для сущностей

#### Улучшенный промпт

```python
EXTRACTION_PROMPT_V2 = """Ты - литературный архивариус и арт-директор.

ЗАДАЧА:
1. Выдели ВСЕ визуально значимые сущности — персонажей, локации, важные объекты.
   НЕ ОГРАНИЧИВАЙ себя "главными героями". Нам важен каждый трактирщик, 
   каждый артефакт и каждая тень, если они создают атмосферу.

2. Для каждой сущности создай ДЕТАЛЬНОЕ визуальное описание (visual_summary):
   - Минимум 100 символов
   - Для персонажей: лицо, волосы, телосложение, одежда, особые приметы
   - Для локаций: освещение, архитектура, атмосфера, ключевые детали
   - ПЛОХО: "Красивая девушка в платье"
   - ХОРОШО: "Молодая аристократка с бледной кожей, острыми скулами. 
              Носит бархатное платье цвета свернувшейся крови с кружевным воротником."

3. Оцени ВАЖНОСТЬ (importance) от 1 до 10:
   - 9-10: Протагонисты, главные антагонисты
   - 7-8: Значимые второстепенные персонажи
   - 4-6: Эпизодические, но визуально яркие персонажи
   - 1-3: Фоновые (но всё равно извлекай, если описаны!)

4. Выдели ОПИСАТЕЛЬНЫЕ ФРАГМЕНТЫ (descriptions):
   - Минимум 150 символов
   - Создают визуальный образ, подходящий для иллюстрации
   - Типы: location, character, object, atmosphere

5. Укажи text_offset — позицию начала каждого описания в тексте.

Текст для анализа:
{text}
"""
```

---

### 3.2 Проблема #2: Описания не отображаются в карточках сущностей/связей

**Ожидаемое поведение:** В каждой карточке сущности и связи отображается описание (visual_summary, context).

**Текущее поведение:** Описания не отображаются нигде.

#### Локализация

| Компонент | Файл | Проблема |
|-----------|------|----------|
| Backend relationships | `consistency_manager.py:103-108` | context не обновляется при merge |
| Frontend EntityCard | `EntityCard.tsx:79-85` | Отображает только truncated visual_summary |
| Frontend RelationshipCard | `RelationshipCard.tsx:144-150` | Использует edge.description, но он пустой |

#### Причина регрессии

**Backend (`consistency_manager.py`):**
```python
# Строка 103-108
if existing:
    # Update weight only! Context is IGNORED!
    existing.weight = int((existing.weight + (rel.weight / 10.0)) / 2)
    self.db.add(existing)
```

При обновлении существующей связи поле `context` (описание связи) **игнорируется**.

**Frontend (`RelationshipCard.tsx`):**
```typescript
// Строка 144
{edge.description && (
    <p className="...">"{edge.description}"</p>
)}
```

Компонент ожидает `edge.description`, но Backend сохраняет в `relationship_metadata.context`.

#### Рекомендация

**Backend fix:**
```python
if existing:
    existing.weight = int((existing.weight + (rel.weight / 10.0)) / 2)
    # FIX: Update context too!
    if rel.context and len(rel.context) > len(existing.relationship_metadata.get("context", "")):
        existing.relationship_metadata = {
            **existing.relationship_metadata,
            "context": rel.context
        }
    self.db.add(existing)
```

**Frontend fix:**
```typescript
// RelationshipCard.tsx - маппинг данных
const description = edge.description || edge.relationship_metadata?.context || null;
```

---

### 3.3 Проблема #3: Visual summary статичное

**Ожидаемое поведение:** Visual summary меняется по мере прогресса чтения (в начале книги герой в лохмотьях, в конце — в золотых доспехах).

**Текущее поведение:** Статичное, скудное содержимое — сохраняется только первое/самое длинное описание.

#### Локализация

| Компонент | Файл | Строки |
|-----------|------|--------|
| Entity upsert логика | `consistency_manager.py` | 163-168 |
| Batch resolve | `consistency_manager.py` | 120-204 |

#### Причина регрессии

```python
# consistency_manager.py:166-168
if len(raw.visual_summary) > len(entity.visual_summary or ""):
    entity.visual_summary = raw.visual_summary
    self.db.add(entity)
```

**Логика "Wiper":** При слиянии данных из разных глав система сохраняет только **самое длинное** описание, удаляя предыдущее. Эволюция персонажа уничтожается.

#### Рекомендация

**Архитектурное решение: Entity State Table**

Создать новую таблицу `EntityState`:
```sql
CREATE TABLE entity_state (
    id UUID PRIMARY KEY,
    entity_id UUID REFERENCES entity(id),
    chapter_range INT4RANGE,  -- [1, 10) - главы 1-9
    visual_summary TEXT,
    status VARCHAR(50),  -- "alive", "dead", "transformed"
    created_at TIMESTAMP
);
```

**Backend fix (временный):**
```python
# Аппендить вместо замены
if raw.visual_summary:
    current_summary = entity.visual_summary or ""
    if raw.visual_summary.lower() not in current_summary.lower():
        entity.visual_summary = f"{current_summary}\n\n[Глава {chapter_number}]: {raw.visual_summary}"
```

**Frontend fix:**
```typescript
// EntityProfile.tsx - разбивка по главам
const summaryParts = entity.visual_summary?.split(/\[Глава \d+\]:/).filter(Boolean);
```

---

### 3.4 Проблема #4: Мало сущностей и связей

**Ожидаемое поведение:** Много качественных сущностей и связей — полный граф знаний книги.

**Текущее поведение:** В разы меньше сущностей, качество хуже.

#### Локализация

Та же, что в проблеме #1 — ограничения в промптах.

#### Дополнительная причина

**optimize_book_entities (Reduce Phase):**
```python
# consistency_manager.py:369
"2. FILTER GARBAGE: Remove any entity with Importance < 3"
```

Reduce phase удаляет сущности с низким importance, даже если они были извлечены.

#### Рекомендация

1. Снять ограничение Importance < 3 в Reduce phase
2. Вместо удаления — понижать приоритет (soft filter)
3. Добавить конфигурацию `min_importance_for_display = 3` (на уровне API, не extraction)

---

### 3.5 Проблема #5: Нет информации о главе в карточках

**Ожидаемое поведение:** Карточка сущности показывает "Первое появление: Глава 5".

**Текущее поведение:** Информация о главе отсутствует.

#### Локализация

| Компонент | Файл | Проблема |
|-----------|------|----------|
| Entity mentions | `consistency_manager.py:54-69` | chapter_id сохраняется в EntityMention |
| Frontend EntityCard | `EntityCard.tsx` | Не отображает first_mention_chapter |
| Entity API response | `entities.py router` | Не включает chapter info |

#### Причина

Backend сохраняет `chapter_id` в `EntityMention`, но:
1. API endpoint `/entities/{book_id}/network` не join'ит chapters
2. Frontend не получает `first_mention_chapter`

#### Рекомендация

**Backend fix (API):**
```python
# В роутере entities.py
for entity in entities:
    first_mention = await db.scalar(
        select(EntityMention.chapter_id)
        .where(EntityMention.entity_id == entity.id)
        .order_by(EntityMention.start_index)
        .limit(1)
    )
    if first_mention:
        chapter = await db.get(Chapter, first_mention)
        entity_dict["first_mention_chapter"] = chapter.chapter_number if chapter else None
```

**Frontend fix:**
```typescript
// EntityCard.tsx
{entity.first_mention_chapter && (
    <p className="text-xs text-[var(--color-text-disabled)]">
        Появление: Глава {entity.first_mention_chapter}
    </p>
)}
```

---

### 3.6 Проблема #6: Баг защиты от спойлеров

**Ожидаемое поведение:** На последней странице книги все сущности и связи разблокированы.

**Текущее поведение:** Даже в конце книги есть заблокированные элементы.

#### Локализация

| Компонент | Файл | Проблема |
|-----------|------|----------|
| Entity visibility | `entityUtils.ts:19-31` | isEntityMetCFI логика |
| Relationship visibility | `RelationshipCard.tsx:28-51` | isRelationshipVisible логика |
| Entity aliases | `consistency_manager.py` | Алиасы не имеют reveal_chapter |

#### Причина регрессии

1. **Глобальная дедупликация:** Когда модель понимает, что "Незнакомец в плаще" (Гл. 1) и "Король Артур" (Гл. 50) — одно лицо, она сливает их в одну сущность.

2. **Проблема алиасов:** У сущности есть список `aliases: ["Незнакомец", "Король Артур"]`. Frontend получает весь список сразу — читатель на 1-й главе видит спойлер.

3. **CFI сравнение:** `first_mention_cfi` может быть `null`, тогда fallback на `mentions` массив, который тоже может быть пустым.

```typescript
// entityUtils.ts:9-11
if (mentions.length === 0) {
    return true;  // BUG: Показывает сущность без проверки
}
```

#### Рекомендация

**1. Alias с reveal_chapter:**
```python
# Entity metadata structure
entity_metadata = {
    "aliases": [
        {"name": "Незнакомец", "reveal_chapter": 1},
        {"name": "Король Артур", "reveal_chapter": 50}
    ]
}
```

**2. Frontend fix:**
```typescript
// entityUtils.ts
export const isEntityMetCFI = (
    entity: EntityDetail,
    currentCFI: string | null,
    currentChapter?: number
): boolean => {
    if (!entity) return false;
    
    // Если нет mentions и нет first_mention_cfi — показываем (legacy data)
    const mentions = entity.mentions || [];
    const hasCFI = isValidCFI(entity.first_mention_cfi);
    
    if (mentions.length === 0 && !hasCFI) {
        // Check entity metadata for first chapter
        const metaChapter = entity.entity_metadata?.first_mention_chapter;
        if (metaChapter != null) {
            return (currentChapter ?? 0) >= metaChapter;
        }
        return true; // Legacy: no spoiler protection data
    }
    
    // ... rest of logic
};
```

**3. API response с фильтрацией алиасов:**
```python
# В API endpoint
filtered_aliases = [
    alias for alias in entity.aliases
    if alias.get("reveal_chapter", 0) <= current_chapter
]
```

---

### 3.7 Проблема #7: Текст описаний не совпадает с БД

**Ожидаемое поведение:** Подсвеченный текст в читалке = текст описания в БД.

**Текущее поведение:** Текст выделенных описаний не совпадает с тем, что хранится в БД.

#### Локализация

| Компонент | Файл | Проблема |
|-----------|------|----------|
| TSA парсинг | `gemini_extractor.py:747-782` | Offset расхождения |
| Highlight matching | `useDescriptionHighlighting.ts:61-64` | Fuzzy matching strategies |
| Text normalization | `text-search/normalization.ts` | Агрессивная нормализация |

#### Причина

1. **TSA offset drift:** При чанкинге с overlap (15%) позиции могут сдвигаться.
2. **Fuzzy matching:** Frontend использует стратегии поиска, которые могут находить похожий, но не идентичный текст.
3. **Normalization:** `removeChapterHeaders()` может удалять часть текста.

```typescript
// useDescriptionHighlighting.ts:28-45
const preprocessDescription = (desc: Description): SearchPatterns => {
    const content = desc.text || desc.content || '';  // Может быть разным
    const clean = removeChapterHeaders(content);      // Модификация текста
    const norm = normalizeText(clean);                // Ещё модификация
    // ...
};
```

#### Рекомендация

**1. Сохранять original_text отдельно от display_text:**
```python
# Description model
class Description:
    content: str  # Original from book
    display_text: str  # Possibly cleaned for display
    start_offset: int
    end_offset: int
```

**2. Frontend — strict matching first:**
```typescript
// strategies.ts - добавить strict match первой стратегией
export const strategies = [
    { name: 'exact', fn: (text, patterns) => text.includes(patterns.original) },
    { name: 'normalized', fn: (text, patterns) => ... },
    // ... fuzzy strategies last
];
```

**3. Валидация при сохранении:**
```python
# book_tasks.py - перед сохранением Description
if description.content not in chapter.content:
    logger.warning(f"Description content mismatch, attempting fuzzy fix")
    # Try to find correct span in chapter
```

---

## 4. Исследование лучших практик (Web Research, январь 2026)

> **Методология:** Данные получены через веб-поиск (Exa, Google Search), GitHub Code Search, официальную документацию Google AI/Vertex AI.

### 4.1 Gemini 2.5/3 — Structured Output Best Practices

**Источники:**
- [Google Blog: Improving Structured Outputs (Nov 2025)](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-structured-outputs/)
- [ai.google.dev/gemini-api/docs/structured-output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Firebase Vertex AI Docs](https://firebase.google.com/docs/ai-logic/generate-structured-output)

#### Ключевые рекомендации (2025-2026)

| Практика | Описание | Применимость к fancai |
|----------|----------|----------------------|
| **JSON Schema enforcement** | Использовать `response_schema=PydanticModel` для гарантированного JSON | ✅ Уже реализовано |
| **response_mime_type** | Обязательно `application/json` для structured output | ✅ Уже реализовано |
| **Field descriptions** | Добавлять `description` в Pydantic Field — Gemini читает их как инструкции | ⚠️ Частично |
| **Enum constraints** | Использовать `typing.Literal` для категорий (type: character\|location\|object) | ✅ Уже реализовано |
| **Property ordering** | Gemini 2.5+ сохраняет порядок ключей из схемы | ✅ Авто |
| **Schema Chaining** | Для 100k+ токенов: Pass 1 = raw extraction → Pass 2 = structured parsing | 🆕 Рекомендуется |

#### Что изменить в fancai

```python
# ТЕКУЩЕЕ (gemini_extractor.py)
class GeminiEntitySchema(BaseModel):
    name: str = Field(description="Имя сущности")
    visual_summary: str = Field(default="", description="Визуальное описание для художника")

# РЕКОМЕНДУЕМОЕ (с Quality Gate в description)
class GeminiEntitySchema(BaseModel):
    name: str = Field(description="Имя сущности. Полное имя, не сокращённое.")
    visual_summary: str = Field(
        default="", 
        min_length=100,
        description="ОБЯЗАТЕЛЬНО минимум 100 символов. Детальное визуальное описание: лицо, волосы, одежда, возраст, особые приметы."
    )
```

### 4.2 Imagen 3/4 — Prompt Engineering Guidelines

**Источники:**
- [Vertex AI Prompt Guide](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/img-gen-prompt-guide)
- [Imagen 4 Complete Prompt Guide (gpt4oimageprompt.com)](https://gpt4oimageprompt.com/pages/blog/imagen-4-complete-prompt-guide.html)
- [Google Developers Blog: Imagen 3 on Vertex AI](https://cloud.google.com/blog/products/ai-machine-learning/a-developers-guide-to-imagen-3-on-vertex-ai)

#### Оптимальная структура промпта для портретов

```
[Subject] + [Action/Pose] + [Environment/Context] + [Lighting/Mood] + [Art Style/Camera Technicals]
```

**Пример для персонажа:**
```
A cinematic close-up portrait of a weathered warrior in her late 30s 
with sharp features, freckles across her nose, and braided auburn hair. 
She wears a heavy wool cloak over silver-filigree breastplate. 
Low-key lighting with vibrant rim lighting. Shot on 65mm film, grainy texture.
```

#### Рекомендации для character portraits

| Аспект | Рекомендация | Текущее в fancai |
|--------|--------------|------------------|
| **Минимальная длина** | 150-300 символов для качественной генерации | ❌ 50 символов |
| **Физические детали** | "sharp features, freckles, braided hair" — конкретика | ⚠️ Часто абстрактно |
| **Слово "portrait"** | Включать для фокуса на лице | ❌ Не используется |
| **Lens/Camera terms** | "85mm lens, f/1.4 aperture, soft natural light" | ❌ Не используется |
| **Anchor для консистентности** | Уникальная деталь: "circular neon-blue tattoo on left temple" | ⚠️ Нет seed anchors |
| **Избегать негативных промптов** | Imagen 3+ лучше понимает что ЕСТЬ, не что НЕТ | ✅ Не используем |

#### Что изменить в fancai

```python
# ТЕКУЩЕЕ (consistency_manager.py:287-291)
style_prompt = "Masterpiece portrait, character concept art, high detail, neutral background"

# РЕКОМЕНДУЕМОЕ (с camera technicals)
style_prompt = """Cinematic close-up portrait, 85mm lens, f/2.8 aperture, 
soft diffused lighting, professional studio setup, highly detailed skin texture, 
sharp focus on eyes, neutral gradient background"""
```

### 4.3 Literary NER — Специализированные подходы

**Источники:**
- [LitBank Dataset (UC Berkeley)](https://people.ischool.berkeley.edu/~dbamman/pubs/pdf/naacl2019_literary_entities.pdf)
- [BookNLP Pipeline (GitHub: DBamman/BookNLP)](https://github.com/dbamman/booknlp)
- [FABLE: Fiction Adapted BERT for Literary Entities (SaladCloud)](https://blog.salad.com/fable/)
- [BERT meets d'Artagnan (HAL Science)](https://hal.science/hal-03617722v2)

#### Ключевые insights из академических исследований

| Исследование | Findings | Применимость |
|--------------|----------|--------------|
| **LitBank (2019)** | Literary NER dataset: 210k токенов, 100 текстов. Акцент на PER, LOC, FAC. Nested entities ("[[the cook]'s sister"). | Наши промпты не обрабатывают nested entities |
| **BookNLP (2020-2025)** | Gold standard для character extraction: NER + Coreference + Quote Attribution. Transformer-based. | Можно использовать для пост-обработки |
| **FABLE (2025)** | DeBERTa v3, fine-tuned на 1B words fiction. Tracks: Characters, Locations, Objects. | Альтернатива Gemini для NER слоя |
| **Character Networks Survey** | Stylistic differences in literary prose significantly affect NER performance | Подтверждает необходимость literary-specific промптов |

#### BookNLP как альтернативный пайплайн

```python
# BookNLP использует coreference resolution для объединения:
# "Mr. Darcy" + "Fitzwilliam" + "he" → COREF_ID: 1

# Рекомендация: Использовать BookNLP для BASELINE entity extraction,
# затем Gemini для visual_summary enrichment

from booknlp.booknlp import BookNLP
booknlp = BookNLP("en", {"pipeline": "entity,quote,coref", "model": "big"})
booknlp.process(book_text, output_dir, book_id)
# Output: entities с COREF_ID, quotes с speaker attribution
```

#### Что изменить в fancai

1. **Добавить few-shot examples в промпт** — показать примеры "хорошего" извлечения
2. **Обрабатывать nested entities** — "[[the cook]'s sister]" → две сущности
3. **Рассмотреть BookNLP для Phase 1** — NER + Coreference, затем Gemini для визуальных описаний

### 4.4 Real-World GitHub Examples

**Источники:**
- [GoogleCloudPlatform/generative-ai](https://github.com/GoogleCloudPlatform/generative-ai/blob/main/search/auto-rag-eval/llm_utils.py)
- [google-gemini/deprecated-generative-ai-python](https://github.com/google-gemini/deprecated-generative-ai-python/blob/main/samples/controlled_generation.py)
- [khoj-ai/khoj](https://github.com/khoj-ai/khoj/blob/master/src/khoj/routers/helpers.py)

#### Паттерн: Structured Output с Pydantic

```python
# Google official sample (controlled_generation.py)
class Recipe(typing.TypedDict):
    name: str
    ingredients: list[str]

model = genai.GenerativeModel("gemini-1.5-pro-latest")
result = model.generate_content(
    "List a few popular cookie recipes.",
    generation_config=genai.GenerationConfig(
        response_mime_type="application/json", 
        response_schema=list[Recipe]
    ),
)
```

#### Паттерн: Entity Extraction Pipeline (Story Ribbons, arXiv 2025)

```
1. Split chapters into scenes
2. LLM extracts characters, sentiment, direct quote
3. Correction loop for hallucinated quotes
4. Second LLM groups duplicates ("Jane" == "Jane Bennet")
5. Output structured JSON
```

### 4.5 Современные техники Prompt Engineering

**Источники:**
- [promptbuilder.cc/blog/prompt-engineering-best-practices-2025](https://promptbuilder.cc/blog/prompt-engineering-best-practices-2025/)
- [Gemini Prompt Engineering: Structured Outputs Guide (i10x.ai)](https://i10x.ai/news/gemini-prompt-engineering-structured-outputs)
- [Google Developers: LangExtract Library](https://developers.googleblog.com/en/introducing-langextract-a-gemini-powered-information-extraction-library/)

#### Чеклист для extraction промптов

| Техника | Описание | Реализовано? |
|---------|----------|--------------|
| **TASK-CONTEXT-OUTPUT** | Трёхчастная структура промпта | ✅ Есть |
| **Negative examples** | "НЕ извлекай: 'Он был высоким' (слишком коротко)" | ❌ Нет |
| **Length constraints** | "Минимум 150 символов для descriptions" | ❌ Только в валидации, не в промпте |
| **Quality gates** | "Если описание < 100 символов, расширь его деталями" | ❌ Нет |
| **Few-shot examples** | 2-3 примера идеального извлечения | ❌ Нет |
| **Self-correction** | "Проверь: все ли описания > 150 chars?" | ❌ Нет |
| **Task decomposition** | Разбить на под-задачи вместо одного большого промпта | ⚠️ Частично (TSA) |

#### Рекомендуемый шаблон промпта (2025 standard)

```python
EXTRACTION_PROMPT_V3 = """
## TASK
Извлеки визуально значимые сущности из художественного текста.

## CONTEXT
Ты - литературный архивариус и арт-директор для экранизации.
Результаты будут использованы для генерации иллюстраций через Imagen 4.

## OUTPUT REQUIREMENTS
1. Сущности с visual_summary МИНИМУМ 100 символов
2. Описания МИНИМУМ 150 символов
3. Позиции (text_offset) для точной привязки к тексту

## EXAMPLES

### ХОРОШИЙ пример сущности:
{{
  "name": "Геральт",
  "type": "character",
  "visual_summary": "Высокий мужчина с пепельно-белыми волосами до плеч, завязанными в хвост. Глубоко посаженные янтарные глаза с вертикальными зрачками. Шрам пересекает левую бровь. Носит потёртую кожаную куртку поверх кольчуги.",
  "aliases": ["Белый Волк", "Ведьмак", "Мясник из Блавикена"],
  "importance": 10
}}

### ПЛОХОЙ пример (НЕ извлекай так):
{{
  "name": "Геральт",
  "visual_summary": "Высокий мужчина с белыми волосами",  // ❌ Слишком коротко!
  "aliases": [],  // ❌ Потеряны важные алиасы
  "importance": 5  // ❌ Занижена важность главного героя
}}

## INPUT TEXT
{text}
"""
```

### 4.6 Сравнение текущих промптов с best practices

| Аспект | Best Practice | Текущее в fancai | Рекомендация |
|--------|---------------|------------------|--------------|
| **Entity limits** | "Извлекай ВСЕ визуально значимые" | "Top-15 для сюжета" | ❌ Убрать ограничение |
| **Importance filter** | "Importance влияет на приоритет генерации, не на извлечение" | "1-6: ИГНОРИРОВАТЬ" | ❌ Убрать барьер |
| **min_description_chars** | 150-300 для Imagen 4 | 50 | ❌ Увеличить до 150 |
| **Few-shot examples** | 2-3 примера в промпте | Нет | ❌ Добавить |
| **Negative examples** | Показать что НЕ извлекать | Нет | ❌ Добавить |
| **Quality gates** | Self-correction step | Нет | ❌ Добавить |
| **Portrait keywords** | "portrait", "85mm lens" | Нет | ❌ Добавить в master ref генерацию |

---

## 5. Сводная таблица рекомендаций

| # | Проблема | Файл | Изменение | Приоритет |
|---|----------|------|-----------|-----------|
| 1 | Мало описаний | `gemini_extractor.py` | Убрать Top-15, Importance<7 | **P0** |
| 1 | Короткие описания | `gemini_extractor.py:199` | `min_description_chars = 150` | **P0** |
| 2 | Нет context в связях | `consistency_manager.py:103-108` | Обновлять context при merge | **P1** |
| 2 | Нет description в edge | `RelationshipCard.tsx:144` | Маппинг из metadata.context | **P1** |
| 3 | Статичный visual_summary | `consistency_manager.py:166` | Append вместо replace | **P1** |
| 4 | Мало сущностей | `gemini_extractor.py` | Те же правки промпта | **P0** |
| 5 | Нет главы в карточке | `entities.py` + `EntityCard.tsx` | Добавить first_mention_chapter | **P2** |
| 6 | Спойлеры алиасов | `consistency_manager.py` | reveal_chapter для aliases | **P1** |
| 6 | mentions пустой | `entityUtils.ts:9-11` | Проверка metadata.first_mention | **P1** |
| 7 | Offset mismatch | `gemini_extractor.py` | Валидация при сохранении | **P2** |
| 7 | Fuzzy matching | `useDescriptionHighlighting.ts` | Strict match первым | **P2** |

---

## 6. Улучшенные промпты

### 6.1 TSA_EXTRACTION_PROMPT_V2

```python
TSA_EXTRACTION_PROMPT_V2 = """Ты - литературный архивариус и арт-директор для экранизации.

ЗАДАЧА:
1. Верни ОРИГИНАЛЬНЫЙ текст с XML-тегами вокруг визуальных описаний
2. Формат: <desc type="TYPE" occurrence="N">точный текст</desc>
3. TYPE = location | character | object | atmosphere

КРИТЕРИИ ОПИСАНИЙ (ОБЯЗАТЕЛЬНЫЕ):
- Минимум 150 символов (короче — НЕ ИЗВЛЕКАЙ)
- Создаёт конкретный визуальный образ
- Подходит для иллюстрации

НЕГАТИВНЫЕ ПРИМЕРЫ (НЕ извлекать):
- "Комната была большой" (слишком абстрактно)
- "Он был высоким" (нет деталей)
- "Меч блестел" (слишком коротко)

ПОЗИТИВНЫЕ ПРИМЕРЫ (извлекать):
- "Комната была тёмной и пыльной, с высокими сводчатыми потолками, украшенными выцветшими фресками..."
- "Воин был высок и худощав, с глубоко посаженными серыми глазами и шрамом, пересекающим левую бровь..."

ТАКЖЕ ВЫДЕЛИ:
1. ВСЕ визуально значимые персонажи (не только главные!)
   - visual_summary минимум 100 символов
   - aliases (все альтернативные имена)
   - importance 1-10

2. ВСЕ описанные локации

3. Сюжетно важные объекты (артефакты, не обычные вещи)

4. СВЯЗИ между сущностями:
   - type: KINSHIP | ROMANCE | RIVALRY | ALLIANCE | HIERARCHY | NEMESIS
   - context: ОБЯЗАТЕЛЬНО укажи причину и эмоциональный окрас
   - Пример: "RIVALRY. Соперничают за трон. Внешне союзники, но строят козни."

Текст для анализа:
{text}
"""
```

### 6.2 REDUCE_PROMPT_V2

```python
REDUCE_PROMPT_V2 = """
Ты - редактор базы знаний. Оптимизируй список сущностей.

ЗАДАЧА:
1. СЛЕЙ ДУБЛИКАТЫ: "Harry" = "Harry Potter" = "Mr. Potter"
   - Сохрани ВСЕ имена как aliases
   - Сохрани САМОЕ ДЛИННОЕ visual_summary

2. НЕ УДАЛЯЙ сущности с низким importance!
   - Importance влияет только на приоритет генерации портретов
   - Все извлечённые сущности важны для атмосферы

3. Результат — список операций слияния.

Output JSON:
{{
    "merge_operations": [
        {{ "keep_id": "uuid", "merge_ids": ["uuid", "uuid"], "combined_aliases": ["name1", "name2"] }}
    ]
}}

НЕ ВКЛЮЧАЙ delete_operations — мы не удаляем сущности!
"""
```

---

## 7. План внедрения изменений

### Фаза 1: Критические исправления (P0) — 1-2 дня

1. [ ] Обновить `EXTRACTION_PROMPT` — убрать Top-15 и Importance<7
2. [ ] Изменить `min_description_chars` с 50 на 150
3. [ ] Добавить `min_visual_summary_chars = 100`
4. [ ] Обновить `TSA_EXTRACTION_PROMPT` — новая версия

### Фаза 2: Исправление данных (P1) — 2-3 дня

1. [ ] Fix `_process_relationships` — обновлять context
2. [ ] Fix `_batch_resolve_entities` — append visual_summary
3. [ ] Добавить reveal_chapter в aliases
4. [ ] Frontend: маппинг edge.description из metadata

### Фаза 3: Улучшения UX (P2) — 1-2 дня

1. [ ] API: добавить first_mention_chapter в entity response
2. [ ] Frontend: отображать главу в EntityCard
3. [ ] Strict match первым в highlighting strategies
4. [ ] Валидация offset при сохранении

### Фаза 4: Архитектурные улучшения (P3) — будущее

1. [ ] Таблица EntityState для эволюции персонажей
2. [ ] Расширенная таксономия связей
3. [ ] Graph visualization (D3.js)

---

## 8. Метрики успеха

### Количественные метрики

| Метрика | Было | Цель | Как измерить |
|---------|------|------|--------------|
| Описаний на главу | 2-5 | 10-20 | `SELECT AVG(descriptions_found) FROM chapter` |
| Средняя длина описания | 80 chars | 200+ chars | `SELECT AVG(LENGTH(content)) FROM description` |
| Сущностей на книгу | 10-15 | 50-100 | `SELECT COUNT(*) FROM entity WHERE book_id=X` |
| Связей на книгу | 5-10 | 30-50 | `SELECT COUNT(*) FROM entity_relationship` |
| visual_summary > 100 chars | 30% | 80% | SQL query |

### Качественные метрики

1. **Тест спойлеров:** Открыть книгу на последней странице → все карточки разблокированы
2. **Тест описаний:** Клик на подсветку → текст в модалке = подсвеченный текст
3. **Тест Imagen:** Сгенерировать изображение → визуально соответствует описанию

### Команды для проверки

```sql
-- Количество описаний
SELECT book_id, COUNT(*) as desc_count, AVG(LENGTH(content)) as avg_len
FROM description
GROUP BY book_id;

-- Сущности с пустым visual_summary
SELECT COUNT(*) FROM entity WHERE visual_summary IS NULL OR LENGTH(visual_summary) < 50;

-- Связи без context
SELECT COUNT(*) FROM entity_relationship 
WHERE relationship_metadata->>'context' IS NULL OR relationship_metadata->>'context' = '';
```

---

## Приложение A: Архитектурная диаграмма (текущая)

```
┌─────────────────────────────────────────────────────────────────┐
│                     BOOK PROCESSING PIPELINE                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Upload] ──► [BookParser] ──► [DB: Book + Chapters]            │
│                                        │                        │
│                                        ▼                        │
│  [process_book_task] ◄──── [Celery Queue]                       │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────┐                │
│  │           PARALLEL CHAPTER PROCESSING        │                │
│  │  (Semaphore=10, per chunk Semaphore=3)      │                │
│  │                                              │                │
│  │  [Chapter 1] ──► [GeminiExtractor] ──►      │                │
│  │  [Chapter 2] ──► [GeminiExtractor] ──►      │                │
│  │  [Chapter N] ──► [GeminiExtractor] ──►      │                │
│  └─────────────────────────────────────────────┘                │
│                          │                                      │
│                          ▼                                      │
│  [ConsistencyManager.process_chapter_analysis]                  │
│         │                                                       │
│         ├──► [Entity Resolution] ──► DB: Entity                 │
│         ├──► [EntityMention] ──► DB: EntityMention              │
│         └──► [Relationships] ──► DB: EntityRelationship         │
│                                                                 │
│                          ▼                                      │
│  [Reduce Phase: optimize_book_entities]                         │
│  [Graph Phase: calculate_pagerank]                              │
│  [Portrait Phase: generate_master_references]                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Приложение B: Таксономия связей (расширенная)

| Категория | Backend Types | Frontend Label | Цвет | Иконка |
|-----------|---------------|----------------|------|--------|
| **Родство** | PARENT, CHILD, SIBLING, SPOUSE | Семья | Purple | Users |
| **Романтика** | LOVER, CRUSH, EX_PARTNER | Романтика | Pink | Heart |
| **Конфликт** | ENEMY, RIVAL, KILLER, VICTIM | Вражда | Red | Swords |
| **Альянс** | FRIEND, ALLY, COMPANION | Союз | Green | Heart |
| **Иерархия** | MASTER, SERVANT, MENTOR, STUDENT | Власть | Blue | Users |
| **Сюжет** | BETRAYED, SAVED, CAPTURED | Действие | Orange | Zap |

---

*Документ создан на основе анализа кодовой базы fancai v4.0 (31 января 2026)*
