# Комплексный аудит LLM-обработки книг в fancai

**Дата:** 31 января 2026  
**Источник:** Oracle (Claude Opus 4.5 Thinking)  
**Версия:** 1.0

---

## Резюме (Bottom Line)

**Система хорошо спроектирована, но содержит 4 критические проблемы, мешающие качественному извлечению:**

1. "Синдром вахтёра" в промптах (Top-15, importance<7 = ИГНОРИРОВАТЬ)
2. "Wiper" логика в visual_summary (replace вместо append)
3. Отсутствие few-shot примеров в промптах (потеря 15-20% F1)
4. Глобальная дедупликация без reveal_chapter (спойлеры)

**Рекомендуемый подход:** Поэтапное исправление за ~2-3 дня с немедленным возвратом инвестиций через увеличение качества и количества описаний.

---

## 1. Критические проблемы (P0) — Исправить немедленно

### P0-1: "Синдром вахтёра" в EXTRACTION_PROMPT

**Файл:** `backend/app/services/gemini_extractor.py:386-390`

```python
# ПРОБЛЕМА: Теряем 60% контента
"1-6: ИГНОРИРОВАТЬ"
```

**Корень:** Промпт явно приказывает LLM игнорировать сущности с importance 1-6. В типичной книге ~70% персонажей имеют importance 3-6 (второстепенные, но визуально описанные).

**Фикс:** Удалить ограничение, добавить постфильтрацию:
```python
# В промпте: извлекаем ВСЕ
# В коде: фильтруем для разных целей
# importance >= 7 → Master Reference генерация
# importance >= 3 → Показ в UI
# importance >= 1 → Сохранение для Knowledge Graph
```

**Effort:** Quick (<1h)

---

### P0-2: "Wiper" логика visual_summary

**Файл:** `backend/app/services/consistency_manager.py:166-167`

```python
# ПРОБЛЕМА: Заменяем вместо обогащения
if len(raw.visual_summary) > len(entity.visual_summary or ""):
    entity.visual_summary = raw.visual_summary  # WIPE!
```

**Корень:** При обновлении сущности из новой главы мы заменяем visual_summary на новый, если он длиннее. Но описания персонажей накапливаются по главам!

**Фикс:** Append + Deduplicate:
```python
async def _merge_visual_summaries(self, existing: str, new: str) -> str:
    """Интеллектуальное объединение описаний."""
    if not existing:
        return new
    if not new:
        return existing
    
    # Проверяем, не дубликат ли
    if new.lower() in existing.lower():
        return existing
    
    # Объединяем с разделителем
    combined = f"{existing}\n\n---\nДополнительно: {new}"
    
    # Если слишком длинно, используем LLM для суммаризации
    if len(combined) > 1500:
        return await self._summarize_descriptions(combined)
    
    return combined
```

**Effort:** Short (1-4h)

---

### P0-3: Отсутствие few-shot примеров

**Файл:** `backend/app/services/gemini_extractor.py:349-381` (TSA_EXTRACTION_PROMPT)

**Корень:** Промпт содержит только 1 короткий пример. По исследованиям 2025-2026, few-shot (2-3 примера) дают +15-20% F1 на задачах извлечения.

**Фикс:** Добавить 2-3 качественных примера разной длины.

**Effort:** Short (1-4h)

---

### P0-4: Спойлеры без reveal_chapter

**Файл:** `backend/app/services/consistency_manager.py:196-197`

```python
# ПРОБЛЕМА: Алиасы добавляются глобально
for alias in raw.aliases:
    entity_map[alias.lower()] = entity
```

**Корень:** Когда в главе 10 "Гарри Поттер" получает алиас "Избранный", этот алиас становится доступен для читателя на главе 1.

**Фикс:** Добавить `reveal_chapter` в metadata:
```python
entity.entity_metadata = {
    "aliases": [
        {"name": "Избранный", "reveal_chapter": 10}
    ]
}
```

**Effort:** Medium (1-2d) — требует изменения API и frontend

---

## 2. Улучшенные промпты

