# Entity Wiki + Description Pipeline — Design Document

**Date:** 2026-02-06
**Status:** Iteration 2 complete — ready for /writing-plans
**Based on:** `docs/reports/2026-02-06-llm-pipeline-analysis.md`, `docs/plans/2026-02-06-entity-wiki-iteration2-prep.md`

---

## 1. Problem Statement

Текущая Entity-система оптимизирована для генерации иллюстраций (visual descriptions → Imagen), но слабо работает как интерактивная энциклопедия. Пользователь ожидает «кто такой этот персонаж?», а получает «описание сцены, где персонаж упоминается». Нет биографии, роли, событий, хронологии.

Description pipeline оптимизирован для Imagen, но не для пользователя: все описания подсвечиваются одинаково, highlight покрывает весь text node, нет визуальной иерархии, нет контекста сцены.

## 2. UX Design

### 2.1. Три режима доступа

- **Entity name tap** — тап по подсвеченному имени в тексте → мини-карточка (popup)
- **Full wiki** — EntityDrawer с полным профилем через кнопку «Подробнее»
- **Description tap** — тап по подсветке описания → модал с оригинальным текстом + AI-изображение

### 2.2. Entity Name Highlighting в тексте

Имена entities подсвечиваются в epub тексте для quick lookup:

- **Стиль:** dotted underline, цвет `var(--text-tertiary)` — мягкий, ненавязчивый
- **Плотность:** только первое упоминание каждой entity per chapter
- **Toggle:** настройка «Подсветка имён: вкл/выкл», по умолчанию вкл
- **Реализация:** EntityMention.mention_text + start_index → `<span class="entity-mention">`
- **Визуальное разделение от описаний:** описания = цветной background, имена = только underline

```css
.entity-mention {
  text-decoration: underline dotted;
  text-decoration-color: var(--text-tertiary);
  text-underline-offset: 2px;
  cursor: pointer;
}
```

### 2.3. Мини-карточка (popup)

```
┌──────────────────────────────────────────┐
│ [Avatar]  Северус Снейп                  │
│           Двойной агент                  │  ← dynamic_role (из milestone)
│           ──────────────────────         │
│           Человек в чёрной мантии        │  ← visual_summary_clean (≤80 chars)
│           с крючковатым носом            │
│           ──────────────────────         │
│           Гл.5: Ведёт урок зельеварения, │  ← последний event
│           открыто унижает Гарри          │
│           ──────────────────────         │
│           4 связи                    ▸   │
└──────────────────────────────────────────┘
```

**Данные:** `dynamic_role || base_role_label` (из текущего milestone), truncated `visual_summary_clean`, последний event, `edges.length`.

### 2.4. Полный профиль (EntityProfile в drawer)

**Секции (жанрово-нейтральные названия):**

1. **Шапка** — аватар (или иконка-плейсхолдер по типу), имя, role badge (dynamic_role из milestone или base_role на RU), importance stars (из milestone)
2. **«О персонаже»** — biography (из текущего milestone), 2-4 предложения
3. **«Внешность»** — visual_summary_clean (из текущего milestone)
4. **«По главам»** — EntityEvents: action обычным шрифтом, inner_state курсивом. Множественные events под одним номером главы
5. **Связи** — список с типами, тип актуальный для текущей главы (relationship evolution)
6. **Галерея** — аватар + сцены где entity = focus (DescriptionEntity.is_focus = true)
7. **Псевдонимы** — aliases_with_reveal, отфильтрованные по текущей главе

**Удалено:** секция «История» (notes) — заменена biography + events + gallery.

Все данные spoiler-free: отображаются только до effectiveChapter (= max reached).

**Аватары-плейсхолдеры** для entities с importance < 7 (без сгенерированного аватара):
- Character: силуэт
- Location: иконка здания
- Object: иконка предмета

### 2.5. Recap / «Ранее в книге»

Top-5 entities по текущему importance (из milestone) с последним event перед current_chapter. Доступен из EntityDrawer. Полезен после перерыва в чтении.

### 2.6. Description Modal — «Книга vs AI»

