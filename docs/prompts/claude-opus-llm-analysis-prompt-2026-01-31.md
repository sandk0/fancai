# Промпт для Claude 4.5 Opus Thinking: Глубокий анализ LLM-обработки книг

**Дата создания:** 31 января 2026  
**Версия:** 1.0  
**Цель:** Комплексный анализ качества промптов, оптимизации производительности и снижения затрат в LLM-пайплайне fancai

---

## Инструкция для использования

Скопируйте весь контент ниже (начиная с `---НАЧАЛО ПРОМПТА---`) и отправьте в Claude 4.5 Opus Thinking.

---

---НАЧАЛО ПРОМПТА---

# Задача: Комплексный аудит LLM-обработки книг в проекте fancai

Ты — эксперт по LLM-инженерии и оптимизации AI-систем с глубоким пониманием:
- Prompt Engineering (CoT, few-shot, structured output)
- Gemini API и Google AI SDK (context caching, batch processing)
- Imagen 4 (prompt optimization для качественной генерации)
- Оптимизации затрат на LLM (caching, tiering, batching)
- Архитектуры production LLM-пайплайнов

## Контекст проекта

**fancai** — веб-приложение для чтения книг с AI-обогащением:
- **Gemini 3 Flash** для извлечения сущностей (персонажи, локации, связи) и описаний из текста
- **Imagen 4** для генерации иллюстраций по описаниям
- **Redis** для кэширования LLM-ответов
- **Celery** для асинхронной обработки книг
- **PostgreSQL** для хранения сущностей, связей, описаний

### Проблемы, выявленные ранее (из отчёта регрессии)

| # | Проблема | Корневая причина |
|---|----------|------------------|
| 1 | Мало коротких описаний | "Синдром вахтёра" в промптах (Top-15, Importance<7=ИГНОРИРОВАТЬ) |
| 2 | Описания не отображаются в карточках | Backend не сохраняет context в relationships |
| 3 | Visual summary статичное | Логика "Wiper" — сохраняется только самое длинное описание |
| 4 | Мало сущностей и связей | Те же ограничения Top-15 + Importance фильтрация |
| 5 | Нет информации о главе в карточках | Frontend не получает chapter_index из metadata |
| 6 | Баг защиты от спойлеров | Глобальная дедупликация без учёта reveal_chapter |
| 7 | Несовпадение текста описаний | TSA offset расхождения + highlight matching |

---

## Код для анализа

### 1. Главный экстрактор — `gemini_extractor.py`

```python
# Pydantic Schemas для Structured Output
class GeminiEntitySchema(BaseModel):
    name: str = Field(description="Имя сущности")
    type: str = Field(default="character", description="character, location, object")
    visual_summary: str = Field(default="", description="Визуальное описание для художника")
    aliases: List[str] = Field(default_factory=list, description="Альтернативные имена")
    confidence: float = Field(default=1.0, description="Уверенность 0.0-1.0")
    importance: int = Field(default=5, description="Важность для сюжета (1-10). 10=Протагонист, 1=Фон")
    first_mention_offset: Optional[int] = Field(default=None, description="Позиция первого упоминания")

class GeminiDescriptionSchema(BaseModel):
    content: str = Field(description="Полное описание из текста")
    type: str = Field(default="location", description="location, character, object, atmosphere")
    confidence: float = Field(default=1.0)
    entities: List[str] = Field(default_factory=list, description="Имена упомянутых сущностей")
    text_offset: Optional[int] = Field(default=None, description="Позиция начала описания")

class GeminiRelationshipSchema(BaseModel):
    source: str
    target: str
    type: str = Field(default="related")
    weight: float = Field(default=0.5)
    context: str = Field(default="")

# Конфигурация
@dataclass
class GeminiConfig:
    model_id: str = "gemini-3-flash-preview"
    max_chunk_chars: int = 100000  # 100k chars для Massive Context
    min_chunk_chars: int = 200
    chunk_overlap_percent: float = 0.15  # 15% перекрытие
    max_descriptions_per_chunk: int = 10
    min_description_chars: int = 50  # ⚠️ СЛИШКОМ НИЗКИЙ
    max_description_chars: int = 1000
    min_confidence: float = 0.4
    use_tsa_mode: bool = True
    enable_cache: bool = True
    cache_ttl_seconds: int = 86400
    max_retries: int = 3
    timeout_seconds: int = 30
```

### 2. TSA промпт (Tagged Span Annotation)

