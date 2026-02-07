# Entity Wiki + Description Pipeline — Подготовка к Iteration 2

**Дата:** 2026-02-06
**Ревизия:** 2 (дополнен глубоким анализом description pipeline)
**Метод:** Повторный анализ кодовой базы + 3 параллельных агента-исследователя + свежий взгляд на Iteration 1
**Цель:** Выявить неточности, пропуски, новые идеи для brainstorm iteration 2

---

## A. Ошибки и неточности в Iteration 1 Design

### A1. БАГ: Кэширование ломает milestone-систему

**Проблема:** `EntityService.get_book_entity_network()` (entity_service.py:110-116) кэширует УЖЕ отфильтрованный по `current_chapter` ответ на 1 час:

```python
cache_key = f"book:{book_id}:entity_network_v3"  # БЕЗ current_chapter!
cached_data = await cache_manager.get(cache_key)
```

Если пользователь прочитал главу 5 → кэш записан с данными до главы 5. Через 10 минут он на главе 10 → получает старый кэш с данными до главы 5. Биографии, events, visual_summary_clean — всё устарело.

**Влияние:** Milestone-система Iteration 1 неработоспособна без исправления. Два варианта:
- Кэшировать RAW (без фильтрации) и фильтровать на лету на бэкенде
- Включить `current_chapter` в cache_key (простой, но больше ключей)

### A2. Quick Lookup popup — нет технической базы

**Проблема:** Дизайн описывает «тап по имени в тексте → мини-карточка». Но в кодовой базе:
- `useDescriptionHighlighting.ts` подсвечивает **описания** (сцены), а не имена сущностей
- Имена сущностей в epub тексте **НЕ кликабельны**
- Единственный доступ к сущностям — кнопка «Энциклопедия» → EntityDrawer

Реализация quick lookup — **отдельный крупный workstream**:
1. Найти все упоминания имён/aliases в тексте главы (используя EntityMention.mention_text + start_index)
2. Обернуть их в кликабельные `<span class="entity-mention">`
3. Показать popup на тап
4. Отдельная стилизация от description highlights (чтобы не путать)

**Альтернатива (C4):** Quick lookup через выделение текста — проще.

### A3. effectiveChapter vs currentChapter — семантический разрыв

**Проблема:** EntityDrawer.tsx:46:
```typescript
const effectiveChapter = Math.max(currentChapter, maxChapterReached || 0);
```

Дизайн говорит «milestone по current_chapter». Фронтенд использует **max reached**.

**Вопрос:** current position vs max reached? Для spoiler-free: max reached (нельзя «развидеть»). Для immersive re-reading: current position.

### A4. Гранулярность milestones слишком высока

**Проблема:** «Milestone на каждой главе, где есть EntityEvent». Для протагониста в длинном романе — 100-200+ milestones.

**Конкретный расчёт:**
- 200 milestones × (200 chars biography + 100 chars visual) = 60K chars per entity в JSONB
- 80 entities × 60K = 4.8MB на книгу только в milestones
- Synthesis output: 80 entities × 200 milestones × 300 chars = 4.8M chars → далеко за пределами output limit Gemini (32K tokens ≈ 128K chars)

**Решение:** LLM в synthesis prompt сам решает, когда biography «существенно изменилась». Правила:
- Milestone обязателен для первого появления
- Далее — только при значимом изменении (новый факт, смена роли, ключевое событие)
- Ориентир: 3-10 milestones на entity, не на каждой главе

### A5. Event дедупликация при перекрытии chunks

**Проблема:** Chunks перекрываются на 15% (15K chars из 100K). Одно событие → два EntityEvent:
- Chunk A: «Гарри получает письмо»
- Chunk B (overlap): «Гарри получает письмо из Хогвартса»

**Решение для дизайна:** Дедупликация events в consistency_manager после извлечения:
- SequenceMatcher(event_a.action, event_b.action) > 0.8 → merge, оставить более длинный
- Только для events одной сущности в одной главе

### A6. (НОВОЕ) dynamic_role должен меняться по milestones

**Проблема:** dynamic_role — одно значение per entity. Но:
- Снейп: «Учитель» → «Шпион» → «Двойной агент»
- Romance: «Незнакомец» → «Возлюбленный» → «Жених»