При тапе на description highlight открывается модал:

1. **scene_context** — 1 предложение: кто присутствует, что происходит (заголовок)
2. **Оригинальный текст автора** — цитата из книги, по которой сгенерировано изображение
3. **AI-изображение** — сгенерированная иллюстрация

Технический content (для Imagen) скрыт от пользователя.

### 2.7. Description Peek

Long press / hover на description highlight → маленький thumbnail (150x150) над текстом. Тап → полный модал. Для описаний без готового изображения — показать scene_context в popup.

## 3. Data Model Changes

### 3.1. Изменения в Entity

```python
# Новые поля в backend/app/models/entity.py

biography_milestones: Mapped[list[dict] | None] = mapped_column(
    JSONB, nullable=True
)
# Формат: [{"up_to_chapter": 5, "biography": "...", "visual_summary_clean": "...",
#            "dynamic_role": "Учитель", "importance": 7}, ...]

base_role: Mapped[str | None] = mapped_column(
    String(50), nullable=True
)
# Enum: protagonist, antagonist, supporting, episodic
# Только для type=character. Для location/object = null.
```

**Убрано с Entity уровня:** `dynamic_role` — теперь только внутри milestones.

`visual_summary` (raw лог с маркерами) — остаётся как source of truth.
`visual_summary_clean` — хранится внутри milestones.

### 3.2. Milestone структура

```json
{
  "up_to_chapter": 5,
  "biography": "Бывший студент, одержимый теорией...",
  "visual_summary_clean": "Молодой человек лет 23, худой и бледный...",
  "dynamic_role": "Идеолог-убийца",
  "importance": 7
}
```

**Правила:**
- LLM решает когда biography «существенно изменилась» (новый факт, смена роли, ключевое событие)
- Soft limit: 3-10 milestones на entity
- Первое появление — обязательный milestone
- Адаптация по типу entity: character → биография, location → история места, object → значимость

### 3.3. Новая модель EntityEvent

```python
class EntityEvent(Base):
    __tablename__ = "entity_events"

    id: UUID (PK)
    entity_id: FK → Entity
    chapter_id: FK → Chapter
    chapter_number: int           # Для быстрой spoiler-фильтрации
    event_action: Text            # "Посещает старуху-процентщицу"
    event_inner_state: Text | None  # "Отвращение к плану"
    created_at: DateTime
```

Нет unique constraint на (entity_id, chapter_id) — множество events per entity per chapter.

**Дедупликация:** в consistency_manager после extraction — SequenceMatcher > 0.8 для events одной entity в одной главе, оставлять более длинный.

### 3.4. Taxonomy ролей

**base_role (фиксированный enum, только character):**

| Ключ | RU (фронтенд) |
|------|---------------|
| `protagonist` | Главный герой |
| `antagonist` | Антагонист |
| `supporting` | Значимый персонаж |
| `episodic` | Эпизодический |

Маппинг на русский — на фронтенде (`baseRoleLabels`).

**dynamic_role (free text, per milestone):**
LLM определяет книго-специфичные роли на момент каждого milestone. Отображается приоритетно перед base_role. Адаптируется по типу entity:
- Character: «Следователь», «Двойной агент»
- Location: «Место преступления», «Штаб-квартира»
- Object: «Улика», «Оружие убийства»

### 3.5. Расширение типов отношений

**Добавлены:**

| Ключ | RU (фронтенд) |
|------|---------------|
| `ROMANCE` | Любовь |
| `RIVAL` | Соперник |

**Полный список:** KINSHIP, ALLY, ENEMY, FRIEND, MENTOR, STUDENT, ROMANCE, RIVAL.

### 3.6. Relationship Evolution

Новое JSONB поле в EntityRelationship:

```python
relationship_milestones: Mapped[list[dict] | None] = mapped_column(
    JSONB, nullable=True
)
# Формат: [{"up_to_chapter": 10, "type": "ENEMY", "weight": -60},
#           {"up_to_chapter": 25, "type": "ALLY", "weight": 70}]
```

