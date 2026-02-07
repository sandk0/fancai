# LLM Book Processing Pipeline — Full Analysis

**Date:** 2026-02-06
**Scope:** All LLM functionality: entity extraction, image generation, deduplication, entity cards/profiles
**Author:** Claude Code

## Executive Summary

LLM-pipeline fancai оптимизирован для **генерации иллюстраций** (visual descriptions → Imagen), но слабо работает как **интерактивная энциклопедия/вики**. Главная проблема: система извлекает *визуальные описания сцен* и выдаёт их за *информацию о сущностях*. Пользователь ожидает «кто такой Гарри Поттер?», а получает «мальчик с растрёпанными чёрными волосами стоял в коридоре». Выявлено 12 критических проблем на уровне логики, архитектуры и UX.

---

## 1. Findings

### 1.1. КРИТИЧЕСКОЕ: Карточки сущностей показывают не то, что нужно пользователю

**Что показывается сейчас:**
- `EntityCard`: имя, тип (персонаж/локация/объект), 50 символов visual_summary, аватар
- `EntityProfile`: аватар, полный visual_summary, связи, «заметки» (= сырые описания сцен)

**Чего нет:**
- Биография / роль в сюжете (протагонист, антагонист, наставник)
- Черты характера, мотивация, цели
- Краткое описание «кто это?» одним предложением
- Хронология событий по главам («Глава 3: впервые встречает X», «Глава 7: узнаёт что Y»)
- Количество связей, «последнее появление в главе N»

**Файлы:** `frontend/src/components/Entities/EntityCard.tsx:76-82`, `EntityProfile.tsx:89-98`

### 1.2. КРИТИЧЕСКОЕ: «Заметки» сущности = описания сцен, а не информация о сущности

Секция «История» в EntityProfile показывает `entity.notes` — это записи из таблицы `Description`, связанные через `DescriptionEntity`. Но Description — это *визуальные описания сцен для генерации иллюстраций* (location, character, atmosphere, object).

**Пример проблемы:**
- Пользователь открывает карточку «Гарри Поттер»
- Видит: «Мальчик с растрёпанными чёрными волосами и круглыми очками стоял в тёмном коридоре замка, освещённом мерцающим пламенем факелов»
- Ожидает: «Волшебник-студент Хогвартса, обнаруживший что ему предстоит победить Тёмного Лорда»

**Корневая причина:** Промпт `TSA_EXTRACTION_PROMPT` и `EXTRACTION_PROMPT` оптимизированы для извлечения визуальных описаний (цвета, текстуры, освещение), а не для построения энциклопедии.

**Файлы:** `backend/app/services/gemini_extractor.py:394-486` (промпты)

### 1.3. СЕРЬЁЗНОЕ: visual_summary — это сырой лог, а не связное описание

`ConsistencyManager._merge_visual_summaries()` просто конкатенирует описания с маркерами `[Глава N]:`:

```
Высокий мужчина с тёмными волосами и серыми глазами

[Глава 5]: Теперь на его лице виднелся шрам от левого виска до подбородка

[Глава 12]: Одет в потрёпанную кожаную куртку, за поясом — короткий меч
```

**Проблемы:**
- Не производится синтез/слияние — просто дописывание
- Жёсткий лимит 2000 символов — после этого новая информация теряется
- Проверка дубликатов (similarity 0.7) предотвращает точные дубли, но не обрабатывает противоречия и эволюцию
- Маркеры `[Глава N]` видны пользователю через `_process_visual_summary()`, но удаляются — финальный текст выглядит как набор несвязанных абзацев

**Файл:** `backend/app/services/consistency_manager.py:33-80`

### 1.4. СЕРЬЁЗНОЕ: Нет отдельного поля для биографии/сюжетной информации

Модель `Entity` содержит:
- `visual_summary` — визуальное описание (внешность)
- `entity_metadata` (JSONB) — aliases, confidence, first_mention_offset
- `importance` — числовая важность

**Отсутствуют:**
- `biography` / `plot_summary` — роль и путь персонажа
- `personality_traits` — черты характера
- `role` — protagonist/antagonist/mentor/side_character
- `structured_appearance` — структурированное описание (волосы, глаза, возраст, одежда)
- `chapter_events` — ключевые события по главам

**Файл:** `backend/app/models/entity.py:31-123`

### 1.5. СЕРЬЁЗНОЕ: Четырёхслойная дедупликация — избыточность и конфликты