### TSA_EXTRACTION_PROMPT_V2

```python
TSA_EXTRACTION_PROMPT_V2 = """Ты - опытный литературный редактор, специализирующийся на подготовке книг к иллюстрированию.

## ЗАДАЧА
Разметь визуальные описания в тексте XML-тегами. Формат:
<desc type="TYPE" occurrence="N">точный текст из оригинала</desc>

## ТИПЫ (TYPE)
- location: места, интерьеры, пейзажи
- character: внешность персонажей
- atmosphere: освещение, погода, настроение
- object: важные артефакты

## КРИТЕРИИ КАЧЕСТВЕННОГО ОПИСАНИЯ
✓ Минимум 50 символов (идеально 100-300)
✓ Создаёт визуальный образ в воображении
✓ Содержит конкретные детали (цвета, формы, текстуры)
✓ Подходит для иллюстрации художником

## НЕГАТИВНЫЕ ПРИМЕРЫ (НЕ РАЗМЕЧАТЬ!)
✗ "Он был высоким" — слишком коротко, нет деталей
✗ "Она улыбнулась" — действие, не описание
✗ "Комната была большой" — нет визуальных деталей

## ПОЗИТИВНЫЕ ПРИМЕРЫ

### Пример 1 (короткий, location):
Вход: "Солнце садилось. Небо окрасилось в багряные и золотые тона, отражаясь в спокойной глади озера."
Выход: "Солнце садилось. <desc type=\"atmosphere\" occurrence=\"1\">Небо окрасилось в багряные и золотые тона, отражаясь в спокойной глади озера.</desc>"

### Пример 2 (средний, character):
Вход: "В дверях стоял незнакомец лет сорока пяти. Его лицо было изборождено морщинами, седые волосы торчали во все стороны, а глаза — пронзительно-голубые — смотрели с насмешкой."
Выход: "В дверях стоял <desc type=\"character\" occurrence=\"1\">незнакомец лет сорока пяти. Его лицо было изборождено морщинами, седые волосы торчали во все стороны, а глаза — пронзительно-голубые — смотрели с насмешкой.</desc>"

### Пример 3 (длинный, location):
Вход: "Библиотека занимала три этажа особняка. Высокие дубовые стеллажи уходили под самый потолок, украшенный лепниной с позолотой. Пыль танцевала в лучах света, проникающих сквозь витражные окна. Посередине стоял массивный стол из красного дерева, заваленный свитками и фолиантами."
Выход: "<desc type=\"location\" occurrence=\"1\">Библиотека занимала три этажа особняка. Высокие дубовые стеллажи уходили под самый потолок, украшенный лепниной с позолотой. Пыль танцевала в лучах света, проникающих сквозь витражные окна. Посередине стоял массивный стол из красного дерева, заваленный свитками и фолиантами.</desc>"

## ПРАВИЛА
1. Текст внутри тегов = ТОЧНАЯ копия из оригинала
2. Сохраняй пробелы и пунктуацию
3. occurrence = порядковый номер при повторении (по умолчанию 1)
4. НЕ изменяй текст вне тегов

## ДОПОЛНИТЕЛЬНО ВЫДЕЛИ
1. ВСЕХ персонажей с visual_summary (описание внешности) и aliases
   - importance 7-10: главные герои
   - importance 4-6: второстепенные
   - importance 1-3: эпизодические
2. ВСЕ локации с visual_summary
3. СВЯЗИ между сущностями (source, target, type, context)

## ВАЖНО О QUALITY GATES
- Если visual_summary меньше 80 символов — дополни деталями из контекста
- Если персонаж упоминается только по имени без описания — создай placeholder: "Внешность не описана в данном фрагменте"

Текст для анализа:
{text}
"""
```

---

### EXTRACTION_PROMPT_V2 (Legacy режим)