Фронтенд показывает тип связи актуальный для текущей главы. LLM определяет при synthesis.

### 3.7. Изменения в DescriptionEntity

```python
# Новое поле
is_focus: Mapped[bool] = mapped_column(Boolean, default=False)
# True = описание ПОСВЯЩЕНО этой entity (портрет, описание места)
# False = entity просто упомянута в сцене
```

LLM определяет focus при extraction. Entity Gallery показывает только `is_focus = True`.

### 3.8. Изменения в Description

Поле `context` (уже существует, не заполняется) — заполнять при extraction:

```python
context: Mapped[str | None] = mapped_column(Text, nullable=True)
# "Гарри входит в библиотеку Хогвартса перед экзаменами"
```

## 4. LLM Pipeline Changes

### 4.1. Фаза 1 — Расширение per-chapter extraction

**Изменения в `GeminiEntitySchema`:**

```python
class GeminiEntitySchema(BaseModel):
    # ... существующие поля ...
    chapter_event_action: str | None = None
    chapter_event_inner: str | None = None
```

**Добавление в entity extraction промпт (≈5 строк):**

```
Для каждой сущности укажи главное СОБЫТИЕ этой главы:
- chapter_event_action: что персонаж ДЕЛАЕТ (одно предложение)
- chapter_event_inner: что персонаж ЧУВСТВУЕТ/ДУМАЕТ (одно предложение или null)
- Если персонаж только упоминается, но не действует — оба поля null
```

**Добавление в TSA extraction промпт (≈3 строки):**

```
Для каждого описания укажи:
- context: 1 предложение — кто присутствует и что происходит в сцене
- is_focus_entity: имя entity, которой ПОСВЯЩЕНО описание (портрет, описание места), или null если общая сцена
```

**Сохранение в `consistency_manager.py`:**

- После создания EntityMention — создаём EntityEvent (если action не null)
- Дедупликация events: SequenceMatcher > 0.8 для одной entity + главы
- Description.context заполняется из extraction
- DescriptionEntity.is_focus устанавливается по is_focus_entity

### 4.2. Фаза 2 — Synthesis post-book

**Новый сервис:** `entity_synthesis_service.py`

**Место в pipeline (book_tasks.py):**

```
1. Parallel chapter extraction (Фаза 1) ← chapter_events, context, is_focus
2. Entity optimization (Reduce)
3. LLM deduplication
4. ★ Entity synthesis (Фаза 2) — NEW
5. Graph PageRank
6. Master reference generation
```

**Input synthesis-промпта:**

Все entities книги с их:
- raw visual_summary
- все EntityEvents (chapter_number + action + inner_state)
- aliases, importance
- type (character / location / object)
- полный список имён всех entities (для контекста ролей)
- Book.genre, Book.language

**Genre-aware инструкции в synthesis prompt:**

```
Жанр книги: {genre}. Язык книги: {language}.
Генерируй biography, events, dynamic_role на языке книги.

Жанровые акценты:
- DETECTIVE: мотивы, подозрения, алиби, улики, допросы
- FANTASY: способности, фракции, магические свойства, битвы
- ROMANCE: эмоции, развитие отношений, ключевые моменты
- THRILLER: угрозы, решения под давлением, конфликты
- HISTORICAL: исторический контекст, социальные роли
- Для остальных жанров: общий фокус на действиях и развитии
```

**Type-aware инструкции:**

```
Адаптируй контент по типу entity:
- character: biography = биография, events = действия + чувства
- location: biography = история и атмосфера места, events = что здесь происходит
- object: biography = значимость в сюжете, events = найден/использован/упомянут
```

**Output synthesis-промпта:**