| Слой | Файл | Когда | Стратегия |
|------|------|-------|-----------|
| 1 | `gemini_extractor.py:1176-1253` | Per-chunk | SequenceMatcher > 0.75, substring |
| 2 | `consistency_manager.py:227-351` | Per-chapter | Alias-aware, token overlap > 0.5 |
| 3 | `consistency_manager.py:482-654` | Post-book (LLM Reduce) | Gemini: merge duplicates |
| 4 | `entity_deduplication_service.py:89-211` | Post-book (LLM Dedup) | Gemini: semantic analysis |

**Проблемы:**
- Слои 3 и 4 делают одно и то же — отправляют список сущностей в Gemini для поиска дубликатов
- Разные пороги: слой 1 = 0.75, слой 2 = 0.85, слой 4 = confidence 0.85 для автомержа
- Слой 3 может удалять «мусорные» сущности, а слой 4 — нет → конфликт стратегий
- Все 4 слоя запускаются последовательно в `book_tasks.py` = доп. время и API-расходы

### 1.6. СРЕДНЕЙ ВАЖНОСТИ: Отношения — минимальные данные

- Тип — неограниченная строка (нет enum), из промпта приходят разные варианты
- Weight: извлекается как float 0-1, хранится как int -100..+100, мержится формулой `(existing + new/10) / 2` — запутанная логика
- Нет эволюции: «союзники → враги → снова союзники» невозможно отследить
- Нет фильтрации по главам (first_interaction_chapter есть, но не используется для spoiler-free)

**Файл:** `backend/app/services/consistency_manager.py:181-225`

### 1.7. СРЕДНЕЙ ВАЖНОСТИ: Промпты — два активных режима с разным выходом

- `TSA_EXTRACTION_PROMPT` (~60 строк) — выдаёт XML-теги в тексте + entities + relationships
- `EXTRACTION_PROMPT` (~34 строки) — выдаёт JSON с описаниями + entities + relationships
- Оба активны, переключение через `config.use_tsa_mode`
- TSA — точнее позиционирует описания (для highlighting)
- Legacy — проще парсить
- **Проблема:** Разные промпты → разный output quality, нет единого стандарта

### 1.8. СРЕДНЕЙ ВАЖНОСТИ: Quality gate «дополни деталями из контекста» генерирует галлюцинации

Промпт TSA содержит: `visual_summary < 80 символов → Дополни деталями из контекста`

Это инструктирует LLM *додумывать* описание, если текст книги не содержит достаточно деталей. Результат — галлюцинации: LLM может приписать персонажу внешность, которой нет в книге.

**Альтернатива:** Лучше оставить `"Внешность не описана подробно"` (как в legacy промпте), чем генерировать ложную информацию.

### 1.9. НИЗКОЙ ВАЖНОСТИ: Мёртвый код — llm_description_enricher.py

`backend/app/services/llm_description_enricher.py` — 414 строк мёртвого кода:
- Использует библиотеку `langextract` (синхронное API)
- Ни один файл не импортирует и не вызывает этот модуль
- Использует устаревший подход (NER-стиль extraction)
- Singleton `_llm_enricher` никогда не инициализируется

### 1.10. АРХИТЕКТУРНОЕ: Race condition при параллельной обработке глав

`book_tasks.py:332-545` использует `asyncio.TaskGroup` для параллельной обработки глав. Каждая глава получает свою DB-сессию и свой `ConsistencyManager`.

**Проблема:** Если глава 3 создаёт entity «Гарри», а глава 4 тоже пытается создать entity «Гарри» одновременно → `IntegrityError` на unique constraint `(book_id, lower(name))`.

`_batch_resolve_entities()` проверяет `existing_entities` из БД, но при параллельной обработке другая задача может вставить сущность между SELECT и INSERT.

### 1.11. АРХИТЕКТУРНОЕ: Redis-подключения в ImagenGenerator не переиспользуются

`imagen_generator.py:533-560` — каждый вызов `generate()` создаёт новое Redis-подключение для проверки кеша, и затем закрывает его. При batch-генерации это создаёт десятки подключений.

### 1.12. UX: Описания для генерации изображений не используются в карточках

Описания (Description) генерируются, из них можно создавать иллюстрации (Imagen), но:
- Сгенерированные изображения НЕ показываются в карточках сущностей
- Только `master_portrait_url` (автоматический портрет) виден как аватар
- Нет галереи иллюстраций для сущности
- Пользователь не видит результатов image generation в контексте энциклопедии

