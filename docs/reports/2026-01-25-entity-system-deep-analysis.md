# Глубокий анализ системы сущностей (Entity System)

**Дата:** 2026-01-25  
**Автор:** Claude Code (OpenCode)  
**Scope:** Комплексная экспертиза Backend + Frontend + DB + UX  
**Статус:** Требуется фундаментальный рефакторинг

---

## Executive Summary

Система карточек сущностей в fancai имеет **фундаментальные архитектурные проблемы**, заложенные на этапе проектирования. Текущая реализация:

1. **Не использует CFI** для спойлер-защиты (только номер главы)
2. **Создаёт дубликаты** на уровне Gemini extraction и недостаточно дедуплицирует
3. **Теряет данные** при парсинге `entities_mentioned` (CSV/JSON/List смешение)
4. **Игнорирует importance** — фильтрация по важности не работает корректно
5. **UI не масштабируется** — нет поиска, фильтрации, пагинации

**Оценка текущего состояния: 4/10**

### Ключевая проблема

```
ТЕКУЩИЙ FLOW:
Gemini → ExtractedEntity → Entity (DB) → EntityMention → entity_service → Frontend

ПРОБЛЕМА: Нет связи Description ↔ Entity на уровне БД
```

Описания (`descriptions` таблица) и сущности (`entities` таблица) связаны только через JSON поле `entities_mentioned` — это **антипаттерн**, который приводит к:
- Потере данных при парсинге
- Невозможности точной привязки к CFI
- Дубликатам

---

## 1. Бизнес-контекст

### 1.1 Цель системы

**Зачем нужны карточки сущностей:**
1. **Справочник персонажей** — читатель забыл кто такой "Лорд Кастамер" на 300-й странице
2. **Визуализация отношений** — граф связей между персонажами
3. **Консистентность AI-изображений** — один и тот же персонаж должен выглядеть одинаково
4. **Спойлер-защита** — не показывать "Дамблдор умирает" до нужного момента

### 1.2 Текущие сценарии использования

| Сценарий | Работает? | Проблема |
|----------|-----------|----------|
| Просмотр списка персонажей | Частично | Дубликаты, нет фильтрации |
| Профиль персонажа | Частично | Notes не привязаны к CFI |
| Спойлер-защита по главе | Частично | mentions[] может быть пустым |
| Граф связей | Минимально | Связи не визуализированы |
| Master Portrait генерация | Не работает | importance не заполняется |

### 1.3 Ожидания пользователя vs Реальность

| Ожидание | Реальность |
|----------|------------|
| Открываю drawer → вижу персонажей текущей главы | Вижу ВСЕ персонажи книги, многие заблокированы |
| Клик на персонажа → его история до текущего момента | История может содержать спойлеры (notes без CFI) |
| Персонаж один раз = одна карточка | "Геральт", "Белый Волк", "Ведьмак" — 3 карточки |
| Быстрая загрузка | 1-3 секунды даже с кэшем |

---

## 2. Архитектурный анализ

### 2.1 Data Flow (текущий)

```
┌─────────────────────────────────────────────────────────────────┐
│                     КНИГА ЗАГРУЖЕНА                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Celery Task: process_book                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  FOR each chapter:                                      │    │
│  │    1. gemini_extractor.analyze_chapter(text)            │    │
│  │       └─> descriptions[], entities[], relationships[]   │    │
│  │                                                         │    │
│  │    2. Save descriptions to DB (entities_mentioned=JSON) │    │
│  │                                                         │    │
│  │    3. consistency_manager.process_chapter_analysis()    │    │
│  │       └─> Upsert Entity                                 │    │
│  │       └─> Create EntityMention (Hard Link)              │    │
│  │       └─> Create EntityRelationship                     │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  API: GET /books/{id}/entities/network                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  entity_service.get_book_entity_network()               │    │
│  │    1. Load all Entity for book                          │    │
│  │    2. Load all Description for book                     │    │
│  │    3. Load EntityMention (Hard Links)                   │    │
│  │    4. Parse entities_mentioned (JSON/CSV) ← ПРОБЛЕМА!   │    │
│  │    5. Soft Merge дубликатов                             │    │
│  │    6. Build EntityDetailSchema with mentions[]          │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Frontend: useEntityNetwork(bookId)                             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  1. Fetch entityNetwork                                 │    │
│  │  2. entityUtils.isEntityMet(entity, currentChapter)     │    │
│  │     └─> Math.min(...entity.mentions) <= currentChapter  │    │
│  │  3. Render EntityDrawer/EntityProfile                   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Проблемы архитектуры

#### ПРОБЛЕМА 1: Двойное хранение связей Entity↔Description

```sql
-- Description хранит entities_mentioned как TEXT/JSON
descriptions.entities_mentioned = '["Геральт", "Йеннифэр"]'

-- Но EntityMention хранит ту же связь как foreign key
entity_mentions.entity_id → entities.id
entity_mentions.chapter_id → chapters.id
```

**Следствие:** Данные рассинхронизированы. `entities_mentioned` парсится как JSON, но может быть CSV. `EntityMention` создаётся отдельно и может не совпадать.

#### ПРОБЛЕМА 2: Нет связи Description↔Entity на уровне FK

```
ТЕКУЩАЯ СХЕМА:
descriptions --X-- entities (нет FK!)

ДОЛЖНО БЫТЬ:
descriptions --M:N-- description_entities --M:N-- entities
```

Сейчас связь только через `entities_mentioned` (текст) и `EntityMention` (chapter-level), но нет **прямой связи** "это описание относится к этой сущности".

#### ПРОБЛЕМА 3: mentions[] = chapter numbers, не CFI

```typescript
// Frontend
const isMet = entity.mentions.length === 0 
  ? true  // Fail-open
  : Math.min(...entity.mentions) <= currentChapter;
```

Используется **номер главы**, а не **CFI позиция**. Это грубая защита — если персонаж появляется в главе 5, он виден после входа в главу 5, даже если пользователь на первом абзаце.

#### ПРОБЛЕМА 4: Gemini возвращает дубликаты

```python
# gemini_extractor.py - _deduplicate_entities
# Использует SequenceMatcher с порогом 0.85
# НО: "Геральт из Ривии" vs "Геральт" = 0.66 — НЕ мержатся!
```

Дедупликация на уровне экстракции слишком слабая. А `entity_service._build_network_response` мержит по точному совпадению `_normalize_name`.

### 2.3 Database Schema Issues

```
entities
├── id (UUID, PK)
├── book_id (FK → books.id)
├── type (VARCHAR) ← НЕ ENUM!
├── name (VARCHAR)
├── visual_summary (TEXT)
├── importance (INT) ← часто NULL или 5 (default)
├── master_portrait_url ← почти всегда NULL
└── seed ← почти всегда NULL

entity_mentions
├── id (UUID, PK)
├── chapter_id (FK)
├── entity_id (FK)
├── mention_text (VARCHAR)
├── context (TEXT) ← почти всегда NULL
├── start_index (INT) ← почти всегда NULL
└── end_index (INT) ← почти всегда NULL