**Решение:** dynamic_role включить в milestone структуру:
```json
{"up_to_chapter": 5, "biography": "...", "visual_summary_clean": "...", "dynamic_role": "Учитель"}
```

### A7. (НОВОЕ) Synthesis prompt output limit

**Расчёт для 80 entities:**
- Input: 80 × ~2500 chars = 200K chars ≈ 50K tokens → FITS (1M context)
- Output: 80 entities × 5 milestones × 300 chars = 120K chars ≈ 30K tokens → на грани 32K output limit

**Для 200+ entities:**
- Batching по 50 необходим
- Каждый batch содержит полный список имён для контекста ролей

### A8. (НОВОЕ) Нет плана на случай failure synthesis

Synthesis — один гигантский LLM-вызов. Если он упадёт:
- Ни одна entity не получит milestones
- Нужна стратегия: batch-level retry, partial results saving, fallback (показать events без biography)

---

## B. Пропущенные темы

### B1. Локации и объекты — wiki для НЕ-персонажей

Entity имеет 3 типа: character, location, object. Дизайн фокусируется только на character.

| Поле | Character | Location | Object |
|------|-----------|----------|--------|
| biography | Биография | «История места» | «Значимость артефакта» |
| base_role | protagonist/.../episodic | null (или отдельный enum?) | null |
| dynamic_role | «Следователь» | «Место преступления» | «Оружие убийства» |
| events | «Делает X» | «Здесь происходит X» | «Найден/использован» |
| visual_summary_clean | Внешность | Описание | Описание |
| inner_state | Чувства | N/A | N/A |

**Вопрос:** Один universal synthesis prompt с type-aware инструкциями, или отдельные промпты по типу?

### B2. Расширение типов отношений

Текущие (RelationshipCard.tsx): KINSHIP, ALLY, ENEMY, FRIEND, MENTOR, STUDENT.

Недостающие:
- **ROMANCE** — любовная линия
- **RIVAL** — конкуренция без вражды
- **COLLEAGUE** — профессиональные
- **SERVANT/MASTER** — иерархия

### B3. Эволюция отношений по главам

Relationship — статический снимок. Нет механизма:
- ENEMY → ALLY (Снейп в HP)
- STRANGER → FRIEND → ROMANCE (любой роман)

### B4. Язык книги ≠ русский

`Book.language` может быть "en", "de". dynamic_role, biography, events должны генерироваться на языке книги.

### B5. Backfill для существующих книг

Книги без events/milestones: нужна Celery-задача ре-синтеза. Можно ли synthesis без events (только по visual_summary)?

### B6. Genre доступен, но не используется

`Book.genre`: FANTASY, DETECTIVE, SCIFI, HISTORICAL, ROMANCE, THRILLER, HORROR, CLASSIC, OTHER.

### B7. personality_traits и structured_appearance

Предлагались в анализе, но не вошли в Iteration 1. Стоит ли включить?

---

## C. Новые идеи (Entity Wiki)

### C1. Genre-aware synthesis prompt

Не жанровые секции в UI (отвергнуто), а жанровые **инструкции в промпте**:
```
Жанр: {genre}. Если детектив: акцент на мотивах, подозрениях.
Если романтика: акцент на эмоциях, развитии отношений.
Если фэнтези: акцент на способностях, фракциях.
```
UI одинаковый. Контент адаптируется.

### C2. Эволюция importance

importance per milestone → отражает развитие персонажа. Или автоматический пересчёт по кол-ву events.

### C3. «Recap» / «Ранее в книге»

Top-5 сущностей с последним event перед current_chapter. Полезно после перерыва.

### C4. Quick lookup через выделение текста

Long-press/выделение слова → поиск в entity names/aliases → popup. Проще, чем полная подсветка имён.

### C5. Удалить секцию «История» (notes) из EntityProfile

С biography + events + gallery → notes (сырые scene descriptions) избыточны.

---

## D. НОВОЕ: Анализ Description Pipeline — проблемы и улучшения

### D1. Highlighting — нет визуальной иерархии

**Текущее:** ВСЕ описания подсвечиваются одинаковым amber/orange цветом. Нет различия между:
- 3-абзацным описанием пейзажа
- Кратким упоминанием одежды
- Атмосферным описанием