---

## 2. Recommendations

### P0 — Критические (определяют ценность продукта)

| # | Рекомендация | Сложность | Файлы |
|---|-------------|-----------|-------|
| 1 | **Добавить извлечение biography/plot_summary** — расширить промпт Gemini, чтобы для каждой сущности извлекать `biography` (роль, мотивация, события) отдельно от `visual_summary` (внешность) | Средняя | `gemini_extractor.py`, `entity.py`, схемы |
| 2 | **Заменить description-notes на entity-events** — вместо «описания сцен» показывать «события с участием сущности»: «Глава 3: Гарри получает письмо из Хогвартса» | Высокая | Новый LLM extraction, новая модель `EntityEvent`, `EntityProfile.tsx` |
| 3 | **LLM-синтез visual_summary** — после обработки всех глав запускать синтезирующий промпт, который объединяет все наблюдения о внешности в связный абзац | Средняя | `consistency_manager.py` |

### P1 — Серьёзные (качество и надёжность)

| # | Рекомендация | Сложность | Файлы |
|---|-------------|-----------|-------|
| 4 | **Убрать слой 3 (optimize_book_entities)** — он дублирует слой 4 (EntityDeduplicationService). Оставить: 1 (per-chunk exact), 2 (per-chapter alias), 4 (LLM semantic) | Низкая | `consistency_manager.py`, `book_tasks.py` |
| 5 | **Убрать quality gate «дополни деталями»** из промпта — заменить на «если описания мало, напиши 'Внешность не описана подробно в данном фрагменте'» | Низкая | `gemini_extractor.py:446-448` |
| 6 | **Enum для типов отношений** — заменить свободные строки на фиксированный enum: KINSHIP, FRIENDSHIP, RIVALRY, ROMANCE, MENTORSHIP, CONFLICT, PROFESSIONAL | Средняя | `entity_relationship.py`, промпты, фронтенд |
| 7 | **Исправить weight формулу** — нормализовать: хранить как float 0.0-1.0, мержить как weighted average | Низкая | `consistency_manager.py:204` |

### P2 — Улучшения UX

| # | Рекомендация | Сложность | Файлы |
|---|-------------|-----------|-------|
| 8 | **Обогатить EntityCard** — показывать: importance (звёздочки), кол-во связей, номер главы последнего появления, одну строку biography | Средняя | `EntityCard.tsx`, `EntityDetailSchema` |
| 9 | **Галерея иллюстраций в EntityProfile** — показывать все сгенерированные изображения сцен с участием сущности | Средняя | `EntityProfile.tsx`, API endpoint |
| 10 | **Role badge на карточке** — визуальный бейдж: «Главный герой», «Антагонист», «Наставник» | Низкая | `EntityCard.tsx`, новое поле `role` |
| 11 | **Хронология в профиле** — timeline: что произошло с сущностью в каждой главе | Высокая | Новая модель, LLM extraction |

### P3 — Технический долг

| # | Рекомендация | Сложность | Файлы |
|---|-------------|-----------|-------|
| 12 | **Удалить мёртвый код** `llm_description_enricher.py` | Минимальная | Удалить файл |
| 13 | **Решить race condition** — использовать `ON CONFLICT` (upsert) при создании сущностей вместо SELECT+INSERT | Средняя | `consistency_manager.py` |
| 14 | **Переиспользовать Redis pool** в ImagenGenerator | Низкая | `imagen_generator.py` |
| 15 | **Убрать legacy extraction mode** — оставить только TSA, удалить `_process_chunk_legacy` | Средняя | `gemini_extractor.py` |
| 16 | **Фильтрация отношений по spoiler-free** — не показывать связи, first_interaction_chapter которых > current_chapter | Низкая | `entity_service.py:300-339` |

---

## 3. Brainstorm: Идеальная архитектура Entity Wiki

### 3.1. Двухфазная извлечение

**Фаза 1 (текущая, улучшенная):** Извлечение per-chapter
- Visual descriptions → для Imagen (как есть)
- Entities с visual_summary → для аватаров (как есть)
- **НОВОЕ:** Entity events → «Что произошло с сущностью в этой главе?»
- **НОВОЕ:** Entity traits → черты характера, обнаруженные в этой главе

**Фаза 2 (новая, post-processing):** Синтез per-book
- LLM-синтез visual_summary → связное описание внешности
- LLM-синтез biography → одна биография из всех entity_events
- LLM-определение role → protagonist/antagonist/etc
- LLM-синтез relationships → эволюция отношений по главам