entity_relationships
├── source_id (FK)
├── target_id (FK)
├── type (VARCHAR) ← должен быть ENUM
├── weight (INT) ← нормализация 0-1 vs 1-10 путаница
└── relationship_metadata (JSONB)
```

**Проблемы:**
1. `entity.type` — VARCHAR вместо ENUM
2. `importance` — почти всегда 5 (default), Gemini не заполняет корректно
3. `start_index/end_index` — всегда NULL (не используется CFI)
4. Нет индекса `(book_id, name)` для быстрого поиска дубликатов

---

## 3. Анализ компонентов

### 3.1 Backend

#### gemini_extractor.py (765 LOC)

| Аспект | Оценка | Комментарий |
|--------|--------|-------------|
| Structured Output | 8/10 | Правильно использует Pydantic schema |
| Chunking | 7/10 | RecursiveTextChunker работает |
| Deduplication | 3/10 | SequenceMatcher слишком слабый |
| Importance extraction | 2/10 | Промпт просит 1-10, но результат игнорируется |
| CFI support | 0/10 | Нет position tracking |

**Критичный баг в промпте:**
```python
EXTRACTION_PROMPT = """...
3. Для каждой сущности дай "visual_summary"...
4. Определи СВЯЗИ между сущностями...
5. Выдели ОПИСАТЕЛЬНЫЕ ФРАГМЕНТЫ (descriptions) длиннее 100 символов.
...
"""
# Промпт НЕ запрашивает позицию описания в тексте!
# Gemini не знает где именно в тексте находится описание
```

#### entity_service.py (265 LOC)

| Аспект | Оценка | Комментарий |
|--------|--------|-------------|
| Caching | 8/10 | Redis cache 1 hour, версионирование ключа |
| Soft Merge | 5/10 | Работает только для точных совпадений имён |
| Hard Mentions | 6/10 | EntityMention используется, но без CFI |
| JSON parsing | 2/10 | 4 варианта формата (JSON list, JSON dict, CSV, empty) |
| Performance | 4/10 | N+1 запросы в _create_merged_detail |

**Критичный код:**
```python
# entity_service.py:120-143
try:
    parsed = json.loads(d.entities_mentioned)
    if isinstance(parsed, list):
        mentioned_names = parsed
    elif isinstance(parsed, dict):
        mentioned_names = [parsed.get("name")] if parsed.get("name") else []
except json.JSONDecodeError:
    if d.entities_mentioned:
        mentioned_names = [x.strip() for x in d.entities_mentioned.split(",") if x.strip()]
```

Это **4 разных формата данных** в одном поле! Результат непредсказуем.

#### consistency_manager.py (444 LOC)

| Аспект | Оценка | Комментарий |
|--------|--------|-------------|
| Batch resolution | 7/10 | Одним запросом загружает существующие |
| Entity upsert | 6/10 | Обновляет visual_summary если длиннее |
| Relationship processing | 5/10 | Нормализация weight неконсистентна |
| Master reference gen | 2/10 | Почти не вызывается, importance < 7 |
| optimize_book_entities | 1/10 | LLM Reduce не тестирован, опасен |

### 3.2 Frontend

#### EntityDrawer.tsx (171 LOC)

| Аспект | Оценка | Комментарий |
|--------|--------|-------------|
| Component structure | 4/10 | Монолит, inline map |
| Navigation logic | 3/10 | useNavigate + useParams внутри drawer |
| Spoiler logic | 5/10 | isEntityMet централизован, но грубый |
| Styling | 4/10 | Hardcoded #0a0a0a |
| Accessibility | 2/10 | Нет ARIA, нет keyboard nav |

#### EntityProfile.tsx (168 LOC)

| Аспект | Оценка | Комментарий |
|--------|--------|-------------|
| Hero section | 6/10 | Визуально приемлемо |
| Relationships display | 5/10 | Работает, но без визуализации графа |
| Notes/History | 4/10 | SpoilerText по chapter_index, не CFI |
| Responsiveness | 5/10 | scroll bug был исправлен |
| Error handling | 2/10 | Нет обработки undefined notes |

#### entityUtils.ts (55 LOC)

| Аспект | Оценка | Комментарий |
|--------|--------|-------------|
| isEntityMet | 6/10 | Логика правильная, но грубая |
| Fail-open | 7/10 | Правильное решение для пустых mentions |
| getFirstMeetingChapter | 7/10 | Работает |
| CFI support | 0/10 | Не реализовано |

### 3.3 UX/UI Issues

| Проблема | Серьёзность | Описание |
|----------|-------------|----------|
| Нет поиска | P2 | При 50+ персонажах невозможно найти нужного |
| Нет фильтрации по главе | P1 | "Покажи только персонажей главы 5" |
| Нет визуализации графа | P3 | Связи показаны списком, не графом |
| Загрузка без skeleton | P3 | Пустой экран 1-2 секунды |
| Дубликаты видны | P1 | "Гарри" и "Гарри Поттер" — две карточки |
| Пустая галерея | P1 | Если extraction failed — "Персонажи не найдены" |

---

## 4. Фундаментальные проблемы

### 4.1 Проблема спойлеров (КРИТИЧНАЯ)

**Текущая логика:**
```typescript
// entityUtils.ts
const firstMeeting = Math.min(...mentions); // Номер главы
return currentChapter >= firstMeeting;
```

**Почему это плохо:**
1. Если пользователь на главе 5, абзац 1 — он видит ВСЕ сущности главы 5
2. Персонаж может быть "убит" в конце главы 5 — это спойлер!
3. Notes привязаны к `chapter_index`, не к позиции в тексте

**Что нужно:**
```typescript
// Идеальная логика
const firstMentionCFI = entity.first_mention_cfi; // "epubcfi(/6/4!/4/2/1:0)"
const currentCFI = reader.location.start.cfi;
const isMet = compareCFI(firstMentionCFI, currentCFI) <= 0;
```

### 4.2 Проблема дубликатов (КРИТИЧНАЯ)

**Источники дубликатов:**
1. **Gemini** возвращает "Гарри" и "Гарри Поттер" как разные entities
2. **Chunk overlap** — один персонаж в двух чанках = два ExtractedEntity
3. **Слабая дедупликация** — SequenceMatcher 0.85 не ловит "Белый Волк" vs "Геральт"

**Текущий workaround (entity_service.py):**
```python
# Soft Merge по нормализованному имени
norm_name = name.lower().strip().replace("ё", "е")
```

**Почему не работает:**
- "Геральт" и "Геральт из Ривии" — разные norm_name
- Aliases хранятся в `entity_metadata`, но не используются при merge

### 4.3 Проблема отсутствия данных

**Почему `mentions[]` может быть пустым:**
1. `EntityMention` не создан (ошибка в consistency_manager)
2. `entities_mentioned` не распарсился (JSON error)
3. Entity создан, но chapter_id не передан в `process_chapter_analysis`

**Текущий workaround (entityUtils.ts):**
```typescript
if (mentions.length === 0) {
  return true; // Fail-open: показываем сущность
}
```

Это **скрывает баг**, а не решает его.

---

## 5. План рефакторинга

### Фаза 0: Стабилизация (Hotfix)
**Приоритет:** P0  
**Оценка:** 2-4 часа

| Задача | Описание |
|--------|----------|
| 0.1 | Добавить логирование в entity_service для отладки пустых mentions |
| 0.2 | Исправить JSON parsing — унифицировать формат entities_mentioned |
| 0.3 | Добавить validation в Gemini response (importance 1-10) |
| 0.4 | Добавить EntitySkeleton loading state |

### Фаза 1: Улучшение дедупликации
**Приоритет:** P1  
**Оценка:** 6-8 часов

| Задача | Описание |
|--------|----------|
| 1.1 | Реализовать fuzzy matching с использованием aliases |
| 1.2 | Добавить LLM-based merge на этапе extraction (Gemini знает что "Белый Волк" = "Геральт") |
| 1.3 | Создать manual merge UI для админа |
| 1.4 | Добавить DB constraint `UNIQUE(book_id, lower(name))` |

### Фаза 2: CFI-based спойлер-защита
**Приоритет:** P1  
**Оценка:** 8-12 часов

| Задача | Описание |
|--------|----------|
| 2.1 | Добавить `first_mention_cfi` в EntityMention |
| 2.2 | Модифицировать Gemini prompt для извлечения позиции в тексте |
| 2.3 | Реализовать `compareCFI()` utility |
| 2.4 | Обновить Frontend для CFI-based filtering |
| 2.5 | Добавить CFI к Notes (EntityNoteSchema) |

### Фаза 3: Database refactoring
**Приоритет:** P2  
**Оценка:** 4-6 часов

| Задача | Описание |
|--------|----------|
| 3.1 | Создать таблицу `description_entities` (M:N link) |
| 3.2 | Миграция данных из entities_mentioned в новую таблицу |
| 3.3 | Добавить ENUM для entity.type |
| 3.4 | Добавить индексы для производительности |
| 3.5 | Удалить legacy поле entities_mentioned |

### Фаза 4: Frontend refactoring
**Приоритет:** P2  
**Оценка:** 6-8 часов

| Задача | Описание |
|--------|----------|
| 4.1 | Декомпозиция EntityDrawer → EntityCard, EntityList |
| 4.2 | Добавить поиск по сущностям |
| 4.3 | Добавить фильтрацию по типу и главе |
| 4.4 | Унифицировать стили через CSS variables |
| 4.5 | Добавить virtualization для больших списков |

### Фаза 5: Performance & Quality
**Приоритет:** P3  
**Оценка:** 4-6 часов

| Задача | Описание |
|--------|----------|
| 5.1 | Оптимизировать N+1 в entity_service |
| 5.2 | Добавить prefetch для EntityProfile |
| 5.3 | Реализовать incremental sync (WebSocket) |
| 5.4 | Добавить тесты для entity_service |
| 5.5 | Добавить E2E тесты для EntityDrawer |

---

## 6. Детальные спецификации

### 6.1 Новая таблица description_entities

```sql
CREATE TABLE description_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    description_id UUID NOT NULL REFERENCES descriptions(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    confidence FLOAT DEFAULT 1.0,
    mention_cfi VARCHAR(500), -- CFI позиция упоминания
    mention_text VARCHAR(500), -- "Геральт", "Белый Волк" etc.
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(description_id, entity_id)
);