**Решение:** Type-based цвета подсветки:
| Тип | Цвет | Ассоциация |
|-----|------|------------|
| location | Голубой | Как маркер на карте |
| character | Фиолетовый/тёплый | Портрет |
| atmosphere | Янтарный (текущий) | Настроение |
| object | Зелёный | Артефакт |

Создаёт визуальный язык: читатель видит голубой — знает, что это место; видит фиолетовый — описание внешности.

### D2. Нет индикации наличия изображения

**Текущее:** Пользователь кликает highlight и или видит изображение (если сгенерировано), или ждёт генерации. Нет способа узнать заранее.

**Решение:** Подсвечивать описания с готовыми изображениями иначе:
- Solid border (есть изображение) vs dashed border (нет)
- Или маленькая иконка камеры на краю highlight

### D3. Highlight покрывает ВЕСЬ текстовый узел, а не только описание

**Код (useDescriptionHighlighting.ts:118-131):**
```typescript
if (highlightDescription(norm, patterns, norm.length)) {
    const span = doc.createElement('span');
    span.textContent = text;  // ← ВЕСЬ текст узла!
    node.parentNode?.replaceChild(span, node);
}
```

Если абзац = «Он вошёл. *Библиотека занимала три этажа...*» — подсвечивается ВСЁ, включая «Он вошёл.»

**Причина:** Все 8 strategies возвращают `boolean`, а не позицию match'а в тексте.

**Решение:** Strategies должны возвращать `{found: boolean, startIdx?: number, endIdx?: number}`. Тогда можно:
1. Разбить text node на 3 части: before | match (highlighted) | after
2. Оборачивать только match часть

### D4. Один highlight per text node — пропуск описаний

**Код (строка 129):** `break;` после первого match. Если text node содержит ДВА описания — подсвечивается только первое.

**Решение:** Не ломать цикл + node-splitting из D3.

### D5. Нет контроля плотности подсветки

**Проблема:** В богато описанных книгах (Толкиен, Достоевский) каждый абзац подсвечен → «стена подсветок», мешает чтению.

**Решение:**
- Настройка в ReaderControls: density (off / key scenes / all)
- Авто-фильтрация по priority_score (показывать только priority > 50)
- Toggle highlights on/off

### D6. Промпт оптимизирован для художника, не для читателя

**TSA_EXTRACTION_PROMPT** (gemini_extractor.py:394-451):
```
«Ты - опытный литературный редактор, специализирующийся
на подготовке книг к иллюстрированию»
```
Фокус: «цвета, формы, текстуры, подходит для иллюстрации художником».

**Следствие:** Описания технические, не user-facing. Пользователь видит:
- «Тёмный коридор с каменными стенами, освещённый мерцающим пламенем факелов» ← для Imagen
- А ожидает: контекст сцены, кто присутствует, что происходит

**Решение для brainstorm:**
- Описания для Imagen оставить как есть
- Добавить к Description модели: `scene_context: str` — краткое описание ЧТО происходит в этой сцене
- Или показывать в modal не `content` (технический), а `context` (уже есть поле в Description, но не заполняется!)

### D7. Нет inline preview — обязательный модал

**Текущее:** Тап на highlight → открывается full-screen модал → прерывает чтение.

**Решение:** «Peek» — при hold/hover показать маленький thumbnail над текстом (150x150px). Тап → полный модал.

Аналогия: как 3D Touch / Haptic Touch на iOS показывает превью ссылки.

### D8. Description-Entity link не различает фокус

**Текущее:** `DescriptionEntity` связывает description со ВСЕМИ упомянутыми entities. Но:
- «Гарри стоял в библиотеке» → linked to Гарри + Библиотека
- Это ПОРТРЕТ Гарри? Или описание БИБЛИОТЕКИ?

**Решение:** Добавить `is_focus: bool` к DescriptionEntity. Primary entity = focus. Для Entity Gallery: показывать descriptions где entity = focus, а не просто упомянут.

### D9. Нет quality tiers для описаний

**Текущее:** Все описания с confidence > 0.4 и length > 80 подсвечиваются одинаково.

**Решение — три тира:**
| Tier | Критерии | Поведение |
|------|----------|-----------|
| Tier 1 (авто) | confidence > 0.8, length > 150, priority > 70 | Подсветка + авто-генерация изображения |
| Tier 2 (по клику) | confidence > 0.5, length > 80 | Подсветка, генерация по клику |
| Tier 3 (скрытый) | остальное | Не подсвечивать |