```json
{
  "entities": [
    {
      "name": "Родион Раскольников",
      "base_role": "protagonist",
      "milestones": [
        {
          "up_to_chapter": 1,
          "biography": "Бывший студент, одержимый теорией...",
          "visual_summary_clean": "Молодой человек лет 23, худой и бледный...",
          "dynamic_role": "Нищий студент",
          "importance": 6
        },
        {
          "up_to_chapter": 5,
          "biography": "Бывший студент, совершивший убийство...",
          "visual_summary_clean": "Молодой человек лет 23, худой и бледный, в потрёпанном мундире...",
          "dynamic_role": "Идеолог-убийца",
          "importance": 9
        }
      ]
    }
  ],
  "relationship_milestones": [
    {
      "source": "Раскольников",
      "target": "Соня Мармеладова",
      "milestones": [
        {"up_to_chapter": 3, "type": "FRIEND", "weight": 30},
        {"up_to_chapter": 10, "type": "ROMANCE", "weight": 80}
      ]
    }
  ]
}
```

**Правила milestones:**

- LLM решает когда biography «существенно изменилась» (новый факт, смена роли, ключевое событие)
- Soft limit: 3-10 milestones на entity
- Первое появление — обязательный milestone
- Каждый milestone содержит biography + visual_summary_clean + dynamic_role + importance
- Язык контента = Book.language
- Явный запрет галлюцинаций: «НЕ выдумывай факты, которых нет в предоставленных данных»

**Batching:**

- entities ≤ 80 → один LLM-вызов
- entities > 80 → batch'и по ~50, каждый batch содержит полный список имён всех entities

**Failure recovery:**

- Каждый batch: retry 2 раза с tenacity
- Успешные batches сохраняются независимо от неудачных
- Если batch упал после retry: entities получают fallback (biography = null)
- Фронтенд показывает events без biography как fallback
- Книга помечается `synthesis_partial = true` для последующего retry

## 5. Caching Strategy

### 5.1. RAW Cache + On-the-fly Filtering

**Проблема (Iteration 1 bug):** кэш без current_chapter в ключе → milestone-система неработоспособна.

**Решение:** кэшировать RAW данные (все milestones, events, aliases), фильтровать при каждом запросе:

```python
cache_key = f"book:{book_id}:entity_network_raw_v4"
# Содержит ВСЕ данные, без фильтрации по главе

# При запросе:
raw_data = await cache_manager.get(cache_key)
filtered = filter_by_chapter(raw_data, current_chapter=effective_chapter)
```

**Фильтрация (~1ms, чистый Python):**
1. **biography** — max milestone where `up_to_chapter <= effective_chapter`
2. **visual_summary_clean** — из того же milestone
3. **dynamic_role** — из того же milestone
4. **importance** — из того же milestone
5. **events** — EntityEvents where `chapter_number <= effective_chapter`
6. **aliases** — существующая фильтрация по reveal_chapter
7. **edges** — relationship_milestones: max where `up_to_chapter <= effective_chapter`

**effective_chapter** = `Math.max(currentChapter, maxChapterReached)` — «нельзя развидеть».

**Инвалидация:** при обновлении entity данных (новая глава обработана, synthesis завершён).

## 6. API Changes

### 6.1. EntityDetailSchema

```python
class EntityDetailSchema(BaseModel):
    # Существующие
    id, name, type, avatar_url, mentions
    first_mention_cfi, first_mention_offset, first_mention_chapter
    aliases

    # Обновлённые (из milestone)
    biography: str | None = None
    base_role: str | None = None
    dynamic_role: str | None = None
    visual_summary_clean: str | None = None
    importance: int = 0

    # Новые
    events: list[EntityEventSchema] = []
```

**Удалено из API:** `notes` (notes убраны из UI).

### 6.2. NetworkEdgeSchema

```python
class NetworkEdgeSchema(BaseModel):
    source, target
    type: str              # Актуальный для effective_chapter
    weight: int            # Актуальный для effective_chapter
    description: str | None
    first_interaction_cfi: str | None
    first_interaction_chapter: int | None
```

### 6.3. RecapSchema

```python
class RecapSchema(BaseModel):
    entities: list[RecapEntitySchema]  # Top-5 by importance

class RecapEntitySchema(BaseModel):
    id: UUID
    name: str
    avatar_url: str | None
    dynamic_role: str | None
    last_event: EntityEventSchema | None
```

**Endpoint:** `GET /books/{book_id}/recap?current_chapter=N`