```python
TSA_EXTRACTION_PROMPT = """Ты - литературный редактор. Анализируй текст и размечай визуальные описания.

ЗАДАЧА:
1. Верни ОРИГИНАЛЬНЫЙ текст с XML-тегами вокруг описаний
2. Формат тегов: <desc type="TYPE" occurrence="N">точный текст из оригинала</desc>
3. TYPE = location | character | object | atmosphere
4. occurrence = номер вхождения если текст повторяется (по умолчанию 1)

КРИТЕРИИ ОПИСАНИЙ:
- Минимум 50 символов
- Создаёт визуальный образ (внешность, место, атмосфера)
- Подходит для иллюстрации

ПРИМЕР:
Вход: "Иван вошёл в комнату. Комната была тёмной и пыльной, с высокими потолками и старинной мебелью."
Выход в tagged_text: "Иван вошёл в комнату. <desc type=\"location\" occurrence=\"1\">Комната была тёмной и пыльной, с высокими потолками и старинной мебелью.</desc>"

ПРАВИЛА:
- Текст внутри тегов должен быть ТОЧНОЙ копией из оригинала
- Сохраняй все пробелы и знаки препинания
- Не изменяй текст вне тегов
- Для персонажей: описание внешности, одежды, возраста
- Для локаций: освещение, архитектура, атмосфера
- Игнорируй обычные предметы (только сюжетно важные артефакты)

ТАКЖЕ выдели:
1. ГЛАВНЫХ персонажей (importance 7-10) с visual_summary и aliases
2. КЛЮЧЕВЫЕ локации
3. СВЯЗИ между сущностями

Текст для анализа:
{text}
"""
```

### 3. Legacy EXTRACTION промпт

```python
EXTRACTION_PROMPT = """Ты - литературный редактор и визуальный директор. Твоя задача - подготовить детальные справки для художников и создать схему связей персонажей.

ЗАДАЧА:
1. Выдели ТОЛЬКО ГЛАВНЫХ персонажей и КЛЮЧЕВЫЕ локации (Top-15 для сюжета). Игнорируй обычные предметы и фоновых персонажей.
2. Оцени ВАЖНОСТЬ (importance) каждой сущности от 1 до 10.
   - 9-10: Протагонисты, Главные антагонисты, Основные локации.
   - 7-8: Значимые второстепенные персонажи, Частые локации.
   - 1-6: ИГНОРИРОВАТЬ.  ⚠️ ПРОБЛЕМА: Теряем много контента!
3. Для каждой сущности дай "visual_summary" (описание внешности одним абзацем).
4. КРИТИЧНО: Укажи ВСЕ АЛЬТЕРНАТИВНЫЕ ИМЕНА (aliases) персонажа!
5. Определи СВЯЗИ между сущностями.
6. Выдели ОПИСАТЕЛЬНЫЕ ФРАГМЕНТЫ (descriptions) длиннее 50 символов.
7. Укажи "first_mention_offset" и "text_offset" — позиции в тексте.

ТИПЫ СУЩНОСТЕЙ:
- character: Люди, существа. Описывай: лицо, волосы, одежда, возраст, особые приметы.
- location: Места действия. Описывай: освещение, архитектура, погода, атмосфера.
- object: ТОЛЬКО Сюжетно Важные Артефакты. Обычные предметы - игнорировать.

Текст для анализа:
{text}
"""
```

### 4. Reduce Phase промпт (дедупликация)

```python
REDUCE_PROMPT = f"""
You are a Data Consistency Expert. I have extracted entities from a book, but there are duplicates and unimportant items.

INPUT DATA:
{entity_list_text}

TASK:
1. IDENTIFY DUPLICATES: Regard "Harry", "Harry Potter", "Mr. Potter" as the SAME entity.
2. FILTER GARBAGE: Remove any entity with Importance < 3 (very minor background characters).  ⚠️ ПРОБЛЕМА: Удаляем контент!
3. OUTPUT JSON: List of operations to clean the database.

Output JSON Schema:
{{
    "merge_operations": [
        {{ "keep_id": "uuid", "merge_ids": ["uuid", "uuid"] }}
    ],
    "delete_operations": [ "uuid", "uuid" ] 
}}
"""
```

### 5. Imagen — Промпт перевода

```python
TRANSLATION_PROMPT = """You are a translator specializing in visual descriptions for image generation.

TASK: Translate this Russian visual description to English for AI image generation.

RULES:
1. Focus ONLY on visual elements (appearance, colors, textures, lighting)
2. Use vivid, descriptive adjectives
3. Preserve the mood and atmosphere
4. Use common English art and photography terms
5. Keep the translation under 150 words
6. Do NOT add interpretations - translate only what's written

Russian text:
{text}

English translation (visual elements only, no explanations):"""
```

### 6. Imagen — Style Templates (жанрово-адаптивные)