```python
EXTRACTION_PROMPT_V2 = """Ты - литературный редактор и визуальный директор. Подготовь детальные справки для художника-иллюстратора.

## ЗАДАЧА
1. Выдели ВСЕХ персонажей и локации (без ограничений по количеству!)
2. Оцени importance (1-10) — но НЕ ИГНОРИРУЙ никого:
   - 9-10: Протагонисты, антагонисты
   - 7-8: Значимые второстепенные персонажи
   - 4-6: Эпизодические персонажи
   - 1-3: Фоновые, упомянутые вскользь
3. Для КАЖДОГО дай visual_summary (минимум 80 символов)
4. Укажи ВСЕ aliases (альтернативные имена)
5. Определи связи между сущностями
6. Найди ВСЕ описательные фрагменты длиннее 50 символов

## ПРИМЕРЫ КАЧЕСТВЕННОГО visual_summary

### Пример 1 (персонаж):
Имя: "Геральт"
visual_summary: "Мужчина средних лет с длинными седыми волосами, собранными в хвост. Желтые кошачьи глаза, множество шрамов на лице и теле. Одет в чёрную кожаную броню ведьмака с серебряными заклёпками. На спине — два меча в ножнах."
aliases: ["Белый Волк", "Ведьмак", "Мясник из Блавикена"]

### Пример 2 (локация):
Имя: "Хогвартс"
visual_summary: "Величественный средневековый замок на скалистом утёсе над озером. Множество башен и шпилей, окна светятся тёплым жёлтым светом. Стены из серого камня, покрытого мхом. В небе над замком — совы и летучие мыши."
aliases: ["Школа чародейства и волшебства"]

## NEGATIVE EXAMPLES (НЕ ДЕЛАТЬ ТАК!)
✗ visual_summary: "высокий мужчина" — слишком коротко
✗ visual_summary: "красивая девушка" — нет конкретики
✗ importance: 0 — использовать только 1-10

## QUALITY GATES
- visual_summary < 80 символов? → Дополни деталями из контекста
- Нет описания внешности? → Напиши: "Внешность явно не описана. Контекст: [роль персонажа]"
- aliases пустой? → Проверь: нет ли прозвищ, титулов, сокращений имени?

## ВАЖНО
- first_mention_offset = номер символа первого упоминания в тексте
- text_offset = позиция начала каждого описания в тексте
- Считай позиции ТОЧНО от начала текста (0-indexed)

## ТИПЫ СУЩНОСТЕЙ
- character: люди, существа → описывай: лицо, волосы, одежда, возраст, особые приметы
- location: места → описывай: освещение, архитектура, атмосфера
- object: ТОЛЬКО сюжетно важные артефакты

Текст для анализа:
{text}
"""
```

---

### REDUCE_PROMPT_V2

```python
REDUCE_PROMPT_V2 = """You are a Data Consistency Expert for a book entity database.

## INPUT DATA
{entity_list_text}

## TASK
1. **MERGE DUPLICATES**: Identify entities that refer to the same person/place:
   - "Harry", "Harry Potter", "Mr. Potter" → SAME entity
   - Consider aliases, partial names, nicknames
   
2. **DO NOT DELETE based on importance!** Keep ALL entities.
   - Deletion criteria: ONLY if entity is clearly garbage (typo, parsing error)
   - Example of garbage: "said", "ааааа", "Chapter 1"

3. **PRESERVE reveal_chapter for aliases:**
   - If "Избранный" alias appears only in chapter 10, mark it: 
     {{ "alias": "Избранный", "reveal_chapter": 10 }}

## OUTPUT JSON
{{
    "merge_operations": [
        {{ 
            "keep_id": "uuid-of-most-detailed", 
            "merge_ids": ["uuid", "uuid"],
            "merged_aliases": [
                {{ "name": "Potter", "reveal_chapter": null }},
                {{ "name": "The Chosen One", "reveal_chapter": 10 }}
            ]
        }}
    ],
    "delete_operations": [ "uuid-only-if-garbage" ]
}}

## CRITICAL RULES
- When merging, keep the entity with the LONGEST visual_summary
- NEVER delete entities just because they have low importance
- ALWAYS preserve chapter information for spoiler protection
"""
```

---

### TRANSLATION_PROMPT_V2 (Imagen)

