# Аудит: Нумерация глав в спойлер-защите (задача 002)

**Дата:** 26 февраля 2026
**Тип:** Перекрёстный аудит выводов задачи `002-2625cfba-5865-4a28-b233-a0dc4b34d0af`
**Методология:** Git-история (15 коммитов), 5 существующих отчётов, чтение кода с точными номерами строк, трассировка потока данных end-to-end
**Автор:** Claude Code

---

## Содержание

1. [Резюме](#1-резюме)
2. [Хронология: когда и почему появился баг](#2-хронология)
3. [Полная карта потока данных](#3-полная-карта-потока-данных)
4. [Критическое расхождение с выводами задачи 002](#4-критическое-расхождение-с-выводами-задачи-002)
5. [Верифицированные проблемы](#5-верифицированные-проблемы)
6. [Python truthiness-баг: глава 0](#6-python-truthiness-баг-глава-0)
7. [Анализ симптома «сущности залочены на последней главе»](#7-анализ-симптома-сущности-залочены-на-последней-главе)
8. [Перекрёстная проверка с предыдущими отчётами](#8-перекрёстная-проверка-с-предыдущими-отчётами)
9. [Рекомендации](#9-рекомендации)
10. [Приложение: таблица коммитов](#10-приложение-таблица-коммитов)

---

## 1. Резюме

Задача 002 утверждает, что корневая причина проблемы «сущности залочены на последней главе» — это 0-индексация `enumerate(chapters)` в `book_tasks.py:575`. **Аудит частично подтверждает** наличие 0-indexed бага, но выявляет **три критических расхождения** с выводами задачи:

1. **Основная функция `isEntityMet()` НЕ затронута** — она использует `mentions`, которые берутся из `Chapter.chapter_number` (1-indexed). Задача 002 ошибочно включила `mentions` в список затронутых данных.

2. **Направление ошибки — обратное**: 0-индексация показывает данные **раньше**, а не позже. Это вызывает мелкие спойлеры (показ событий на 1 главу раньше), но **не блокировку сущностей** на последней главе.

3. **Есть Python truthiness-баг** (не обнаружен задачей 002): `if chapter_index` ложно при `chapter_index=0`, из-за чего первая глава теряет маркер `[Глава 0]` в visual summary.

**Вывод:** 0-indexed баг реален, но он **не является корневой причиной** симптома «залочены на последней главе». Нужно дополнительное расследование для этого конкретного симптома.

---

## 2. Хронология: когда и почему появился баг

### Баг не является регрессией. Он присутствует с первого дня.

| Дата | Коммит | Событие | Индексация |
|------|--------|---------|------------|
| **26 янв** | `ad91165` | `refactor: split tasks.py into modules` — первое появление `enumerate(chapters)` в book_tasks.py | 0-indexed заложен |
| **31 янв** | `6031dde` | `feat: spoiler protection` — добавлены `first_mention_chapter`, `aliases_with_reveal`, фильтрация по главам | Использует `chapter_index` (0-indexed) от caller |
| **1 фев** | `5738aa5` | `fix: use correct chapter index instead of offset` — замена `raw.first_mention_offset` на `chapter_index` в visual summary merge | **Фикс семантики**, но 0-indexed сохранён |
| **7 фев** | `f67234a` | `feat: Phase 2 — EntityEvent, synthesis` — добавлены EntityEvent с `chapter_number=idx` | Расширено 0-indexed использование |
| **25 фев** | `6b7dd3b` | `fix: KeyError aliases race condition` — INSERT ON CONFLICT для entity | Не затрагивает индексацию |
| **25 фев** | `0bed92d` | `fix: casefold in entity pipeline` — locale C фикс | Не затрагивает индексацию |

### Почему баг возник

**Причина:** При декомпозиции `tasks.py` (26 янв) использование `enumerate(chapters)` казалось естественным для итерации. Автор не учёл, что `Chapter.chapter_number` начинается с 1, а `enumerate()` — с 0. Никто не проверил эту стыковку, потому что:

1. Спойлер-защита была добавлена **через 5 дней** (31 янв) уже поверх 0-indexed данных
2. Фикс от 1 фев (`5738aa5`) поправил **семантику** (offset → chapter_index), но не **базу** (0 → 1)
3. Все последующие фичи (events, milestones, synthesis) строились поверх 0-indexed значений
4. Тестов на граничные значения нумерации глав не было

---

## 3. Полная карта потока данных

### 3.1. EPUB → Chapter (КОРРЕКТНО: 1-indexed)

```
EPUB/FB2 → book_parser.py:62 (BookChapter.number) → book_service.py:105 → DB: Chapter.chapter_number = 1, 2, 3...
ReadingProgress.current_chapter начинается с 1 (book_service.py:119)
```

### 3.2. Обработка глав → Entity данные (БАГОВАНО: 0-indexed)

```
book_tasks.py:575  enumerate(chapters) → idx = 0, 1, 2...
   ↓
book_tasks.py:411  process_chapter_analysis(chapter_index=idx)
   ↓
consistency_manager.py:384  Entity.first_mention_chapter = 0, 1, 2... ← БАГ
consistency_manager.py:346  aliases_with_reveal[].reveal_chapter = 0, 1, 2... ← БАГ
consistency_manager.py:94   visual_summary: "[Глава 0]", "[Глава 1]"... ← БАГ
   ↓
book_tasks.py:424  EntityEvent.chapter_number = 0, 1, 2... ← БАГ
```

### 3.3. Mentions → Frontend (КОРРЕКТНО: 1-indexed)

```
entity_service.py:257  SELECT Chapter.chapter_number FROM EntityMention JOIN Chapter
                       → hard_mentions_map[entity_id] = {1, 3, 5...}  ← КОРРЕКТНО

entity_service.py:476  d.chapter.chapter_number → all_mentions.add(1, 2, 3...)  ← КОРРЕКТНО

entity_service.py:524  "mentions": sorted([1, 3, 5...])  ← КОРРЕКТНО

Frontend entityUtils.ts:13  Math.min(...mentions) → 1  ← КОРРЕКТНО
Frontend entityUtils.ts:16  currentChapter >= firstMeeting → 1 >= 1 ✓  ← КОРРЕКТНО
```

### 3.4. Ключевой вывод

| Поле данных | Источник | Индексация | Затронуто? |
|-------------|----------|------------|------------|
| `mentions[]` | `Chapter.chapter_number` | **1-indexed** | НЕТ |
| `notes[].chapter_index` | `d.chapter.chapter_number` | **1-indexed** | НЕТ |
| `first_mention_chapter` | `enumerate(chapters)` idx | **0-indexed** | ДА |
| `aliases_with_reveal[].reveal_chapter` | `enumerate(chapters)` idx | **0-indexed** | ДА |
| `EntityEvent.chapter_number` | `enumerate(chapters)` idx | **0-indexed** | ДА |
| `visual_summary [Глава N]` | `enumerate(chapters)` idx | **0-indexed** | ДА |

---

## 4. Критическое расхождение с выводами задачи 002

### 4.1. Задача 002 утверждает: «isEntityMet сравнивает 0-indexed mentions с 1-indexed currentChapter»

**НЕВЕРНО.** `mentions` формируется из `Chapter.chapter_number` (строки 257, 476 в `entity_service.py`), что даёт 1-indexed значения. Функция `isEntityMet()` работает корректно.

### 4.2. Задача 002 утверждает: «сущности залочены на последней главе из-за 0-индексации»

**НЕ ПОДТВЕРЖДАЕТСЯ.** 0-индексация делает значения **меньше** на 1. Это значит фильтры `reveal_chapter <= current_chapter` и `chapter_number <= current_chapter` пропускают данные **раньше**, а не позже. Эффект — мелкие спойлеры (показ на 1 главу раньше), но **не блокировка**.

### 4.3. Задача 002 утверждает: «При исправлении 0→1 проблема решится»

**ЧАСТИЧНО ВЕРНО.** Фикс устранит:
- Визуальные артефакты (`[Глава 0]` → `[Глава 1]`)
- Преждевременное раскрытие алиасов и событий
- Некорректный badge `first_mention_chapter`

Но **не устранит** симптом «залочены на последней главе», если он реально наблюдается.

---

## 5. Верифицированные проблемы

### P1. Преждевременное раскрытие событий и алиасов

**Файлы:** `entity_service.py:89, 114`
**Механизм:**

```python
# entity_service.py:89
return [e for e in events if e.get("chapter_number", 0) <= current_chapter]
# event.chapter_number = 0 (для фактической главы 1)
# current_chapter = 1
# 0 <= 1 → True → событие из главы 1 показывается → правильно
# Но event.chapter_number = 1 (для фактической главы 2)
# current_chapter = 1
# 1 <= 1 → True → событие из главы 2 ТОЖЕ показывается → СПОЙЛЕР
```

**Влияние:** Пользователь на главе N видит события и алиасы из главы N+1. Мелкий спойлер, но не блокировка.

### P2. Визуальные артефакты в visual_summary

**Файл:** `consistency_manager.py:94`

```python
chapter_marker = f"[Глава {chapter_index}]" if chapter_index else ""
```

Маркеры показывают `[Глава 0]`, `[Глава 1]`... вместо `[Глава 1]`, `[Глава 2]`...
В фильтрации `entity_service.py:148-149` сравнение `chapter_num <= current_chapter` тоже сдвинуто на 1.

### P3. Badge `first_mention_chapter` показывает неверное значение

**Файл:** `consistency_manager.py:384`

Хранится 0-indexed значение. На фронтенде badge для «первое упоминание» показывает номер на 1 меньше реального.

---

## 6. Python truthiness-баг: глава 0

**Не обнаружен задачей 002. Новая находка.**

**Файл:** `consistency_manager.py:94`

```python
chapter_marker = f"[Глава {chapter_index}]" if chapter_index else ""
```

Когда `chapter_index = 0` (первая глава при 0-индексации), Python трактует `0` как `False`. Результат: **первая глава не получает маркера `[Глава 0]`** — её описание уходит в «базовый текст» visual_summary.

**Последствия:**
- Базовый текст в `entity_service.py:135-137` **всегда показывается** без фильтрации по главе
- Если первая глава содержит важное описание, оно не может быть отфильтровано
- При исправлении 0→1 этот баг **самоустранится**, так как chapter_index=1 является truthy

---

## 7. Анализ симптома «сущности залочены на последней главе»

### Гипотезы, требующие проверки

Поскольку 0-indexed баг **не объясняет** блокировку сущностей на последней главе, предлагаю альтернативные гипотезы:

#### Гипотеза A: Пустой массив `mentions` для некоторых сущностей

Если у сущности нет ни `EntityMention`, ни `Description` записей — `mentions` будет пустым. По fail-open стратегии (`entityUtils.ts:10`) сущность покажется. **Не объясняет блокировку.**

#### Гипотеза B: Сущности созданы, но descriptions привязаны только к последней главе

Если при обработке книги ошибки в ранних главах привели к потере descriptions, а успешно обработалась только последняя — все `mentions` будут содержать только последнюю главу.

**Проверить:** Для книги `2625cfba` запросить `SELECT chapter_number, COUNT(*) FROM descriptions WHERE book_id = '2625cfba...' GROUP BY chapter_number`.

#### Гипотеза C: Баг кеширования (P0-1 из аудита 24 февраля)

Аудит от 24.02 выявил P0-1: cache HIT в entity_service возвращал данные **без фильтрации по главе**. Если первый запрос к кешу пришёл от пользователя на последней главе — все последующие пользователи видели бы данные, отфильтрованные до последней главы.

**Статус:** Исправлено в v5 кеша (`entity_service.py:179`). Но если книга была обработана **до** фикса — в кеше могли остаться устаревшие данные.

#### Гипотеза D: Race condition при параллельной обработке глав

При `asyncio.gather` для параллельных глав возможна ситуация, когда entity создаётся в последней главе (она завершилась первой), а обновления из ранних глав проигрываются через `ON CONFLICT DO UPDATE` — но **не обновляют** `first_mention_chapter` (оно не входит в `set_` блок upsert).

**Файл:** `consistency_manager.py:393-399`

```python
stmt = stmt.on_conflict_do_update(
    index_elements=["book_id", "name_lower"],
    set_={
        "entity_metadata": stmt.excluded.entity_metadata,
        "aliases_with_reveal": stmt.excluded.aliases_with_reveal,
        "updated_at": func.now(),
    },
    # ⚠️ first_mention_chapter НЕ ОБНОВЛЯЕТСЯ при конфликте!
)
```

Если последняя глава обработалась первой → entity создан с `first_mention_chapter=19` (для 20-главной книги). Когда первая глава обрабатывается позже → ON CONFLICT не обновляет `first_mention_chapter`. **Это выглядит как наиболее вероятная причина симптома.**

---

## 8. Перекрёстная проверка с предыдущими отчётами

| Отчёт | Связь с текущим аудитом |
|-------|-------------------------|
| **2026-02-24 Entity Wiki Audit v2** | Подтвердил P0-1 (кеширование), P1-1 (maxChapterReached). Не обнаружил 0-indexed баг. Фикс кеша (v4→v5) развёрнут. |
| **2026-02-06 LLM Pipeline Analysis** | Описал `visual_summary` как «сырой лог с маркерами `[Глава N]`». Не обратил внимание на 0-индексацию маркеров. |
| **2026-02-25 Locale C Audit** | Описал цепочку падения `lower()` + `locale C`. Не связан с индексацией, но показывает хрупкость entity pipeline. |
| **2026-01-25 Entity Refactoring Status** | 29/29 задач выполнены. Тесты на граничные значения нумерации глав **отсутствовали**. |
| **2026-02-25 Gemini Cache Bug** | Баг парсинга кеша (data/metadata wrapping). Может приводить к 0 descriptions при reprocessing → пустые mentions. |

---

## 9. Рекомендации

| # | Рекомендация | Приоритет | Сложность | Обоснование |
|---|--------------|-----------|-----------|-------------|
| 1 | **Проверить книгу `2625cfba` на продакшене:** распределение descriptions по главам, значения first_mention_chapter, наличие EntityMention записей | **P0** | Низкая | Без данных с продакшена невозможно подтвердить корневую причину |
| 2 | **Исправить ON CONFLICT: добавить `first_mention_chapter` в `set_` с `LEAST()`** | **P0** | Низкая | Гипотеза D — наиболее вероятная причина «залочены на последней главе» |
| 3 | **Исправить enumerate → chapter.chapter_number** в `book_tasks.py:575, 411, 424` | **P1** | Низкая | Реальный баг, но направление ошибки — преждевременное раскрытие, не блокировка |
| 4 | **Alembic-миграция: сдвиг 0→1** для `first_mention_chapter`, `EntityEvent.chapter_number`, `aliases_with_reveal[].reveal_chapter` | **P1** | Средняя | Исправление существующих данных |
| 5 | **Исправить truthiness-баг:** `if chapter_index is not None` вместо `if chapter_index` | **P1** | Низкая | Устранится автоматически при переходе на 1-indexed |
| 6 | **Добавить boundary-тесты** для спойлер-фильтрации: глава 1, последняя глава, единственная глава | **P1** | Средняя | Предотвращение регрессий |
| 7 | **Очистить Redis-кеш** для книги `2625cfba` после исправлений | **P1** | Низкая | Устаревшие данные в кеше |

---

## 10. Приложение: таблица коммитов

| Дата | Коммит | Описание | Влияние на индексацию |
|------|--------|----------|----------------------|
| 26 янв | `ad91165` | Split tasks.py → book_tasks.py | **Введён** enumerate (0-indexed) |
| 27 янв | `9caf776` | Extract services from routers | Нет влияния |
| 29 янв | `f72a914` | LLM caching, CFI endpoint | Нет влияния |
| 31 янв | `6031dde` | Spoiler protection, first_mention_chapter | **Расширено** использование 0-indexed |
| 1 фев | `5738aa5` | Fix chapter index vs offset | Поправлена семантика, **не база** |
| 4 фев | `529ef8e` | Fix 57 failing tests | Нет влияния |
| 7 фев | `f67234a` | Phase 2: EntityEvent, synthesis | **Расширено** 0-indexed на events |
| 25 фев | `6b7dd3b` | Race condition fix (ON CONFLICT) | **Потенциально усугубил** (см. Гипотезу D) |
| 25 фев | `0bed92d` | Casefold fix for locale C | Нет влияния |