CREATE INDEX idx_description_entities_entity ON description_entities(entity_id);
CREATE INDEX idx_description_entities_description ON description_entities(description_id);
```

### 6.2 CFI-based isEntityMet

```typescript
// frontend/src/utils/entityUtils.ts

import { compareCFI } from './cfiUtils';

export const isEntityMetCFI = (
  entity: EntityDetail,
  currentCFI: string | null
): boolean => {
  if (!currentCFI) return false;
  if (!entity.first_mention_cfi) {
    // Fallback to chapter-based logic
    return isEntityMet(entity, /* derive chapter from CFI */);
  }
  
  return compareCFI(entity.first_mention_cfi, currentCFI) <= 0;
};

// CFI comparison: returns -1 if a < b, 0 if equal, 1 if a > b
export const compareCFI = (a: string, b: string): number => {
  // Parse CFI paths and compare numerically
  // Example: "epubcfi(/6/4!/4/2)" vs "epubcfi(/6/4!/4/10)"
  // ...implementation
};
```

### 6.3 Улучшенный Gemini Prompt

```python
EXTRACTION_PROMPT_V2 = """
Ты - литературный редактор. Анализируй текст и извлекай информацию.

ЗАДАЧА:
1. Найди ГЛАВНЫХ персонажей и локации (Top-15 по важности для сюжета).
2. Для каждой сущности укажи:
   - name: Основное имя
   - aliases: ["альтернативные", "имена"]  ← ВАЖНО для дедупликации!
   - visual_summary: Описание внешности
   - importance: 1-10 (9-10 = главные герои, 1-6 = фоновые)
   - first_appearance_offset: Смещение первого упоминания в символах от начала текста

3. Найди описательные фрагменты:
   - content: Текст описания
   - start_offset: Начало в символах
   - end_offset: Конец в символах
   - entities: ["имена", "упомянутых", "сущностей"]

Текст:
{text}
"""
```

### 6.4 Entity merge algorithm

```python
def smart_merge_entities(entities: List[ExtractedEntity]) -> List[ExtractedEntity]:
    """
    Умный merge с учётом:
    1. Точного совпадения имён
    2. Совпадения aliases
    3. Substring matching (Геральт ⊂ Геральт из Ривии)
    4. LLM hints (если Gemini вернул aliases)
    """
    merged = []
    alias_map = {}  # alias -> canonical entity
    
    for entity in sorted(entities, key=lambda e: -e.importance):
        # Build search keys
        keys = {entity.name.lower()} | {a.lower() for a in entity.aliases}
        
        # Check if any key matches existing
        found = None
        for key in keys:
            if key in alias_map:
                found = alias_map[key]
                break
        
        if found:
            # Merge into existing
            found.aliases = list(set(found.aliases) | set(entity.aliases) | {entity.name})
            found.visual_summary = max(found.visual_summary, entity.visual_summary, key=len)
            found.importance = max(found.importance, entity.importance)
        else:
            # New entity
            merged.append(entity)
            for key in keys:
                alias_map[key] = entity
    
    return merged
```

---

## 7. Приоритизация

### Матрица Impact vs Effort

```
                    EFFORT
                 Low      │     High
            ┌────────────┼────────────┐
    High    │  Фаза 0    │  Фаза 2    │
            │  Фаза 1.1  │  Фаза 3    │
  IMPACT    ├────────────┼────────────┤
    Low     │  Фаза 4.4  │  Фаза 5    │
            │  Фаза 4.1  │            │
            └────────────┴────────────┘
```

### Рекомендуемый порядок

1. **Фаза 0** — Стабилизация (2-4 часа) — немедленно
2. **Фаза 1.1-1.2** — Дедупликация (4 часа) — критично для UX
3. **Фаза 2** — CFI spoilers (8-12 часов) — ваш главный приоритет
4. **Фаза 3** — DB refactoring (4-6 часов) — foundation для будущего
5. **Фаза 4** — Frontend polish (6-8 часов)
6. **Фаза 5** — Performance (4-6 часов)

**Общая оценка: 30-44 часа работы**

---

## 8. Риски и митигации

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Миграция DB сломает существующие данные | Средняя | Высокое | Делать миграцию idempotent, backup |
| CFI extraction из Gemini неточный | Высокая | Среднее | Fallback на chapter-based |
| Merge entities удалит нужные | Средняя | Высокое | Soft delete, admin review UI |
| Performance degradation | Низкая | Среднее | Load testing перед релизом |

---

## 9. Метрики успеха

| Метрика | Текущее | Цель |
|---------|---------|------|
| Дубликатов на книгу | 20-40% | < 5% |
| Пустых mentions | 30-50% | < 5% |
| Время загрузки drawer | 1-3 сек | < 500ms |
| Spoiler incidents | Неизвестно | 0 |
| User satisfaction | Низкая | Высокая |

---

## 10. Заключение

Система сущностей требует **фундаментального рефакторинга** на уровне:
1. **База данных** — новая M:N связь, CFI storage
2. **Backend** — улучшенная дедупликация, CFI extraction
3. **Frontend** — CFI-based spoiler logic, UX improvements

**Главный приоритет** (по вашему запросу): **CFI-based спойлер-защита** (Фаза 2).

**Рекомендация**: Начать с Фазы 0 (стабилизация), затем параллельно работать над Фазами 1 и 2.

---

## Приложение A: Файлы для изменения

```
Backend:
├── app/services/gemini_extractor.py  — Prompt V2, offset extraction
├── app/services/entity_service.py    — CFI-based mentions
├── app/services/consistency_manager.py — Smart merge
├── app/models/entity_mention.py      — Add mention_cfi
├── app/schemas/responses/entities.py — Add first_mention_cfi
├── alembic/versions/xxx_add_cfi.py   — Migration