### D10. Genre-specific image стили хардкожены

**ImagenPromptEngineer** (imagen_generator.py:251-287) содержит:
```python
FANTASY: "ethereal glow, magical atmosphere"
DETECTIVE: "film noir shadows, venetian blinds"
```

**Проблемы:**
- Genre может быть неправильно определён (или OTHER)
- Нет пользовательского выбора стиля
- Стили статичные, не адаптируются к конкретной книге

**Решение:** user-adjustable image style preference + авто-определение стиля из текста.

### D11. Нет аналитики качества highlighting

**Проблема:** Нет данных:
- Сколько описаний успешно подсвечено? (match rate из 8 strategies)
- Какие strategies используются чаще? (для оптимизации)
- Кликают ли пользователи на описания? (engagement)
- Нравятся ли сгенерированные изображения? (regeneration rate)

**Решение:** Минимальная аналитика: match rate, click rate, regen rate → инструмент для тюнинга промптов.

### D12. Position_in_chapter ≠ text position

**Проблема:** `Description.position_in_chapter` — порядковый номер описания (0, 1, 2...), НЕ character offset в тексте. Для progressive highlighting (показывать описания по мере прокрутки) нужен реальный text offset.

**Текущее:** TSA Parser возвращает `start`/`end` (character offsets), но они сохраняются в Description модели как... нигде. Только `position_in_chapter` = sequential index.

**Решение:** Сохранять `text_start_offset` и `text_end_offset` из TSAParser в Description модели.

---

## E. Новые идеи: Description Pipeline

### E1. «Живые иллюстрации» — progressive description reveal

Описания появляются по мере прокрутки читателя, а не все сразу при загрузке главы. Создаёт эффект «книга оживает на глазах».

**Реализация:** Использовать text offset (D12) + CFI/scroll position → показывать подсветки только для текста, который reader уже прошёл.

### E2. «Авто-иллюстрация» — inline images

Вместо подсветки с модалом — показать изображение прямо в тексте, как в физической иллюстрированной книге. Для Tier 1 описаний (D9) автоматически вставлять inline image после абзаца.

### E3. «Книга vs AI» — сравнение текста и изображения

Показать текст описания рядом с сгенерированным изображением. Читатель видит: «вот что написал автор» vs «вот как AI это представил». Образовательный и вовлекающий UX.

### E4. scene_context — наполнение существующего поля

Description модель имеет `context: Text | None` — сейчас не заполняется. Можно:
- Заполнять при extraction: 1-2 предложения контекста вокруг описания
- Показывать в ImageModal вместо/вместе с техническим content

### E5. Связь Description Pipeline ↔ Entity Wiki

Description и Entity Wiki — взаимосвязанные системы:

| Description Pipeline | Entity Wiki | Связь |
|---------------------|-------------|-------|
| Extraction prompt | Entity extraction | ОДНА Gemini-сессия |
| Description.type = character | Entity.visual_summary | Один и тот же текст |
| DescriptionEntity links | Entity Gallery | Images для entity |
| Description images | Entity avatar/portrait | master_portrait_url |
| Description position | Entity first_mention | Spoiler timing |

**Ключевой вывод:** Улучшение description pipeline автоматически улучшает Entity Wiki, и наоборот. Их следует проектировать как единую систему.

---

## F. Дополнительные находки (свежий взгляд, раунд 2)

### F1. EntityEvent не имеет CFI

EventEvent имеет `chapter_id` и `chapter_number`, но не CFI. Spoiler-фильтрация только по главам, не по позиции.

Если в главе 5 три события — все видны при входе в главу 5, даже если третье событие в конце главы.

**Принятый компромисс:** chapter-level granularity для events. CFI для events требовал бы конвертации text_offset → CFI, что слишком сложно.

### F2. Synthesis prompt failure recovery

Нет плана на failure. Synthesis — один большой LLM-вызов. При сбое ни одна entity не получает milestones.

**Решение:** batch-level retry + partial results saving + fallback (показать events без biography).

### F3. Description.context field не используется

`Description.context: Text | None` существует в модели, но:
- Не заполняется при extraction
- Не показывается на фронтенде
- Мог бы содержать "контекст сцены" для лучшего UX

### F4. Master portrait generation порог importance >= 7