### 3.2. Модель данных для Entity Wiki

```python
class Entity:
    # Существующее
    name, type, visual_summary, importance, aliases_with_reveal

    # Новое
    biography: str           # Синтезированная биография (spoiler-free, до текущей главы)
    role: str                # protagonist, antagonist, mentor, side_character
    personality_traits: list # brave, loyal, cunning
    structured_appearance: dict  # {hair: "dark", eyes: "green", age: "young", build: "slim"}

class EntityEvent:
    entity_id, chapter_id
    event_text: str         # "Получил письмо из Хогвартса"
    event_type: str         # appearance, action, revelation, death
    significance: int       # 1-10
```

### 3.3. Что показывать в карточке сущности

```
┌─────────────────────────────────────┐
│ [Avatar]  Гарри Поттер              │
│           ★★★★★ Главный герой       │
│           ───────────────────       │
│           «Волшебник-студент,       │
│            избранный для победы     │
│            над Тёмным Лордом»       │
│           ───────────────────       │
│           Главы: 1-45 │ 8 связей   │
│           Последнее: Глава 42       │
└─────────────────────────────────────┘
```

### 3.4. Что показывать в профиле сущности

1. **Шапка:** Большой аватар + имя + role badge + importance
2. **Внешность:** Синтезированный visual_summary (без [Глава N] маркеров)
3. **Биография:** biography (spoiler-free до текущей главы)
4. **Хронология:** EntityEvents по главам (timeline)
5. **Связи:** Граф с типами и описаниями
6. **Галерея:** Сгенерированные иллюстрации сцен с этой сущностью
7. **Псевдонимы:** aliases с reveal_chapter

### 3.5. Нужно ли показывать описания для генерации?

**Нет, НЕ нужно.** Описания (Description) — технический артефакт для генерации изображений. Пользователю нужно видеть:
- Сгенерированные **изображения** (результат), а не описания (промпт)
- **События** с участием сущности, а не визуальные описания сцен

Описания остаются внутренней сущностью для image pipeline.

---

## 4. Next Steps

1. **Провести brainstorm** по расширению промптов — определить формат extraction для biography, events, traits
2. **Создать plan** для P0 рекомендаций (biography extraction + visual_summary synthesis)
3. **Удалить мёртвый код** (P3, минимальный effort)
4. **Прототипировать** обогащённую EntityCard на фронтенде

---

## Appendix: Файловая карта LLM Pipeline

```
backend/app/
├── services/
│   ├── gemini_extractor.py      # Core LLM extraction (prompts, chunking, parsing)
│   ├── imagen_generator.py      # Image generation (translate, prompt, generate)
│   ├── consistency_manager.py   # Entity resolution, dedup, master refs
│   ├── entity_service.py        # Entity network API (spoiler-free, caching)
│   ├── entity_deduplication_service.py  # LLM dedup layer 4
│   ├── description_extraction_service.py  # Description caching/serving
│   ├── image_generator.py       # High-level image queue wrapper
│   ├── llm_cache_service.py     # Redis LLM response cache
│   ├── llm_description_enricher.py  # DEAD CODE
│   └── tsa_parser.py            # XML tag parser for TSA mode
├── tasks/
│   ├── book_tasks.py            # Celery: full book processing pipeline
│   └── image_tasks.py           # Celery: image generation
├── models/
│   ├── entity.py                # Entity model (character/location/object)
│   ├── entity_mention.py        # Hard link: entity ↔ chapter
│   ├── entity_relationship.py   # Knowledge graph edges
│   ├── description.py           # Visual descriptions for Imagen
│   └── description_entity.py    # Soft link: description ↔ entity
└── schemas/responses/
    ├── entities.py              # API schemas (EntityDetail, NetworkEdge)
    └── descriptions.py          # Description API schemas

frontend/src/
├── components/Entities/
│   ├── EntityCard.tsx           # Card in list
│   ├── EntityList.tsx           # Scrollable list
│   ├── EntityProfile.tsx        # Full profile view
│   ├── EntityDrawer.tsx         # Slide-out drawer
│   └── entityTypeLabels.ts      # i18n labels
├── types/entity.ts              # TypeScript interfaces
├── hooks/useEntityNetwork.ts    # TanStack Query hook
└── utils/entityUtils.ts         # CFI helpers, spoiler checks
```