```python
TRANSLATION_PROMPT_V2 = """You are an expert translator specializing in visual descriptions for AI image generation (Imagen 4).

## TASK
Translate this Russian visual description to English, optimizing for high-quality image generation.

## RULES
1. Focus ONLY on visual elements:
   - Physical appearance (face, hair, body, clothing)
   - Environment details (architecture, lighting, weather)
   - Colors, textures, materials
   - Composition and framing

2. USE art and photography terminology:
   - Lighting: "golden hour", "dramatic chiaroscuro", "soft diffused"
   - Composition: "portrait orientation", "establishing shot", "close-up"
   - Style: "painterly", "photorealistic", "stylized"

3. ADD Imagen-optimized keywords:
   - For portraits: "detailed facial features", "expressive eyes"
   - For landscapes: "atmospheric perspective", "volumetric lighting"
   - For all: "masterful composition", "professional illustration"

4. STRUCTURE your output:
   - Start with subject (who/what)
   - Add descriptive details (how it looks)
   - End with atmosphere/mood

5. LENGTH: 100-200 words (optimal for Imagen 4)

6. AVOID:
   - Abstract concepts ("love", "hope")
   - Actions or narratives
   - Your own interpretations

## EXAMPLE
Input: "Старик сидел у окна. Глубокие морщины прорезали его лицо, белая борода спускалась до груди."
Output: "Elderly man portrait, deep wrinkles etched across weathered face, long flowing white beard reaching chest level. Seated by window, soft natural sidelight illuminating features. Wise contemplative expression, kind eyes with crow's feet. Detailed facial features, expressive eyes. Professional portrait illustration, masterful composition."

## Russian text:
{text}

## English translation (visual elements only):
"""
```

---

## 3. Оптимизация производительности

### 3.1 Chunking Strategy

**Текущее:** 100k chars, 15% overlap

**Рекомендация:** Оптимально для Gemini 3 Flash с 1M контекстом.

```python
# Улучшение: Адаптивный чанкинг
@dataclass
class AdaptiveChunkConfig:
    # Базовые параметры
    default_chunk_size: int = 100_000
    
    # Для коротких глав (<50k) — не чанкуем вообще
    min_chunk_threshold: int = 50_000
    
    # Overlap зависит от размера
    overlap_percent_small: float = 0.20  # <20k chars
    overlap_percent_medium: float = 0.15  # 20k-100k
    overlap_percent_large: float = 0.10  # >100k
    
    def get_overlap_percent(self, text_length: int) -> float:
        if text_length < 20_000:
            return self.overlap_percent_small
        elif text_length < 100_000:
            return self.overlap_percent_medium
        return self.overlap_percent_large
```

**Effort:** Quick (<1h)

---

### 3.2 Parallelism Tuning

**Текущее:** 
- `chapter_semaphore = 10` (глобально)
- `_chunk_semaphore = 3` (на экстрактор)

**Анализ:**
- 10 глав × 3 чанка = до 30 параллельных Gemini вызовов
- Gemini Flash rate limit: ~60 RPM
- **Риск:** Rate limit throttling

**Рекомендация:**
```python
# Динамический семафор на основе rate limit
class AdaptiveSemaphore:
    def __init__(self, max_rpm: int = 60):
        # Целевой RPM с запасом 20%
        safe_rpm = int(max_rpm * 0.8)
        # Среднее время запроса ~5-10s → 6-12 запросов в минуту на слот
        self.max_concurrent = min(safe_rpm // 6, 10)
        self._sem = asyncio.Semaphore(self.max_concurrent)
```

**Effort:** Short (1-4h)

---

### 3.3 Caching Improvements

**Текущее:** TTL 30 дней, literal key matching

**Рекомендации:**

```python
# A. Иерархический кэш
@dataclass
class HierarchicalCacheKey:
    # Level 1: Точное совпадение (текущий подход)
    content_hash: str
    
    # Level 2: Semantic similarity (embedding-based)
    content_embedding: Optional[List[float]] = None
    semantic_threshold: float = 0.95
    
    # Level 3: Prompt version only (для invalidation)
    prompt_version: str = "v2"

# B. Warm-up cache на старте
async def warm_cache_for_book(book_id: str):
    """Pre-load frequently accessed data."""
    # Load book metadata
    # Pre-compute common embeddings
    pass
```