`consistency_manager.py:415-424` генерирует аватары только для entities с importance >= 7. Это значит:
- Второстепенные персонажи (importance 4-6) не имеют аватаров
- В Entity Wiki они показываются с fallback (первая буква имени)

**Вопрос:** Снизить порог для wiki? Или генерировать аватары по запросу?

### F5. Description model уже имеет is_suitable_for_generation и priority_score

Модель Description (description.py:107-155) имеет развитую систему приоритизации:
- `priority_score`: 0-100, рассчитывается по type + confidence + length
- `is_suitable_for_generation`: boolean quality gate
- Формула: LOCATION (75 base) > CHARACTER (60) > ATMOSPHERE (45) > OBJECT (40) > ACTION (30)

Это уже ЕСТЬ, но frontend его не использует для highlighting. Все описания подсвечиваются одинаково.

### F6. ImagenPromptEngineer уже genre-aware

`imagen_generator.py:251-287` содержит стили для КАЖДОГО жанра:
- Fantasy: "ethereal glow, magical atmosphere, enchanted forest tones"
- Detective: "film noir shadows, venetian blinds light, 1940s decor"
- Romance: "soft lighting, pastel tones"
- Horror: "dark shadows, eerie lighting"
- и т.д.

Но Entity Wiki synthesis prompt (новый) НЕ учитывает genre. Несоответствие.

---

## G. Обновлённая повестка Iteration 2

### MUST (обязательно обсудить):

| # | Тема | Секция | Суть |
|---|------|--------|------|
| 1 | Кэш | A1 | Как исправить для milestone-системы? |
| 2 | effectiveChapter | A3 | current vs max reached для milestones? |
| 3 | Milestone density | A4 | «Значимые изменения» вместо каждой главы |
| 4 | Location/Object wiki | B1 | Как адаптировать дизайн для не-персонажей? |
| 5 | Genre-aware synthesis | C1 + F6 | Использовать Book.genre в synthesis prompt |
| 6 | Description highlighting | D1-D5 | Визуальная иерархия, точность, плотность |
| 7 | dynamic_role per milestone | A6 | Роль меняется по ходу книги |

### SHOULD (стоит обсудить):

| # | Тема | Секция | Суть |
|---|------|--------|------|
| 8 | Highlight точность | D3-D4 | Position-aware strategies, node-splitting |
| 9 | Image availability indicator | D2 | Визуальное различие: есть/нет изображение |
| 10 | Quality tiers | D9 | Tier 1/2/3 по confidence + priority |
| 11 | Inline preview (peek) | D7 | Thumbnail без полного модала |
| 12 | scene_context | D6, E4 | Контекст сцены вместо технического описания |
| 13 | Типы отношений | B2 | ROMANCE, RIVAL, COLLEAGUE |
| 14 | Event dedup | A5 | Дедупликация при overlap chunks |
| 15 | Quick Lookup стратегия | A2, C4 | Техническая стратегия: highlighting vs selection |
| 16 | Notes removal | C5 | Удалить «Историю» из EntityProfile? |
| 17 | Synthesis failure | A8, F2 | Retry, partial results, fallback |

### NICE-TO-HAVE (если будет время):

| # | Тема | Секция | Суть |
|---|------|--------|------|
| 18 | Progressive descriptions | E1 | Описания появляются по мере прокрутки |
| 19 | Inline images | E2 | Изображения в тексте, как в иллюстрированной книге |
| 20 | «Книга vs AI» | E3 | Сравнение текста и изображения |
| 21 | Recap | C3 | «Ранее в книге» из EntityEvents |
| 22 | Importance evolution | C2 | importance per milestone |
| 23 | Relationship evolution | B3 | Типы связей меняются по главам |
| 24 | Backfill | B5 | Re-synthesis для существующих книг |
| 25 | Description analytics | D11 | Match rate, click rate, regen rate |
| 26 | Description text offsets | D12 | Сохранять start/end в Description модели |
| 27 | Avatar generation порог | F4 | Снизить importance threshold для wiki |
| 28 | Мультиязычность | B4 | Synthesis на языке книги |
| 29 | personality_traits | B7 | Структурированные черты характера |
| 30 | Description-Entity focus | D8 | is_focus для точной Entity Gallery |

---

*Документ подготовлен для brainstorm iteration 2. Revision 2 — дополнен глубоким анализом description pipeline (секции D, E, F).*