```python
_BASE_STYLE_TEMPLATES = {
    DescriptionType.LOCATION: {
        "prefix": "Detailed book illustration of",
        "base_style": "atmospheric lighting, rich vibrant colors, detailed environment",
        "suffix": "professional artwork, high quality, suitable for book illustration"
    },
    DescriptionType.CHARACTER: {
        "prefix": "Character portrait illustration of",
        "base_style": "detailed facial features, expressive eyes, period-appropriate attire",
        "suffix": "professional character design, artistic rendering, book illustration quality"
    },
    # ... atmosphere, object, action
}

# Genre-specific overrides
_GENRE_TYPE_OVERRIDES = {
    "fantasy": {
        DescriptionType.LOCATION: "ethereal glow, magical atmosphere, enchanted forest tones",
        DescriptionType.CHARACTER: "fantasy armor, mystical aura, otherworldly features",
    },
    "science_fiction": {
        DescriptionType.LOCATION: "holographic displays, neon lighting, cyberpunk architecture",
        DescriptionType.CHARACTER: "futuristic outfit, tech accessories, LED accents",
    },
    # ... detective, romance, horror, thriller, historical
}
```

### 7. LLM Cache Service

```python
@dataclass
class ChapterCacheKey:
    book_id: str
    chapter_id: str
    chapter_content_hash: str  # SHA-256[:16] of text content
    prompt_template_hash: str  # SHA-256[:8] of prompt template
    model_name: str
    analysis_type: str  # "descriptions" | "entities" | "tsa"
    
    def to_redis_key(self) -> str:
        key_data = dump_json(asdict(self), sort_keys=True)
        key_hash = hashlib.sha256(key_data.encode()).hexdigest()
        return f"llm:chapter:{key_hash}"

class LLMCacheService:
    def __init__(self):
        self._ttl = 86400 * 30  # 30 days default TTL
```

### 8. Retry Logic (Tenacity)

```python
# LLM extraction retry (3 retries, 1-30s delay with jitter)
retry_llm_extraction = create_retry_decorator(
    max_retries=3,
    initial_delay=1.0,
    max_delay=30.0,
    exponential_base=2.0,
    jitter=True,
    retryable_exceptions=LLM_EXTRACTION_EXCEPTIONS,
)

# Image generation retry (4 retries, 2-60s delay with jitter)
retry_image_generation = create_retry_decorator(
    max_retries=4,
    initial_delay=2.0,
    max_delay=60.0,
)
```

### 9. Параллельная обработка глав (book_tasks.py)

```python
# Semaphore для ограничения параллелизма
chapter_semaphore = asyncio.Semaphore(10)  # Глобально на книгу
self._chunk_semaphore = asyncio.Semaphore(3)  # На уровне экстрактора для чанков

async def process_chapter_safe(idx: int, chapter_id: UUID):
    async with AsyncSessionLocal() as session:
        async with chapter_semaphore:
            result = await gemini_extractor.analyze_chapter(local_chapter.content)
            entity_map = await local_mgr.process_chapter_analysis(str(book_id), result)
            # ... save descriptions, create DescriptionEntity links
```

### 10. Entity Resolution (consistency_manager.py)

```python
async def _batch_resolve_entities(self, book_id: str, raw_entities: List[ExtractedEntity]) -> Dict[str, Entity]:
    # 1. Загрузка всех сущностей книги
    # 2. Сопоставление по имени и алиасам
    # 3. Обновление visual_summary если новый длиннее (⚠️ "Wiper" логика)
    if len(raw.visual_summary) > len(entity.visual_summary or ""):
        entity.visual_summary = raw.visual_summary  # Заменяет, не аппендит!
```

---

## Best Practices 2025-2026 (из веб-исследования)

### Gemini Context Caching

| Тип | Discount | Активация | Min Tokens |
|-----|----------|-----------|------------|
| Implicit (auto) | 75-90% | Автоматически для Gemini 2.5+/3 | 1024 (Flash), 4096 (Pro) |
| Explicit (manual) | 90% | Через cache_control API | Настраиваемый TTL |

**Best Practice:** Статичный контент (system prompt, few-shot) размещать В НАЧАЛЕ запроса.

### Imagen 4 Prompt Engineering

| Аспект | Рекомендация |
|--------|--------------|
| Минимальная длина | 150-300 символов |
| Portrait keyword | Включать слово "portrait" для фокуса на лице |
| Camera terms | "85mm lens, f/2.8 aperture, soft diffused lighting" |
| Consistency anchor | Уникальная деталь для seed-привязки |

### Prompt Engineering для Entity Extraction