## 7. Description Pipeline Changes

### 7.1. Type-based Highlight Colors

| Тип описания | Цвет фона | Ассоциация |
|-------------|-----------|------------|
| location | Голубой | Маркер на карте |
| character | Фиолетовый | Портрет |
| atmosphere | Янтарный | Настроение |
| object | Зелёный | Артефакт |

### 7.2. Position-aware Search Strategies

Текущие 8 strategies возвращают `boolean`. Изменение:

```typescript
interface StrategyResult {
  found: boolean;
  startIdx?: number;  // позиция в normalized тексте
  endIdx?: number;
}
```

- Strategies работают с normalized текстом (как сейчас), но возвращают позицию match
- Mapping-функция normalized offset → original text offset
- Node splitting: before | match (highlighted) | after
- Убрать `break` после первого match — поддержка нескольких описаний в одном text node

### 7.3. Image Availability Indicator

- Есть изображение: solid underline / более яркий фон
- Нет изображения: dashed underline / приглушённый фон
- Данные: Description → Image relationship

### 7.4. Quality Tiers

| Tier | Критерии | Поведение |
|------|----------|-----------|
| Highlighted | priority > 50, confidence > 0.6 | Подсветка в тексте |
| Hidden | остальное | Не подсвечивать |

Настройка в ReaderControls: «Все» / «Ключевые» (default) / «Выкл»

### 7.5. Description Peek

Long press / hover → thumbnail 150x150 над текстом (если изображение есть) или scene_context popup (если нет). Тап → полный модал.

## 8. Frontend Changes

### 8.1. Новые файлы / изменения

| Файл | Изменение |
|------|-----------|
| `types/entity.ts` | Добавить `biography`, `base_role`, `dynamic_role`, `visual_summary_clean`, `importance`, `events` |
| `EntityCard.tsx` | Role badge, visual_summary_clean, последний event |
| `EntityProfile.tsx` | Убрать notes. Новые секции: «О персонаже», «По главам», «Галерея» |
| `EntityDrawer.tsx` | Recap кнопка/секция |
| `entityLabels.ts` | `baseRoleLabels`, `relationshipTypeLabels` (+ROMANCE, +RIVAL) |
| `EntityEventTimeline.tsx` | Новый: секция «По главам» |
| `EntityGallery.tsx` | Новый: фильтрация по is_focus |
| `EntityMiniCard.tsx` | Новый: popup мини-карточка |
| `EntityNameHighlighter.tsx` | Новый: подсветка имён в epub |
| `RecapPanel.tsx` | Новый: «Ранее в книге» |
| `useDescriptionHighlighting.ts` | Type-based цвета, position-aware strategies, node splitting, quality tiers, peek |
| `strategies.ts` | Возвращать `StrategyResult` вместо `boolean` |
| `ImageModal.tsx` | scene_context + оригинальный текст + изображение |
| `RelationshipCard.tsx` | +ROMANCE, +RIVAL с иконками и RU-labels |
| `ReaderControls.tsx` | Toggle: подсветка имён, плотность описаний |

### 8.2. Новые RU-labels

```typescript
const baseRoleLabels = {
  protagonist: 'Главный герой',
  antagonist: 'Антагонист',
  supporting: 'Значимый персонаж',
  episodic: 'Эпизодический',
};

const relationshipTypeLabels = {
  ...existing,
  ROMANCE: 'Любовь',
  RIVAL: 'Соперник',
};
```

## 9. Deferred (Future Iterations)

| Фича | Причина отложения |
|------|-------------------|
| Progressive descriptions (E1) | Требует text offsets, intersection observer — большой scope |
| Inline images (E2) | Зависит от progressive descriptions |
| Backfill для существующих книг (B5) | Отдельная задача после основной реализации |
| Description analytics (D11) | Метрики после запуска, не до |
| Description text offsets (D12) | Нет прямой пользы для текущего highlighting |
| personality_traits (B7) | Biography покрывает |

---

*Iteration 2 complete. All open questions from Iteration 1 resolved. Next: /writing-plans.*