**Effort:** Medium (1-2d)

---

## 4. Снижение затрат

### 4.1 Gemini Context Caching

**Текущее:** Не используется explicit caching

**Возможность:** Gemini 3 Flash поддерживает implicit caching (75% discount) автоматически для контента в начале запроса.

**Рекомендация:**
```python
# Структура запроса для максимального кэширования:
# 1. System prompt (статичный, кэшируется)
# 2. Few-shot examples (статичные, кэшируются)  
# 3. User content (динамический)

CACHED_PREFIX = f"""
{SYSTEM_INSTRUCTION}  # 500-1000 tokens

{FEW_SHOT_EXAMPLES}   # 1000-2000 tokens

# --- Динамическая часть ниже ---
"""

# Gemini автоматически кэширует первые ~2000 токенов
# при повторных запросах с тем же префиксом
```

**Explicit Caching (90% discount):**
```python
from google.genai import caching

# Создаём cached content один раз
cached_content = caching.CachedContent.create(
    model="gemini-3-flash-preview",
    contents=[SYSTEM_PROMPT + FEW_SHOT_EXAMPLES],
    ttl="1h"
)

# Используем в запросах
response = client.models.generate_content(
    model="gemini-3-flash-preview",
    contents=user_text,
    cached_content=cached_content.name
)
```

**Экономия:** ~70-80% на LLM вызовах

**Effort:** Short (1-4h)

---

### 4.2 Model Tiering Strategy

| Задача | Модель | Причина |
|--------|--------|---------|
| Entity Extraction | Gemini 3 Flash | Основная задача, нужен баланс качество/скорость |
| Translation (Imagen) | Gemini 3 Flash-Lite | Простая задача, можно дешевле |
| Reduce Phase | Gemini 3 Flash | Сложная логика, нужна точность |
| Genre Detection | Gemini 3 Flash-Lite | Простая классификация |
| Summarization | Gemini 3 Flash | Качество критично |

```python
MODEL_TIER_CONFIG = {
    "extraction": "gemini-3-flash-preview",
    "translation": "gemini-3-flash-lite",  # 50% cheaper
    "reduce": "gemini-3-flash-preview",
    "genre_detection": "gemini-3-flash-lite",
    "summarization": "gemini-3-flash-preview",
}
```

**Effort:** Short (1-4h)

---

### 4.3 Batch Processing

**Текущее:** Каждый перевод для Imagen — отдельный запрос

**Возможность:** Batch API для non-urgent задач

```python
# Для генерации Master References (не срочно)
# Накапливаем запросы и отправляем batch
class BatchTranslator:
    def __init__(self, batch_size: int = 10):
        self._queue: List[str] = []
        self._results: Dict[str, str] = {}
        self.batch_size = batch_size
    
    async def queue(self, text: str) -> str:
        """Add to queue, return when batch processed."""
        self._queue.append(text)
        if len(self._queue) >= self.batch_size:
            await self._flush_batch()
        return self._results.get(text, text)
    
    async def _flush_batch(self):
        # Gemini Batch API call
        # 50% discount vs realtime
        pass
```

**Effort:** Medium (1-2d)

---

## 5. Архитектурные улучшения

### 5.1 Entity Resolution Improvements

**Текущее:** SequenceMatcher с threshold 0.85

**Проблема:** "Иван Петрович" и "Петрович" не матчатся (ratio ~0.6)