| Техника | Описание | Эффект |
|---------|----------|--------|
| Few-shot examples | 2-3 примера идеального извлечения | +7-15% F1 |
| Negative examples | "НЕ извлекай: 'Он был высоким' (слишком коротко)" | -hallucinations |
| Quality gates | "Если описание < 100 символов, расширь деталями" | +quality |
| Self-correction | "Проверь: все ли описания > 150 chars?" | +consistency |
| Multi-stage pipeline | Pass 1: structure → Pass 2: extraction → Pass 3: validation | +5% F1 |

### Cost Optimization Strategies

| Стратегия | Экономия | Применение |
|-----------|----------|------------|
| Prompt Caching | 75-90% | Повторяющийся контекст |
| Batch API | 50% | Non-urgent обработка |
| Model Tiering | 60-90% | Маршрутизация по сложности |
| Semantic Caching | 70-95% | Похожие запросы |

---

## Вопросы для анализа

### A. Качество промптов

1. **TSA_EXTRACTION_PROMPT:**
   - Достаточно ли инструкций для качественного извлечения?
   - Нужны ли few-shot примеры?
   - Как улучшить точность определения позиций (text_offset)?

2. **EXTRACTION_PROMPT:**
   - Как убрать ограничения "Top-15" и "Importance < 7 = ИГНОРИРОВАТЬ" без потери качества?
   - Как добавить quality gates для минимальной длины visual_summary?
   - Нужен ли negative examples раздел?

3. **REDUCE_PROMPT:**
   - Как изменить логику дедупликации, чтобы НЕ удалять сущности с низким importance?
   - Как добавить reveal_chapter для алиасов (защита от спойлеров)?

4. **TRANSLATION_PROMPT (Imagen):**
   - Достаточно ли 150 слов для качественного промпта Imagen 4?
   - Нужно ли добавить camera/lighting terms?

### B. Оптимизация производительности

1. **Chunking Strategy:**
   - Оптимален ли размер чанка 100k chars?
   - Как влияет 15% overlap на дубликаты?
   - Нужен ли recursive vs sliding window?

2. **Parallelism:**
   - Оптимальны ли значения Semaphore (10 глав, 3 чанка)?
   - Можно ли использовать asyncio.TaskGroup эффективнее?

3. **Caching:**
   - Оптимален ли TTL 30 дней?
   - Стоит ли добавить semantic cache (embedding similarity)?
   - Используется ли Gemini implicit caching эффективно?

### C. Снижение затрат

1. **Context Caching:**
   - Можно ли вынести system prompt в cached_content для Gemini?
   - Какой TTL оптимален для explicit cache?

2. **Model Selection:**
   - Когда использовать Flash vs Pro?
   - Стоит ли Flash-Lite для простых задач (translation)?

3. **Batch Processing:**
   - Можно ли перевести Imagen translation на batch API?
   - Стоит ли накапливать запросы для batch processing?

### D. Архитектура пайплайна

1. **Map-Reduce:**
   - Эффективен ли текущий reduce phase?
   - Нужен ли дополнительный validation pass?

2. **Entity Resolution:**
   - Как улучшить fuzzy matching для алиасов?
   - Стоит ли использовать embeddings для similarity?

3. **Spoiler Protection:**
   - Как реализовать reveal_chapter для aliases?
   - Как обеспечить CFI-based visibility без first_mention_cfi?

---

## Ожидаемый результат

Пожалуйста, проанализируй код и предоставь структурированный ответ:

### 1. Критические проблемы (P0)
Что НЕОБХОДИМО исправить немедленно?

### 2. Улучшенные промпты
Предложи переписанные версии:
- TSA_EXTRACTION_PROMPT_V2
- EXTRACTION_PROMPT_V2  
- REDUCE_PROMPT_V2
- TRANSLATION_PROMPT_V2

С конкретными изменениями:
- Few-shot examples
- Quality gates
- Negative examples
- Length constraints

### 3. Оптимизация производительности
Конкретные рекомендации по:
- Chunking strategy
- Parallelism tuning
- Caching improvements

### 4. Снижение затрат
Рекомендации по:
- Gemini context caching implementation
- Model tiering strategy
- Batch processing opportunities

### 5. Архитектурные улучшения
Рекомендации по:
- Entity resolution improvements
- Spoiler protection fix
- Visual summary evolution (не "wiper", а append)

### 6. Метрики успеха
Как измерить улучшения:
- Количество описаний/глава
- Средняя длина visual_summary
- Количество сущностей/книга
- Cache hit rate
- Cost per book

---

Используй своё thinking для глубокого анализа кода перед ответом. Обращай внимание на неявные проблемы и потенциальные edge cases.

---КОНЕЦ ПРОМПТА---