Frontend:
├── src/utils/entityUtils.ts          — isEntityMetCFI
├── src/utils/cfiUtils.ts             — compareCFI (NEW)
├── src/components/Entities/*         — Refactoring
├── src/hooks/useEntityNetwork.ts     — Add CFI handling
├── src/types/entity.ts               — Add CFI types
```

## Приложение B: Тестовые сценарии

```gherkin
Feature: Entity Spoiler Protection

Scenario: Entity hidden before first mention
  Given book "Harry Potter" is loaded
  And user is at CFI "/6/2!/4/1:0" (Chapter 1, paragraph 1)
  When user opens Entity Drawer
  Then "Severus Snape" should be hidden
  Because his first_mention_cfi is "/6/4!/4/10:0" (Chapter 2)

Scenario: Entity visible after first mention
  Given user is at CFI "/6/4!/4/15:0" (Chapter 2, after Snape intro)
  When user opens Entity Drawer
  Then "Severus Snape" should be visible

Scenario: Entity notes filtered by CFI
  Given user views "Snape" profile at CFI "/6/6!/4/1:0" (Chapter 3)
  Then notes from Chapter 1-3 should be visible
  And notes from Chapter 4+ should be hidden/spoiler-blurred
```

---

# ЧАСТЬ 2: КАРТОЧКИ СВЯЗЕЙ (Relationship Cards)

---

## 11. Введение в карточки связей

### 11.1 Зачем нужны карточки связей?

Карточка связи — это **детальное представление отношений между двумя сущностями**, которое отвечает на вопросы:

| Вопрос пользователя | Ответ карточки связи |
|---------------------|----------------------|
| Кем приходится Гарри Рону? | Лучший друг, однокурсник |
| Когда они впервые встретились? | Глава 6, в поезде на Хогвартс |
| Как развивались их отношения? | Timeline событий |
| Где чаще всего пересекаются? | Локации совместных сцен |

### 11.2 Бизнес-ценность

| Аспект | Ценность |
|--------|----------|
| **Engagement** | Пользователь дольше остаётся в приложении, исследуя связи |
| **Comprehension** | Помогает понять сложные родственные связи (Игра Престолов) |
| **Retention** | "Вернусь посмотреть как развивались отношения" |
| **AI Quality** | Демонстрация интеллектуальной обработки текста |
| **Differentiation** | Уникальная фича, которой нет у конкурентов |

### 11.3 Ожидания пользователей

**Базовые ожидания:**
- Увидеть тип связи (друзья, враги, родственники)
- Понять контекст (почему они связаны)
- Не получить спойлеры

**Продвинутые ожидания:**
- Увидеть эволюцию отношений (timeline)
- Перейти к месту в книге, где описана связь
- Увидеть общие локации/события

---

## 12. Структура данных для карточки связи

### 12.1 Текущая схема EntityRelationship

```python
class EntityRelationship:
    source_id: UUID          # Сущность A
    target_id: UUID          # Сущность B
    type: str                # KINSHIP, ALLY, ENEMY, etc.
    weight: int              # -100..+100
    relationship_metadata: JSONB  # {"context": "..."}
```

**Проблемы:**
1. `type` — только одно значение, но связь может меняться (враги → друзья)
2. `relationship_metadata` — только `context`, нет timeline
3. Нет CFI для спойлер-защиты
4. Нет информации о локациях взаимодействия

### 12.2 Расширенная схема (предложение)

```sql
-- Основная таблица связей (без изменений)
entity_relationships
├── id UUID PK
├── source_id FK → entities
├── target_id FK → entities
├── type VARCHAR             -- Основной тип (KINSHIP, ALLY, ENEMY, etc.)
├── weight INT               -- Текущий вес (-100..+100)
├── relationship_metadata JSONB
├── first_interaction_cfi VARCHAR  -- CFI первого взаимодействия (NEW)
├── created_at TIMESTAMPTZ
└── updated_at TIMESTAMPTZ

-- НОВАЯ таблица: История изменений связи
relationship_events
├── id UUID PK
├── relationship_id FK → entity_relationships
├── event_type VARCHAR       -- ESTABLISHED, STRENGTHENED, WEAKENED, BETRAYAL, etc.
├── event_cfi VARCHAR        -- CFI события
├── chapter_index INT        -- Номер главы (fallback)
├── description TEXT         -- "Гарри спас Рона от тролля"
├── weight_delta INT         -- Изменение веса (+20, -30)
├── location_id FK → entities (NULL если не локация)
├── created_at TIMESTAMPTZ
└── UNIQUE(relationship_id, event_cfi)

-- НОВАЯ таблица: Совместные упоминания
shared_mentions
├── id UUID PK
├── relationship_id FK → entity_relationships
├── description_id FK → descriptions
├── mention_cfi VARCHAR
├── context TEXT             -- Краткий контекст
└── created_at TIMESTAMPTZ
```

### 12.3 Типы связей (полный список)

| Тип | Описание | Emoji | Вес по умолчанию |
|-----|----------|-------|------------------|
| **KINSHIP** | Родственники | 👨‍👩‍👧 | +50 |
| **ALLY** | Союзники, друзья | 🤝 | +60 |
| **ENEMY** | Враги | ⚔️ | -60 |
| **ROMANTIC** | Романтические отношения | ❤️ | +80 |
| **MENTOR** | Наставник-ученик | 📚 | +40 |
| **RIVAL** | Соперники | 🏆 | -20 |
| **OWNER** | Владелец (персонаж владеет объектом) | 🔑 | +30 |
| **RESIDENT** | Житель (персонаж живёт в локации) | 🏠 | +20 |
| **CREATOR** | Создатель (персонаж создал объект) | 🔨 | +40 |
| **LOCATED_IN** | Находится в (объект в локации) | 📍 | +10 |
| **CONNECTED_TO** | Соединены (локация с локацией) | 🔗 | +10 |
| **PART_OF** | Часть (объект часть объекта) | 🧩 | +30 |

### 12.4 Схема ответа API

```typescript
interface RelationshipCardResponse {
  id: string;
  
  // Участники связи
  source: EntityBriefInfo;
  target: EntityBriefInfo;
  
  // Основная информация
  type: RelationshipType;
  type_label: string;        // "Лучшие друзья"
  weight: number;            // -100..+100
  sentiment: 'positive' | 'negative' | 'neutral';
  
  // Спойлер-защита
  first_interaction_cfi: string | null;
  is_spoiler: boolean;       // true если связь ещё не раскрыта по CFI
  
  // Timeline (фильтруется по CFI)
  events: RelationshipEvent[];
  
  // Совместные появления
  shared_locations: EntityBriefInfo[];   // Локации где пересекались
  shared_scenes_count: number;           // Количество совместных сцен
  
  // Контекст
  summary: string;           // "Познакомились в поезде, стали лучшими друзьями"
  key_quote: string | null;  // Ключевая цитата из текста
}

interface RelationshipEvent {
  id: string;
  event_type: EventType;
  event_cfi: string;
  chapter_index: number;
  description: string;
  weight_delta: number;
  timestamp_in_story: string | null;  // "1 сентября 1991"
  is_spoiler: boolean;
}

interface EntityBriefInfo {
  id: string;
  name: string;
  type: EntityType;
  avatar_url: string | null;
  is_met: boolean;  // По текущему CFI
}
```

---

## 13. UX/UI карточки связи

### 13.1 Принципы дизайна

1. **Симметрия** — обе сущности равнозначны визуально
2. **Прогрессивное раскрытие** — базовая инфо сразу, детали по клику
3. **Спойлер-защита** — события после текущего CFI скрыты
4. **Навигация** — можно перейти к сущности или к месту в книге
5. **Визуальная семантика** — цвет/иконка отражают тип связи

### 13.2 Структура карточки связи

```
┌─────────────────────────────────────────────────────────────────┐
│                        HEADER                                   │
│  ┌─────────┐                              ┌─────────┐          │
│  │ Avatar  │ ←──── [ТИП СВЯЗИ] ────→      │ Avatar  │          │
│  │  Source │        🤝 Друзья             │  Target │          │
│  └─────────┘                              └─────────┘          │
│    [Имя A]                                  [Имя B]            │
├─────────────────────────────────────────────────────────────────┤
│                     SUMMARY SECTION                             │
│  "Познакомились в Хогвартс-экспрессе. Вместе прошли через      │
│   множество испытаний и стали лучшими друзьями."               │
├─────────────────────────────────────────────────────────────────┤
│                     KEY STATS                                   │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                │
│  │ 📖 Глава 6 │  │ 🏠 5 локаций│  │ 📊 +80     │                │
│  │ Первая     │  │ Совместных │  │ Сила связи │                │
│  │ встреча    │  │            │  │            │                │
│  └────────────┘  └────────────┘  └────────────┘                │
├─────────────────────────────────────────────────────────────────┤
│                     TIMELINE                                    │
│  ──●────────●────────●────────●────────○────────○───→          │
│    │        │        │        │        │        │              │
│  Гл.6     Гл.12    Гл.20    Гл.25    [🔒]     [🔒]            │
│  Встреча  Тролль  Шахматы  Друзья   Спойлер  Спойлер          │
├─────────────────────────────────────────────────────────────────┤
│                     SHARED LOCATIONS                            │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                          │
│  │Хогвартс │ │Гриффинд.│ │Запретный│                          │
│  │         │ │Башня    │ │лес      │                          │
│  └─────────┘ └─────────┘ └─────────┘                          │
├─────────────────────────────────────────────────────────────────┤
│                     KEY QUOTE                                   │
│  "— Ты мой лучший друг, Гарри.                                 │
│   — И ты мой, Рон."                                            │
│                              — Глава 25, [Перейти →]           │
└─────────────────────────────────────────────────────────────────┘
```

### 13.3 Визуальные вариации по типу связи

#### Позитивные связи (weight > 0)
```
Цвет акцента: Зелёный/Синий
Иконка в центре: 🤝 / ❤️ / 👨‍👩‍👧 / 📚
Линия между аватарами: Сплошная, яркая
```

#### Негативные связи (weight < 0)
```
Цвет акцента: Красный/Оранжевый  
Иконка в центре: ⚔️ / 🏆
Линия между аватарами: Прерывистая, красная
```

#### Нейтральные связи (weight ≈ 0)
```
Цвет акцента: Серый
Иконка в центре: 🔗
Линия между аватарами: Пунктирная, серая
```

---

## 14. Карточки связей для всех комбинаций типов

### 14.1 ПЕРСОНАЖ ↔ ПЕРСОНАЖ

**Самый частый и важный тип связи.**

```
┌─────────────────────────────────────────────────────────────────┐
│                    ГАРРИ ↔ РОН                                  │
│  ┌─────────┐         🤝         ┌─────────┐                    │
│  │  ⚡👤   │ ═══════════════════ │   👤🧡  │                    │
│  │  Гарри  │    ЛУЧШИЕ ДРУЗЬЯ   │   Рон   │                    │
│  │ Поттер  │                    │  Уизли  │                    │
│  └─────────┘                    └─────────┘                    │
│           Персонаж              Персонаж                        │
├─────────────────────────────────────────────────────────────────┤
│  💬 "Познакомились в Хогвартс-экспрессе, когда Рон искал       │
│      свободное купе. С тех пор неразлучны."                    │
├─────────────────────────────────────────────────────────────────┤
│  📊 СТАТИСТИКА ОТНОШЕНИЙ                                        │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  Сила связи: ████████████████████░░ +80              │      │
│  │  Первая встреча: Глава 6 (Хогвартс-экспресс)         │      │
│  │  Совместных сцен: 127                                │      │
│  │  Общих локаций: 12                                   │      │
│  └──────────────────────────────────────────────────────┘      │
├─────────────────────────────────────────────────────────────────┤
│  📅 ИСТОРИЯ ОТНОШЕНИЙ (до главы 25)                             │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ ● Гл.6  │ 🟢 Первая встреча в поезде            [→]  │      │
│  │ ● Гл.12 │ 🟢 Спасли друг друга от тролля       [→]  │      │
│  │ ● Гл.20 │ 🟢 Рон пожертвовал собой в шахматах  [→]  │      │
│  │ ● Гл.25 │ 🟢 Признались в дружбе               [→]  │      │
│  │ ○ Гл.30 │ 🔒 [Скрыто - продолжайте читать]          │      │
│  └──────────────────────────────────────────────────────┘      │
├─────────────────────────────────────────────────────────────────┤
│  🏠 ГДЕ ПЕРЕСЕКАЮТСЯ                                            │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                  │
│  │Хогвартс│ │ Нора   │ │Экспресс│ │Гриффин.│                  │
│  └────────┘ └────────┘ └────────┘ └────────┘                  │
├─────────────────────────────────────────────────────────────────┤
│  💬 КЛЮЧЕВАЯ ЦИТАТА                                             │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ "— Ты сумасшедший, знаешь?                          │      │
│  │  — Рон, это же Гарри. Когда он был нормальным?"     │      │
│  │                                   — Глава 20 [→]    │      │
│  └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

**Особенности для CHARACTER ↔ CHARACTER:**
- Timeline событий (ссоры, примирения, совместные приключения)
- Общие друзья/враги (можно добавить)
- Динамика отношений (график изменения weight)

---

### 14.2 ПЕРСОНАЖ ↔ ЛОКАЦИЯ

**Связь "персонаж живёт/работает/находится в локации".**

```
┌─────────────────────────────────────────────────────────────────┐
│                  ГАРРИ ↔ ХОГВАРТС                               │
│  ┌─────────┐         🏠         ┌─────────┐                    │
│  │  ⚡👤   │ ═══════════════════ │   🏰    │                    │
│  │  Гарри  │      СТУДЕНТ       │ Хогвартс│                    │
│  │ Поттер  │                    │         │                    │
│  └─────────┘                    └─────────┘                    │
│           Персонаж                Локация                       │
├─────────────────────────────────────────────────────────────────┤
│  💬 "Хогвартс стал первым настоящим домом для Гарри.           │
│      Здесь он нашёл друзей, учителей и своё предназначение."   │
├─────────────────────────────────────────────────────────────────┤
│  📊 СВЯЗЬ С ЛОКАЦИЕЙ                                            │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  Тип связи: Студент / Житель                         │      │
│  │  Первое посещение: Глава 7                           │      │
│  │  Количество глав в локации: 45                       │      │
│  │  Статус: Активная связь                              │      │
│  └──────────────────────────────────────────────────────┘      │
├─────────────────────────────────────────────────────────────────┤
│  📅 КЛЮЧЕВЫЕ СОБЫТИЯ В ЭТОЙ ЛОКАЦИИ                             │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ ● Гл.7  │ 🟢 Первое прибытие, Распределение     [→]  │      │
│  │ ● Гл.12 │ 🟢 Победа над троллем в туалете       [→]  │      │
│  │ ● Гл.18 │ 🟢 Обнаружение зеркала Еиналеж        [→]  │      │
│  │ ○ Гл.35 │ 🔒 [Скрыто]                                │      │
│  └──────────────────────────────────────────────────────┘      │
├─────────────────────────────────────────────────────────────────┤
│  👥 КТО ЕЩЁ СВЯЗАН С ЭТОЙ ЛОКАЦИЕЙ                              │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                  │
│  │Дамблдор│ │Снейп   │ │ Рон    │ │Гермиона│                  │
│  └────────┘ └────────┘ └────────┘ └────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

**Особенности для CHARACTER ↔ LOCATION:**
- Тип связи: Житель, Студент, Работник, Пленник, Владелец
- События в этой локации с участием персонажа
- Другие персонажи, связанные с локацией

---

### 14.3 ПЕРСОНАЖ ↔ ОБЪЕКТ

**Связь "персонаж владеет/создал/использует объект".**

```
┌─────────────────────────────────────────────────────────────────┐
│                    ГАРРИ ↔ МАНТИЯ-НЕВИДИМКА                    │
│  ┌─────────┐         🔑         ┌─────────┐                    │
│  │  ⚡👤   │ ═══════════════════ │   🧥    │                    │
│  │  Гарри  │     ВЛАДЕЛЕЦ       │ Мантия  │                    │
│  │ Поттер  │                    │невидимка│                    │
│  └─────────┘                    └─────────┘                    │
│           Персонаж                Объект                        │
├─────────────────────────────────────────────────────────────────┤
│  💬 "Мантия-невидимка — семейная реликвия Поттеров,            │
│      переданная Гарри анонимным дарителем на Рождество."       │
├─────────────────────────────────────────────────────────────────┤
│  📊 СВЯЗЬ С ОБЪЕКТОМ                                            │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  Тип связи: Владелец (унаследовал)                   │      │
│  │  Получен: Глава 12 (Рождественский подарок)          │      │
│  │  Использований: 8                                    │      │
│  │  Статус: Активное владение                           │      │
│  └──────────────────────────────────────────────────────┘      │
├─────────────────────────────────────────────────────────────────┤
│  📅 ИСТОРИЯ ИСПОЛЬЗОВАНИЯ                                       │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ ● Гл.12 │ 📦 Получил мантию как подарок         [→]  │      │
│  │ ● Гл.13 │ 🟢 Использовал в библиотеке           [→]  │      │
│  │ ● Гл.15 │ 🟢 Прокрался к зеркалу Еиналеж        [→]  │      │
│  │ ● Гл.22 │ 🟢 Использовал для спасения дракона   [→]  │      │
│  │ ○ Гл.30 │ 🔒 [Скрыто]                                │      │
│  └──────────────────────────────────────────────────────┘      │
├─────────────────────────────────────────────────────────────────┤
│  🔗 СВЯЗАННЫЕ ПЕРСОНАЖИ                                         │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ 👤 Джеймс Поттер — Предыдущий владелец               │    │
│  │ 👤 Дамблдор — Передал Гарри                          │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

**Особенности для CHARACTER ↔ OBJECT:**
- Тип связи: Владелец, Создатель, Пользователь, Искатель
- История владения (цепочка предыдущих владельцев)
- Ключевые моменты использования

---

### 14.4 ЛОКАЦИЯ ↔ ОБЪЕКТ

**Связь "объект находится/хранится в локации".**

```
┌─────────────────────────────────────────────────────────────────┐
│               ХОГВАРТС ↔ ФИЛОСОФСКИЙ КАМЕНЬ                    │
│  ┌─────────┐         📍         ┌─────────┐                    │
│  │   🏰    │ ═══════════════════ │   💎    │                    │
│  │ Хогвартс│    ХРАНИЛИЩЕ       │Философ. │                    │
│  │         │                    │ камень  │                    │
│  └─────────┘                    └─────────┘                    │
│           Локация                 Объект                        │
├─────────────────────────────────────────────────────────────────┤
│  💬 "Философский камень спрятан в Хогвартсе под защитой        │
│      множества магических ловушек и охраняется Пушком."        │
├─────────────────────────────────────────────────────────────────┤
│  📊 СВЯЗЬ ОБЪЕКТА С ЛОКАЦИЕЙ                                    │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  Тип связи: Хранилище                                │      │
│  │  Появился в локации: Глава 8                         │      │
│  │  Уровень защиты: Максимальный                        │      │
│  │  Точное местоположение: Подземелья                   │      │
│  └──────────────────────────────────────────────────────┘      │
├─────────────────────────────────────────────────────────────────┤
│  🛡️ ЗАЩИТНЫЕ МЕРЫ                                               │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ 1. Пушок (трёхголовый пёс)                          │      │
│  │ 2. Дьявольские силки                                │      │
│  │ 3. Летающие ключи                                   │      │
│  │ 4. Гигантские шахматы                               │      │
│  │ 5. 🔒 [Скрыто - продолжайте читать]                 │      │
│  └──────────────────────────────────────────────────────┘      │
├─────────────────────────────────────────────────────────────────┤
│  👥 КТО ОХОТИТСЯ ЗА ОБЪЕКТОМ                                    │
│  ┌────────┐ ┌────────┐                                        │
│  │Волдемор│ │ Квирел │                                        │
│  │ 🔒     │ │   🔒   │                                        │
│  └────────┘ └────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
```

**Особенности для LOCATION ↔ OBJECT:**
- Тип связи: Хранилище, Место создания, Место уничтожения
- Защитные меры (если есть)
- Кто ищет/охраняет объект

---

### 14.5 ЛОКАЦИЯ ↔ ЛОКАЦИЯ

**Связь между двумя локациями (соединены, рядом, портал).**

```
┌─────────────────────────────────────────────────────────────────┐
│               ХОГВАРТС ↔ ХОГСМИД                                │
│  ┌─────────┐         🔗         ┌─────────┐                    │
│  │   🏰    │ ═══════════════════ │   🏘️    │                    │
│  │ Хогвартс│    СОЕДИНЕНЫ       │ Хогсмид │                    │
│  │         │                    │         │                    │
│  └─────────┘                    └─────────┘                    │
│           Локация                Локация                        │
├─────────────────────────────────────────────────────────────────┤
│  💬 "Хогсмид — единственная полностью волшебная деревня        │
│      в Британии, расположенная рядом с Хогвартсом."            │
├─────────────────────────────────────────────────────────────────┤
│  📊 СВЯЗЬ ЛОКАЦИЙ                                               │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  Тип связи: Соседние локации                         │      │
│  │  Расстояние: Пешая доступность                       │      │
│  │  Способы перемещения: Пешком, Тайный ход             │      │
│  │  Первое упоминание связи: Глава 5                    │      │
│  └──────────────────────────────────────────────────────┘      │
├─────────────────────────────────────────────────────────────────┤
│  🚶 СПОСОБЫ ПЕРЕМЕЩЕНИЯ                                         │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ 1. Официальный путь (с разрешением)                 │      │
│  │ 2. Тайный ход через статую горбатой ведьмы          │      │
│  │ 3. 🔒 [Скрыто]                                       │      │
│  └──────────────────────────────────────────────────────┘      │
├─────────────────────────────────────────────────────────────────┤
│  👥 КТО ПЕРЕМЕЩАЕТСЯ МЕЖДУ ЛОКАЦИЯМИ                            │
│  ┌────────┐ ┌────────┐ ┌────────┐                             │
│  │ Гарри  │ │  Рон   │ │Гермиона│                             │
│  └────────┘ └────────┘ └────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

**Особенности для LOCATION ↔ LOCATION:**
- Тип связи: Соседние, Портал, Часть одного целого
- Способы перемещения
- Персонажи, связывающие локации

---

### 14.6 ОБЪЕКТ ↔ ОБЪЕКТ

**Связь между двумя объектами (часть целого, пара, антагонисты).**

```
┌─────────────────────────────────────────────────────────────────┐
│                   ПАЛОЧКА ↔ ПАЛОЧКА                            │
│  ┌─────────┐         🧩         ┌─────────┐                    │
│  │   🪄    │ ═══════════════════ │   🪄    │                    │
│  │ Палочка │    БРАТЬЯ-        │ Палочка │                    │
│  │ Гарри   │    БЛИЗНЕЦЫ       │Волдемора│                    │
│  └─────────┘                    └─────────┘                    │
│           Объект                  Объект                        │
├─────────────────────────────────────────────────────────────────┤
│  💬 "Обе палочки содержат перо одного и того же феникса —      │
│      Фоукса. Это делает их 'братьями' и создаёт особую связь." │
├─────────────────────────────────────────────────────────────────┤
│  📊 СВЯЗЬ ОБЪЕКТОВ                                              │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  Тип связи: Братья-близнецы (общий источник)         │      │
│  │  Общий элемент: Перо Фоукса                          │      │
│  │  Эффект при столкновении: Priori Incantatem          │      │
│  │  Первое упоминание: 🔒 [Скрыто]                      │      │
│  └──────────────────────────────────────────────────────┘      │
├─────────────────────────────────────────────────────────────────┤
│  🔗 СВЯЗАННЫЕ ПЕРСОНАЖИ                                         │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ 👤 Гарри Поттер — Владелец первой палочки            │    │
│  │ 👤 🔒 [Скрыто] — Владелец второй палочки             │    │
│  │ 🐦 Фоукс — Источник обоих перьев                     │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

**Особенности для OBJECT ↔ OBJECT:**
- Тип связи: Пара, Часть набора, Антагонисты, Комплект
- Общий источник/создатель
- Эффект при взаимодействии

---

## 15. CFI-привязка для карточек связей

### 15.1 Логика спойлер-защиты для связей

```typescript
interface RelationshipSpoilerLogic {
  // Связь видна только если:
  // 1. ОБЕ сущности уже встречены (по CFI)
  // 2. Первое взаимодействие между ними произошло (по CFI)
  
  isRelationshipVisible(
    relationship: RelationshipCardResponse,
    currentCFI: string
  ): boolean {
    const sourceVisible = isEntityMetCFI(relationship.source, currentCFI);
    const targetVisible = isEntityMetCFI(relationship.target, currentCFI);
    
    if (!sourceVisible || !targetVisible) {
      return false; // Одна из сущностей ещё не встречена
    }
    
    if (!relationship.first_interaction_cfi) {
      return true; // Fallback: показываем если CFI не задан
    }
    
    return compareCFI(relationship.first_interaction_cfi, currentCFI) <= 0;
  }
  
  // События фильтруются по CFI
  filterVisibleEvents(
    events: RelationshipEvent[],
    currentCFI: string
  ): RelationshipEvent[] {
    return events.map(event => ({
      ...event,
      is_spoiler: compareCFI(event.event_cfi, currentCFI) > 0
    }));
  }
}
```

### 15.2 Примеры спойлер-защиты

```
СЦЕНАРИЙ 1: Пользователь на главе 5
┌─────────────────────────────────────────────────────────────────┐
│ Связь: Гарри ↔ Волдеморт                                       │
│ Статус: 🔒 СКРЫТО                                               │
│ Причина: Волдеморт ещё не появился в тексте                    │
└─────────────────────────────────────────────────────────────────┘

СЦЕНАРИЙ 2: Пользователь на главе 10  
┌─────────────────────────────────────────────────────────────────┐
│ Связь: Гарри ↔ Рон                                              │
│ Статус: ✅ ВИДНА                                                │
│ События:                                                        │
│   ● Гл.6 — Встреча ✅                                           │
│   ● Гл.8 — Ссора 🔒 (глава 8 > CFI пользователя)               │
└─────────────────────────────────────────────────────────────────┘

СЦЕНАРИЙ 3: Динамическое обновление
┌─────────────────────────────────────────────────────────────────┐
│ Пользователь переходит на главу 15                             │
│ → Связь "Гарри ↔ Снейп" становится видимой                     │
│ → Событие "Ссора" в связи "Гарри ↔ Рон" разблокируется         │
└─────────────────────────────────────────────────────────────────┘
```

### 15.3 Расширение схемы для CFI

```sql
-- Добавляем CFI в entity_relationships
ALTER TABLE entity_relationships 
ADD COLUMN first_interaction_cfi VARCHAR(500);

-- Новая таблица relationship_events
CREATE TABLE relationship_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id UUID NOT NULL REFERENCES entity_relationships(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,  -- ESTABLISHED, STRENGTHENED, WEAKENED, etc.
    event_cfi VARCHAR(500) NOT NULL,  -- CFI события
    chapter_index INT NOT NULL,       -- Fallback
    description TEXT NOT NULL,
    weight_delta INT DEFAULT 0,       -- Изменение силы связи
    location_id UUID REFERENCES entities(id), -- Где произошло (опционально)
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rel_events_relationship ON relationship_events(relationship_id);
CREATE INDEX idx_rel_events_cfi ON relationship_events(event_cfi);
```

---

## 16. Gemini Prompt для извлечения связей

### 16.1 Расширенный промпт

```python
RELATIONSHIP_EXTRACTION_PROMPT = """
Ты - аналитик литературных произведений. Анализируй связи между персонажами, локациями и объектами.

ЗАДАЧА: Найди ВСЕ значимые связи в тексте.

ДЛЯ КАЖДОЙ СВЯЗИ УКАЖИ:
1. source: Имя первой сущности
2. target: Имя второй сущности  
3. type: Тип связи (см. список ниже)
4. weight: Сила связи (-100 до +100)
5. context: Описание связи (1-2 предложения)
6. first_interaction_offset: Позиция в символах, где связь впервые упоминается
7. events: Список событий, влияющих на связь

ТИПЫ СВЯЗЕЙ:
- KINSHIP: Родственники (отец-сын, братья, etc.)
- ALLY: Друзья, союзники
- ENEMY: Враги, антагонисты
- ROMANTIC: Романтические отношения
- MENTOR: Учитель-ученик
- RIVAL: Соперники
- OWNER: Владелец объекта
- RESIDENT: Житель локации
- CREATOR: Создатель объекта
- LOCATED_IN: Объект в локации
- CONNECTED_TO: Связь между локациями
- PART_OF: Часть чего-то

СХЕМА EVENT:
{
  "event_type": "ESTABLISHED|STRENGTHENED|WEAKENED|BETRAYAL|RECONCILIATION",
  "offset": 12345,
  "description": "Что произошло",
  "weight_delta": +20 или -30
}

Текст:
{text}
"""
```

---

## 17. Обновлённый план рефакторинга

### Новая Фаза 6: Карточки связей

**Приоритет:** P2  
**Оценка:** 12-16 часов

| Задача | Описание | Часы |
|--------|----------|------|
| 6.1 | Создать таблицу `relationship_events` | 1 |
| 6.2 | Добавить `first_interaction_cfi` в `entity_relationships` | 0.5 |
| 6.3 | Расширить Gemini prompt для извлечения событий связи | 2 |
| 6.4 | Создать `RelationshipCardResponse` schema | 1 |
| 6.5 | Создать API endpoint `/relationships/{id}` | 2 |
| 6.6 | Реализовать фильтрацию событий по CFI | 2 |
| 6.7 | Создать компонент `RelationshipCard.tsx` | 3 |
| 6.8 | Интегрировать карточку в EntityProfile | 1 |
| 6.9 | Добавить timeline компонент | 2 |
| 6.10 | Тесты для relationship_service | 2 |

### Обновлённая матрица приоритетов

```
                    EFFORT
                 Low      │     High
            ┌────────────┼────────────┐
    High    │  Фаза 0    │  Фаза 2    │
            │  Фаза 1    │  Фаза 6    │ ← НОВОЕ
  IMPACT    ├────────────┼────────────┤
    Low     │  Фаза 4    │  Фаза 5    │
            │            │  Фаза 3    │
            └────────────┴────────────┘
```

### Полный обновлённый план

| Фаза | Фокус | Часы | Приоритет |
|------|-------|------|-----------|
| 0 | Стабилизация (hotfix) | 2-4 | P0 |
| 1 | Дедупликация сущностей | 6-8 | P1 |
| 2 | CFI-based спойлер-защита | 8-12 | P1 |
| 3 | DB refactoring (M:N таблицы) | 4-6 | P2 |
| 4 | Frontend refactoring | 6-8 | P2 |
| 5 | Performance & тесты | 4-6 | P3 |
| **6** | **Карточки связей** | **12-16** | **P2** |

**Новая общая оценка: 42-60 часов работы**

---

## 18. Frontend компоненты для связей

### 18.1 Файловая структура

```
frontend/src/components/Relationships/
├── RelationshipCard.tsx        # Основная карточка
├── RelationshipHeader.tsx      # Шапка с аватарами
├── RelationshipTimeline.tsx    # Timeline событий
├── RelationshipStats.tsx       # Статистика
├── RelationshipLocations.tsx   # Общие локации
├── RelationshipQuote.tsx       # Ключевая цитата
├── RelationshipSkeleton.tsx    # Loading state
└── index.ts                    # Barrel export
```

### 18.2 Типы

```typescript
// frontend/src/types/relationship.ts

export type RelationshipType = 
  | 'KINSHIP'
  | 'ALLY' 
  | 'ENEMY'
  | 'ROMANTIC'
  | 'MENTOR'
  | 'RIVAL'
  | 'OWNER'
  | 'RESIDENT'
  | 'CREATOR'
  | 'LOCATED_IN'
  | 'CONNECTED_TO'
  | 'PART_OF';

export type EventType =
  | 'ESTABLISHED'
  | 'STRENGTHENED'
  | 'WEAKENED'
  | 'BETRAYAL'
  | 'RECONCILIATION';

export interface RelationshipEvent {
  id: string;
  event_type: EventType;
  event_cfi: string;
  chapter_index: number;
  description: string;
  weight_delta: number;
  is_spoiler: boolean;
}

export interface RelationshipCard {
  id: string;
  source: EntityBriefInfo;
  target: EntityBriefInfo;
  type: RelationshipType;
  type_label: string;
  weight: number;
  sentiment: 'positive' | 'negative' | 'neutral';
  first_interaction_cfi: string | null;
  is_spoiler: boolean;
  events: RelationshipEvent[];
  shared_locations: EntityBriefInfo[];
  shared_scenes_count: number;
  summary: string;
  key_quote: string | null;
}
```

---

## 19. Тестовые сценарии для связей

```gherkin
Feature: Relationship Cards

Scenario: Relationship hidden before both entities met
  Given user is at Chapter 3
  And "Гарри" first appears in Chapter 1
  And "Волдеморт" first appears in Chapter 15
  When user views entity network
  Then relationship "Гарри ↔ Волдеморт" should be hidden
  
Scenario: Relationship visible after both entities met
  Given user is at Chapter 20
  And both "Гарри" and "Рон" have been met
  And their first interaction is at Chapter 6
  When user clicks on "Гарри ↔ Рон" relationship
  Then RelationshipCard should be displayed
  And events up to Chapter 20 should be visible
  And events after Chapter 20 should be marked as spoilers

Scenario: Timeline updates as user reads
  Given user views "Гарри ↔ Рон" relationship at Chapter 10
  And timeline shows 3 events
  When user reads to Chapter 15
  And returns to relationship card
  Then timeline should show 5 events (2 new unlocked)

Scenario: Relationship between character and location
  Given user is at Chapter 10
  When user views "Гарри ↔ Хогвартс" relationship
  Then card should show type "RESIDENT/STUDENT"
  And events should list key moments at Hogwarts
  And other characters linked to Hogwarts should be shown
```

---

## 20. Заключение (обновлённое)

Система сущностей и связей требует комплексного рефакторинга:

### Карточки сущностей
- CFI-based спойлер-защита
- Улучшенная дедупликация
- Декомпозиция UI компонентов

### Карточки связей (НОВОЕ)
- Новая таблица `relationship_events` для timeline
- CFI-привязка для событий связи
- 6 типов комбинаций (CHARACTER↔CHARACTER, CHARACTER↔LOCATION, etc.)
- Визуальная семантика по типу связи
- Спойлер-защита на уровне событий

### Приоритеты реализации

1. **Фаза 0-2**: Стабилизация + CFI для сущностей (12-16 часов)
2. **Фаза 6**: Карточки связей (12-16 часов) — можно параллельно с Фазой 3-4
3. **Фаза 3-5**: DB refactoring + Frontend + Performance (14-20 часов)

**Рекомендация**: Начать работу над карточками связей после завершения Фазы 2 (CFI infrastructure), так как карточки связей будут использовать ту же CFI-логику.

---

# ПРИЛОЖЕНИЕ: СТАТУС ВЫПОЛНЕНИЯ

**Обновлено:** 2026-01-25 16:45 MSK

## Общий прогресс: 80% (24/30 задач)

| Фаза | Название | Статус | Прогресс |
|------|----------|--------|----------|
| 0 | Стабилизация | ✅ ЗАВЕРШЕНА | 4/4 |
| 1 | Дедупликация | ⚠️ ЧАСТИЧНО | 2/4 |
| 2 | CFI Spoilers | ✅ ЗАВЕРШЕНА | 7/7 |
| 3 | Database Refactoring | ✅ ЗАВЕРШЕНА | 4/5 |
| 4 | Frontend Refactoring | ✅ ЗАВЕРШЕНА | 5/5 |
| 5 | Performance & Quality | ⚠️ ЧАСТИЧНО | 2/5 |
| 6 | Карточки связей | ⏸️ НЕ НАЧАТА | 0/? |

## Выполненные задачи

### Фаза 0: Стабилизация ✅
- [x] 0.1 Логирование в entity_service
- [x] 0.2 JSON parsing унификация
- [x] 0.3 Validation в Gemini response
- [x] 0.4 EntitySkeleton loading state

### Фаза 1: Дедупликация ⚠️
- [x] 1.1 Fuzzy matching с aliases
- [x] 1.2 LLM-based merge в Gemini prompt
- [ ] 1.3 Manual merge UI (отложено — admin feature)
- [ ] 1.4 DB constraint (отложено — риск миграции)

### Фаза 2: CFI Spoilers ✅
- [x] 2.1 mention_cfi в EntityMention
- [x] 2.2 Gemini offset extraction
- [x] 2.3 compareCFI() utility
- [x] 2.4 Frontend CFI filtering
- [x] 2.5 CFI к Notes
- [x] 2.6 isEntityMetByCFI()
- [x] 2.7 SpoilerText для notes

### Фаза 3: Database Refactoring ✅
- [x] 3.1 Таблица description_entities (M:N)
- [x] 3.2 Миграция из entities_mentioned
- [x] 3.3 ENUM для entity.type
- [x] 3.4 Индексы производительности (5 индексов)
- [ ] 3.5 Удаление entities_mentioned (отложено — breaking change)

### Фаза 4: Frontend Refactoring ✅
- [x] 4.1 Декомпозиция EntityDrawer
- [x] 4.2 Поиск по сущностям
- [x] 4.3 Фильтрация по типу
- [x] 4.4 CSS variables
- [x] 4.5 Virtualization (lazy loading)

### Фаза 5: Performance & Quality ⚠️
- [x] 5.1 N+1 оптимизация (description_entities)
- [ ] 5.2 Prefetch EntityProfile (низкий приоритет)
- [ ] 5.3 WebSocket sync (большая задача)
- [x] 5.4 Тесты entity_service (17 unit тестов)
- [ ] 5.5 E2E тесты (низкий приоритет)

## Созданные файлы

### Backend
```
alembic/versions/2026_01_25_0001_add_mention_cfi_column.py
alembic/versions/2026_01_25_0002_add_description_entities_table.py
alembic/versions/2026_01_25_0003_migrate_entities_mentioned_data.py
alembic/versions/2026_01_25_0004_add_entity_type_enum_and_indexes.py
app/models/description_entity.py (NEW)
tests/services/test_entity_service.py (NEW)
```

### Frontend
```
src/components/Entities/EntityCard.tsx (NEW)
src/components/Entities/EntityList.tsx (NEW)
```

## Созданные индексы
- `ix_entity_mentions_entity_id_chapter_id`
- `ix_description_entities_description_id`
- `ix_description_entities_entity_id`
- `ix_entities_book_id_type`
- `ix_entities_book_id_importance`

## Что осталось для полного завершения

| Задача | Приоритет | Причина отложения |
|--------|-----------|-------------------|
| Manual merge UI | Низкий | Admin feature |
| UNIQUE constraint | Низкий | Риск миграции данных |
| Удаление entities_mentioned | Средний | Breaking change, требует проверки в production |
| Prefetch EntityProfile | Низкий | Микро-оптимизация |
| WebSocket sync | Низкий | Большая архитектурная задача |
| E2E тесты | Средний | Требует настройки Playwright |
| Карточки связей (Фаза 6) | Средний | Зависит от Фазы 2 (завершена) |

## Рекомендации по продолжению

1. **Деплой миграций** → проверить что description_entities работает корректно
2. **Удаление entities_mentioned** → после подтверждения работы M:N связей
3. **Фаза 6 (Карточки связей)** → CFI infrastructure готова, можно начинать