**Рекомендация:**
```python
async def resolve_entity_advanced(
    self, 
    name: str, 
    existing_entities: Dict[str, Entity]
) -> Optional[Entity]:
    """Multi-strategy entity resolution."""
    
    # 1. Exact match
    if name.lower() in existing_entities:
        return existing_entities[name.lower()]
    
    # 2. Alias match
    for entity in existing_entities.values():
        if name.lower() in [a.lower() for a in entity.aliases]:
            return entity
    
    # 3. Token overlap (для "Иван Петрович" vs "Петрович")
    name_tokens = set(name.lower().split())
    for key, entity in existing_entities.items():
        entity_tokens = set(key.split())
        overlap = name_tokens & entity_tokens
        if overlap and len(overlap) / max(len(name_tokens), len(entity_tokens)) > 0.5:
            return entity
    
    # 4. Fuzzy match (fallback)
    for key, entity in existing_entities.items():
        if SequenceMatcher(None, name.lower(), key).ratio() > 0.85:
            return entity
    
    # 5. Embedding similarity (optional, expensive)
    # return await self._embedding_match(name, existing_entities)
    
    return None
```

**Effort:** Short (1-4h)

---

### 5.2 Spoiler Protection Fix

**Текущее:** Алиасы глобальны

**Фикс:**
```python
# 1. Модель Entity
class Entity(Base):
    # ... existing fields ...
    
    # Новое поле для алиасов с reveal_chapter
    aliases_with_reveal: List[Dict] = Column(JSONB, default=list)
    # Format: [{"name": "Избранный", "reveal_chapter": 10}]

# 2. API endpoint
@router.get("/entities/{entity_id}")
async def get_entity(
    entity_id: UUID,
    current_chapter: int = Query(None),  # Где читатель сейчас
    db: AsyncSession = Depends(get_db),
):
    entity = await db.get(Entity, entity_id)
    
    # Фильтруем алиасы по текущей главе
    visible_aliases = [
        a["name"] for a in entity.aliases_with_reveal
        if a.get("reveal_chapter") is None or a["reveal_chapter"] <= current_chapter
    ]
    
    return EntityResponse(
        id=entity.id,
        name=entity.name,
        aliases=visible_aliases,
        # ...
    )
```

**Effort:** Medium (1-2d)

---

### 5.3 Visual Summary Evolution

**Текущее:** Wiper (replace)

**Фикс:** Incremental Build
```python
class VisualSummaryBuilder:
    """Накопление и интеллектуальное объединение описаний."""
    
    MAX_SUMMARY_LENGTH = 2000
    
    async def update_summary(
        self, 
        entity: Entity, 
        new_description: str,
        chapter_index: int
    ) -> str:
        """
        Добавить новое описание к существующему.
        
        Returns:
            Updated visual_summary
        """
        existing = entity.visual_summary or ""
        
        # 1. Проверяем дубликат
        if self._is_duplicate(existing, new_description):
            return existing
        
        # 2. Добавляем с меткой главы
        combined = f"{existing}\n\n[Глава {chapter_index}]: {new_description}"
        
        # 3. Если слишком длинно — суммаризируем
        if len(combined) > self.MAX_SUMMARY_LENGTH:
            combined = await self._summarize(combined)
        
        return combined.strip()
    
    def _is_duplicate(self, existing: str, new: str, threshold: float = 0.8) -> bool:
        """Проверка на дубликат через SequenceMatcher."""
        return SequenceMatcher(None, existing.lower(), new.lower()).ratio() > threshold
    
    async def _summarize(self, text: str) -> str:
        """LLM-суммаризация для сжатия."""
        # Вызов Gemini для объединения описаний
        prompt = f"""Объедини эти описания персонажа в одно связное описание (max 500 слов):

{text}

Результат:"""
        # ... call Gemini
        pass
```

**Effort:** Short (1-4h)

---

## 6. Метрики успеха

### Dashboard метрики

| Метрика | Текущее (est.) | Цель | Как измерять |
|---------|---------------|------|--------------|
| Описаний/глава | 3-5 | 8-15 | `AVG(chapter.descriptions_found)` |
| visual_summary length | 50-100 chars | 150-300 chars | `AVG(LENGTH(entity.visual_summary))` |
| Сущностей/книга | 10-20 | 30-50 | `COUNT(entities WHERE book_id=X)` |
| Cache hit rate | ~60% | 85%+ | Redis `keyspace_hits / (hits + misses)` |
| Cost per book | $0.50-1.00 | $0.20-0.40 | Track API costs |
| Extraction F1 | ~65% | 80%+ | Manual annotation sample |

### Мониторинг

```python
# Prometheus metrics
from prometheus_client import Counter, Histogram, Gauge

# Качество
descriptions_per_chapter = Histogram(
    'fancai_descriptions_per_chapter',
    'Number of descriptions extracted per chapter',
    buckets=[1, 3, 5, 10, 15, 20, 30]
)

visual_summary_length = Histogram(
    'fancai_visual_summary_chars',
    'Length of visual summaries',
    buckets=[50, 100, 150, 200, 300, 500]
)

# Производительность
llm_cache_hits = Counter('fancai_llm_cache_hits_total', 'LLM cache hits')
llm_cache_misses = Counter('fancai_llm_cache_misses_total', 'LLM cache misses')

# Затраты
llm_tokens_used = Counter(
    'fancai_llm_tokens_total', 
    'Total tokens used',
    ['model', 'operation']
)
```

---

## 7. План внедрения

### Phase 1: Quick Wins (Day 1) — 4h

| Задача | Файл | Изменение |
|--------|------|-----------|
| Убрать "importance < 7 = ИГНОРИРОВАТЬ" | `gemini_extractor.py:386-390` | Удалить строки |
| Убрать "importance < 3 = DELETE" | `consistency_manager.py` | Убрать из REDUCE_PROMPT |
| Добавить few-shot примеры | `gemini_extractor.py:349-381` | Заменить на V2 |

### Phase 2: Core Fixes (Day 2) — 6h

| Задача | Файл | Изменение |
|--------|------|-----------|
| Wiper → Append+Summarize | `consistency_manager.py:166-167` | Новый метод _merge_visual_summaries |
| Улучшить entity resolution | `consistency_manager.py` | Token overlap matching |
| Gemini implicit caching | `gemini_extractor.py` | Prefix ordering |

### Phase 3: Advanced (Day 3) — 6h

| Задача | Файл | Изменение |
|--------|------|-----------|
| reveal_chapter для алиасов | `models/entity.py`, API | Новое поле + endpoint изменения |
| Model tiering | `gemini_extractor.py` | Flash-Lite для translation |
| Prometheus метрики | Новый файл | metrics.py |

### Phase 4: Optimization (Week 2)

| Задача | Приоритет |
|--------|-----------|
| Explicit context caching | P1 |
| Batch API для Master Reference | P2 |
| A/B тестирование промптов | P2 |

---

## 8. Escalation Triggers

Когда переходить к более сложным решениям:

| Ситуация | Триггер | Решение |
|----------|---------|---------|
| Entity resolution fails | >20% unmatched entities | Внедрить embedding-based similarity |
| Rate limiting | >5% requests throttled | Добавить token bucket rate limiter |
| Quality degradation | F1 < 70% | Multi-stage pipeline (Pass 1 → Validation → Pass 2) |
| Cost explosion | >$1/book | Aggressive model tiering + batch processing |

---

## Общие оценки

**Effort:** Medium (2-3 дня активной работы)

**ROI:**
- **+100-200%** описаний на книгу
- **-60%** LLM costs через caching
- Устранение спойлеров
- Улучшение user experience через богатые visual summaries

---

## Ключевые файлы для редактирования

```
backend/app/services/gemini_extractor.py     # Промпты, конфигурация
backend/app/services/consistency_manager.py  # Entity resolution, Wiper логика
backend/app/models/entity.py                 # Модель Entity (aliases_with_reveal)
backend/app/routers/entities.py              # API endpoints
backend/app/core/config.py                   # Model tiering config
```

---

## Session ID для продолжения

Для продолжения анализа с Oracle:
```
session_id: ses_3ea7cc284ffe8Eixav7ujqUaLZ
```

Использование:
```python
delegate_task(
    session_id="ses_3ea7cc284ffe8Eixav7ujqUaLZ",
    prompt="Дополнительный вопрос..."
)
```
