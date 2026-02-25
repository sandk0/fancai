"""
Gemini Direct Extractor - Direct Google Gemini API calls for description extraction.

REPLACES LangExtract library:
- LangExtract returns entities (NER) instead of descriptions
- This module uses direct API calls to get full paragraphs

ARCHITECTURE:
- google-genai SDK for direct Gemini access
- Structured Output with Pydantic schemas (Phase 6)
- Recursive text chunking
- Exponential backoff retry with tenacity

Created: 2025-12-13
Updated: 2026-01-22 - Phase 6: Pydantic Structured Output
Author: fancai Team
"""

import os
import time
import logging
import asyncio
import hashlib
import json
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from app.models.description import DescriptionType

from app.core.retry import (
    retry_llm_extraction,
    LLMExtractionError,
    RateLimitError,
    TimeoutError as RetryTimeoutError,
)
from app.core.cache import cache_manager
from app.services.tsa_parser import TSAParser, get_tsa_parser
from app.monitoring.metrics import (
    record_llm_request,
    record_llm_error,
    record_llm_rate_limit,
    record_description_count,
    record_visual_summary_length,
    record_llm_cache_hit,
    record_llm_cache_miss,
)
from app.core.json_utils import clean_json_text
from app.services.llm_cache_service import llm_cache, ChapterCacheKey
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# Phase 6: Pydantic Schemas for Structured Output
class GeminiEntitySchema(BaseModel):
    name: str = Field(description="Имя сущности")
    type: str = Field(default="character", description="character, location, object")
    visual_summary: str = Field(
        default="", description="Визуальное описание для художника"
    )
    aliases: List[str] = Field(default_factory=list, description="Альтернативные имена")
    confidence: float = Field(default=1.0, description="Уверенность 0.0-1.0")
    importance: int = Field(
        default=5, description="Важность для сюжета (1-10). 10=Протагонист, 1=Фон"
    )
    first_mention_offset: Optional[int] = Field(
        default=None, description="Позиция (символ) первого упоминания в тексте"
    )
    chapter_event_action: Optional[str] = Field(
        default=None, description="Что персонаж ДЕЛАЕТ в этой главе (одно предложение, или null)"
    )
    chapter_event_inner: Optional[str] = Field(
        default=None, description="Что персонаж ЧУВСТВУЕТ/ДУМАЕТ (одно предложение, или null)"
    )


class GeminiRelationshipSchema(BaseModel):
    source: str
    target: str
    type: str = Field(default="related")
    weight: float = Field(default=0.5)
    context: str = Field(default="")


class GeminiDescriptionSchema(BaseModel):
    content: str = Field(description="Полное описание из текста")
    type: str = Field(
        default="location", description="location, character, object, atmosphere"
    )
    confidence: float = Field(default=1.0)
    entities: List[str] = Field(
        default_factory=list, description="Имена упомянутых сущностей"
    )
    text_offset: Optional[int] = Field(
        default=None, description="Позиция начала описания в тексте (символ от начала)"
    )


class GeminiResponseSchema(BaseModel):
    descriptions: List[GeminiDescriptionSchema]
    entities: List[GeminiEntitySchema]
    relationships: List[GeminiRelationshipSchema]


class GeminiTSAResponseSchema(BaseModel):
    """Tag format: <desc type="location" occurrence="1">text</desc>"""

    tagged_text: str = Field(
        description="Оригинальный текст с XML-тегами вокруг описаний"
    )
    entities: List[GeminiEntitySchema]
    relationships: List[GeminiRelationshipSchema]




@dataclass
class ExtractedEntity:
    """Извлеченная сущность (Персонаж, Локация, Предмет)."""

    name: str
    type: str  # character, location, object
    visual_summary: str
    aliases: List[str] = field(default_factory=list)
    confidence: float = 0.0
    importance: int = 0
    first_mention_offset: Optional[int] = None
    chapter_event_action: Optional[str] = None
    chapter_event_inner: Optional[str] = None


@dataclass
class ExtractedRelationship:
    """Связь между сущностями."""

    source: str
    target: str
    type: str
    weight: float
    context: str = ""


@dataclass
class ExtractedDescription:
    """Извлеченное описание из LLM."""

    content: str
    description_type: DescriptionType
    confidence: float
    entities: List[Dict[str, Any]] = field(default_factory=list)
    attributes: Dict[str, Any] = field(default_factory=dict)
    position: int = 0
    source_span: Tuple[int, int] = (0, 0)

    def to_dict(self) -> Dict[str, Any]:
        """Конвертация в формат Multi-NLP системы."""
        # Safely extract entity names - handle both dict and string entities
        entity_names = []
        for e in self.entities:
            if isinstance(e, dict):
                entity_names.append(e.get("name", ""))
            elif isinstance(e, str):
                entity_names.append(e)
            else:
                entity_names.append(str(e))

        return {
            "content": self.content,
            "type": self.description_type.value,
            "confidence_score": self.confidence,
            "priority_score": self._calculate_priority(),
            "source": "gemini_direct",
            "position": self.position,
            "word_count": len(self.content.split()),
            "entities_mentioned": entity_names,
            "metadata": {
                "llm_extracted": True,
                "entities": self.entities,
                "attributes": self.attributes,
                "source_span": self.source_span,
                "char_length": len(self.content),
            },
        }

    def _calculate_priority(self) -> float:
        """Расчет приоритета для генерации изображений."""
        type_priority = {
            DescriptionType.LOCATION: 75,
            DescriptionType.CHARACTER: 60,
            DescriptionType.ATMOSPHERE: 45,
            DescriptionType.OBJECT: 50,
        }.get(self.description_type, 40)

        length = len(self.content)
        if 200 <= length <= 500:
            length_bonus = 15
        elif 100 <= length < 200:
            length_bonus = 10
        elif 500 < length <= 1000:
            length_bonus = 5
        else:
            length_bonus = 0

        confidence_bonus = self.confidence * 10
        return min(100.0, type_priority + length_bonus + confidence_bonus)


@dataclass
class ChapterAnalysisResult:
    """Полный результат анализа главы."""

    descriptions: List[ExtractedDescription]
    entities: List[ExtractedEntity]
    relationships: List[ExtractedRelationship]


@dataclass
class GeminiConfig:
    """Конфигурация Gemini экстрактора."""

    model_id: str = (
        "gemini-3-flash-preview"  # Dec 2025: gemini-3-flash-preview (not 3.0)
    )
    api_key: Optional[str] = None

    # Model Tiering: different models for different tasks (cost optimization)
    model_extraction: str = "gemini-3-flash-preview"  # Complex: entity extraction, TSA
    model_translation: str = "gemini-2.0-flash-lite"  # Simple: translation to English
    model_reduce: str = "gemini-3-flash-preview"  # Complex: deduplication, merge

    # Чанкинг
    max_chunk_chars: int = 100000  # v16: 100k chars for Massive Context
    min_chunk_chars: int = 200
    chunk_overlap_percent: float = 0.15  # 15% перекрытие

    # Извлечение
    max_descriptions_per_chunk: int = 20  # Increased: extract more per chunk
    min_description_chars: int = 80  # Balanced: 80 chars minimum (was 50)
    min_visual_summary_chars: int = 100  # NEW: minimum for entity visual_summary
    max_description_chars: int = 1000
    min_confidence: float = 0.4

    # TSA (Tagged Span Annotation) для точных позиций
    use_tsa_mode: bool = True
    tsa_fuzzy_threshold: float = 0.85
    tsa_position_tolerance: int = 100

    # LLM Response Caching
    enable_cache: bool = True
    cache_ttl_seconds: int = 86400

    # Retry логика
    max_retries: int = 3
    retry_delay_seconds: float = 1.0
    timeout_seconds: int = 120  # Increased from 30s to 120s for 100k context extraction


class RecursiveTextChunker:
    """
    Рекурсивный чанкер текста.

    Разбивает текст по иерархии разделителей:
    1. Двойные переносы (параграфы)
    2. Одинарные переносы
    3. Точки с пробелом (предложения)
    4. Пробелы (слова)
    """

    def __init__(self, config: GeminiConfig):
        self.config = config
        self.separators = ["\n\n", "\n", ". ", " "]

    def chunk(self, text: str) -> List[Dict[str, Any]]:
        """
        Разбить текст на чанки.

        Returns:
            Список чанков: [{"text": str, "start": int, "end": int}]
        """
        if len(text) <= self.config.max_chunk_chars:
            return [{"text": text, "start": 0, "end": len(text)}]

        return self._recursive_split(text, 0, self.separators)

    def _recursive_split(
        self, text: str, offset: int, separators: List[str]
    ) -> List[Dict[str, Any]]:
        """Рекурсивное разбиение текста."""
        if len(text) <= self.config.max_chunk_chars:
            return [{"text": text, "start": offset, "end": offset + len(text)}]

        if not separators:
            # Fallback: разбиваем по символам
            chunks = []
            for i in range(0, len(text), self.config.max_chunk_chars):
                chunk_text = text[i : i + self.config.max_chunk_chars]
                chunks.append(
                    {
                        "text": chunk_text,
                        "start": offset + i,
                        "end": offset + i + len(chunk_text),
                    }
                )
            return self._add_overlap(chunks, text, offset)

        separator = separators[0]
        parts = text.split(separator)

        # Если разбиение не помогло, переходим к следующему разделителю
        if len(parts) == 1:
            return self._recursive_split(text, offset, separators[1:])

        # Группируем части в чанки
        chunks = []
        current_chunk = ""
        current_start = offset

        for i, part in enumerate(parts):
            part_with_sep = part + (separator if i < len(parts) - 1 else "")

            if len(current_chunk) + len(part_with_sep) > self.config.max_chunk_chars:
                if current_chunk:
                    chunks.append(
                        {
                            "text": current_chunk.strip(),
                            "start": current_start,
                            "end": current_start + len(current_chunk.strip()),
                        }
                    )

                # Если часть слишком большая, разбиваем рекурсивно
                if len(part_with_sep) > self.config.max_chunk_chars:
                    sub_chunks = self._recursive_split(
                        part_with_sep,
                        current_start + len(current_chunk),
                        separators[1:],
                    )
                    chunks.extend(sub_chunks)
                    current_chunk = ""
                    current_start = (
                        sub_chunks[-1]["end"] if sub_chunks else current_start
                    )
                else:
                    current_chunk = part_with_sep
                    current_start = (
                        current_start + len(current_chunk) - len(part_with_sep)
                    )
            else:
                current_chunk += part_with_sep

        if current_chunk.strip():
            chunks.append(
                {
                    "text": current_chunk.strip(),
                    "start": current_start,
                    "end": current_start + len(current_chunk.strip()),
                }
            )

        return self._add_overlap(chunks, text, offset)

    def _add_overlap(
        self, chunks: List[Dict[str, Any]], original_text: str, offset: int
    ) -> List[Dict[str, Any]]:
        """Добавить перекрытие между чанками."""
        if len(chunks) <= 1:
            return chunks

        overlap_chars = int(
            self.config.max_chunk_chars * self.config.chunk_overlap_percent
        )

        for i in range(1, len(chunks)):
            prev_chunk = chunks[i - 1]
            curr_chunk = chunks[i]

            # Берём последние N символов предыдущего чанка
            overlap_text = prev_chunk["text"][-overlap_chars:]

            # Добавляем в начало текущего чанка
            curr_chunk["text"] = overlap_text + "\n\n" + curr_chunk["text"]
            curr_chunk["has_overlap"] = True

        return chunks


class GeminiDirectExtractor:
    """
    Прямой экстрактор описаний через Google Gemini API.

    Заменяет LangExtract библиотеку для получения полных описаний
    вместо коротких сущностей (NER).
    """

    TSA_EXTRACTION_PROMPT = """Ты - опытный литературный редактор, специализирующийся на подготовке книг к иллюстрированию.

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

### Пример 1 (короткий, atmosphere):
Вход: "Солнце садилось. Небо окрасилось в багряные и золотые тона, отражаясь в спокойной глади озера."
Выход: "Солнце садилось. <desc type=\\"atmosphere\\" occurrence=\\"1\\">Небо окрасилось в багряные и золотые тона, отражаясь в спокойной глади озера.</desc>"

### Пример 2 (средний, character):
Вход: "В дверях стоял незнакомец лет сорока пяти. Его лицо было изборождено морщинами, седые волосы торчали во все стороны, а глаза — пронзительно-голубые — смотрели с насмешкой."
Выход: "В дверях стоял <desc type=\\"character\\" occurrence=\\"1\\">незнакомец лет сорока пяти. Его лицо было изборождено морщинами, седые волосы торчали во все стороны, а глаза — пронзительно-голубые — смотрели с насмешкой.</desc>"

### Пример 3 (длинный, location):
Вход: "Библиотека занимала три этажа особняка. Высокие дубовые стеллажи уходили под самый потолок, украшенный лепниной с позолотой. Пыль танцевала в лучах света, проникающих сквозь витражные окна."
Выход: "<desc type=\\"location\\" occurrence=\\"1\\">Библиотека занимала три этажа особняка. Высокие дубовые стеллажи уходили под самый потолок, украшенный лепниной с позолотой. Пыль танцевала в лучах света, проникающих сквозь витражные окна.</desc>"

## ПРАВИЛА
1. Текст внутри тегов = ТОЧНАЯ копия из оригинала
2. Сохраняй пробелы и пунктуацию
3. occurrence = порядковый номер при повторении (по умолчанию 1)
4. НЕ изменяй текст вне тегов

## ДОПОЛНИТЕЛЬНО ВЫДЕЛИ
1. ВСЕХ персонажей с visual_summary и aliases
   - importance 7-10: главные герои
   - importance 4-6: второстепенные
   - importance 1-3: эпизодические (ИЗВЛЕКАЙ, не игнорируй!)
2. ВСЕ локации с visual_summary
3. СВЯЗИ между сущностями (source, target, type, context)

## СОБЫТИЯ ГЛАВЫ (chapter events)
Для каждой сущности укажи главное СОБЫТИЕ этой главы:
- chapter_event_action: что персонаж ДЕЛАЕТ (одно предложение, или null если просто упоминается)
- chapter_event_inner: что персонаж ЧУВСТВУЕТ/ДУМАЕТ (одно предложение, или null)

## QUALITY GATES
- visual_summary < 80 символов → Дополни деталями из контекста
- Нет описания внешности → "Внешность не описана в данном фрагменте"

Текст для анализа:
{text}
"""

    EXTRACTION_PROMPT = """Ты - литературный редактор и визуальный директор. Твоя задача - подготовить детальные справки для художников и создать схему связей персонажей.

ЗАДАЧА:
1. Выдели ВСЕ визуально значимые персонажи и локации (без ограничений!).
   - Даже эпизодические персонажи важны для атмосферы.
   - Не пропускай никого — фильтрация будет позже.
2. Оцени ВАЖНОСТЬ (importance) каждой сущности от 1 до 10, но ИЗВЛЕКАЙ всех.
   - 9-10: Протагонисты, Главные антагонисты, Основные локации.
   - 7-8: Значимые второстепенные персонажи, Частые локации.
   - 4-6: Эпизодические персонажи — ИЗВЛЕКАЙ для полноты картины.
   - 1-3: Фоновые — ИЗВЛЕКАЙ, если есть хоть какое-то описание внешности.
3. Для каждой сущности дай "visual_summary" (описание внешности одним абзацем).
   - МИНИМУМ 100 символов для visual_summary.
   - Если описания мало — напиши "Внешность не описана в данном фрагменте".
4. КРИТИЧНО: Укажи ВСЕ АЛЬТЕРНАТИВНЫЕ ИМЕНА (aliases) персонажа!
   - Примеры: "Геральт" → aliases: ["Белый Волк", "Ведьмак", "Мясник из Блавикена"]
   - Примеры: "Гарри Поттер" → aliases: ["Мальчик-который-выжил", "Избранный"]
   - Примеры: "Aragorn" → aliases: ["Strider", "Elessar", "Isildur's Heir"]
5. Определи СВЯЗИ между сущностями.
6. Выдели ОПИСАТЕЛЬНЫЕ ФРАГМЕНТЫ (descriptions) длиннее 80 символов.
9. Для каждой сущности укажи главное СОБЫТИЕ этой главы:
   - chapter_event_action: что персонаж ДЕЛАЕТ (одно предложение, или null если просто упоминается)
   - chapter_event_inner: что персонаж ЧУВСТВУЕТ/ДУМАЕТ (одно предложение, или null)
7. ВАЖНО: Для каждой сущности укажи "first_mention_offset" — позицию (номер символа от начала текста), где сущность ПЕРВЫЙ раз упоминается.
   - Пример: если "Геральт" впервые появляется на 150-м символе текста, то first_mention_offset: 150
8. КРИТИЧНО для descriptions: Укажи "text_offset" — позицию (номер символа от начала текста), где начинается каждое описание.
   - Найди ТОЧНОЕ место в тексте, откуда взято описание
   - Пример: "Комната была темной и пыльной..." найдено на позиции 2340, text_offset: 2340

ТИПЫ СУЩНОСТЕЙ:
- character: Люди, существа. Описывай: лицо, волосы, одежда, возраст, особые приметы.
- location: Места действия. Описывай: освещение, архитектура, погода, атмосфера.
- object: ТОЛЬКО Сюжетно Важные Артефакты (Кольцо Всевластия). Обычные предметы - игнорировать.

Текст для анализа:
{text}
"""

    def __init__(self, config: Optional[GeminiConfig] = None):
        """Инициализация экстрактора."""
        self.config = config or GeminiConfig()
        self.config.api_key = self.config.api_key or os.getenv("LANGEXTRACT_API_KEY")

        self.chunker = RecursiveTextChunker(self.config)

        self._client: Any = None
        self._model: Optional[str] = None
        self._types: Any = None
        self._available = False

        # Статистика
        self.stats = {
            "total_calls": 0,
            "successful_calls": 0,
            "failed_calls": 0,
            "total_descriptions": 0,
            "total_tokens": 0,
            "total_time": 0.0,
        }
        # TD-P3-6 FIX: Lock for thread-safe stats updates
        self._stats_lock = asyncio.Lock()

        # Rate limiting semaphore for concurrent Gemini API calls
        # TD-P3-2 FIX: Moved from per-call to class level
        self._chunk_semaphore = asyncio.Semaphore(3)

        self._initialize()

    def _initialize(self):
        """Инициализация Gemini API с новым google-genai SDK (December 2025)."""
        if not self.config.api_key:
            logger.warning("LANGEXTRACT_API_KEY not set. Gemini extractor disabled.")
            return

        try:
            from google import genai
            from google.genai import types

            # Создаём клиент с новым SDK
            self._client = genai.Client(api_key=self.config.api_key)
            self._model = self.config.model_extraction
            self._types = types

            self._available = True
            logger.info(
                f"Gemini extractor initialized (model: {self.config.model_extraction}, SDK: google-genai)"
            )

        except ImportError:
            logger.error("google-genai not installed. Run: pip install google-genai")
        except Exception as e:
            logger.error(f"Failed to initialize Gemini: {e}")

    def is_available(self) -> bool:
        """Проверить доступность экстрактора."""
        return self._available

    def _get_cache_key(self, text: str) -> str:
        text_hash = hashlib.sha256(text.encode()).hexdigest()[:16]
        return f"llm:gemini:{self.config.model_extraction}:{text_hash}"

    async def _get_cached_response(
        self, cache_key: str
    ) -> Optional[GeminiResponseSchema]:
        if not self.config.enable_cache:
            return None

        cached = await cache_manager.get(cache_key)
        if cached:
            logger.debug(f"LLM cache hit: {cache_key}")
            async with self._stats_lock:
                self.stats["cache_hits"] = self.stats.get("cache_hits", 0) + 1
            record_llm_cache_hit(self.config.model_extraction)
            return GeminiResponseSchema.model_validate(cached)

        record_llm_cache_miss(self.config.model_extraction)
        return None

    async def _set_cached_response(
        self, cache_key: str, response: GeminiResponseSchema
    ) -> None:
        if not self.config.enable_cache:
            return

        await cache_manager.set(
            cache_key, response.model_dump(), self.config.cache_ttl_seconds
        )
        logger.debug(f"LLM cache set: {cache_key}")

    async def analyze_chapter(
        self, text: str, chapter_id: Optional[str] = None
    ) -> ChapterAnalysisResult:
        """
        Полный анализ главы: описания + сущности + связи.
        """
        if not self.is_available():
            logger.warning("Gemini extractor not available")
            return ChapterAnalysisResult([], [], [])

        if len(text) < self.config.min_chunk_chars:
            return ChapterAnalysisResult([], [], [])

        start_time = time.time()

        # Разбиваем на чанки
        chunks = self.chunker.chunk(text)
        logger.info(f"Text split into {len(chunks)} chunks for analysis")

        async def process_chunk_with_semaphore(chunk_data: dict, chunk_idx: int):
            async with self._chunk_semaphore:
                try:
                    chunk_text = chunk_data["text"]
                    chunk_offset = chunk_data["start"]
                    cache_key = self._get_cache_key(chunk_text)

                    if self.config.use_tsa_mode:
                        return await self._process_chunk_tsa(
                            chunk_text, chunk_offset, cache_key, chunk_idx
                        )
                    else:
                        return await self._process_chunk_legacy(
                            chunk_text, chunk_offset, cache_key, chunk_idx
                        )
                except Exception as e:
                    logger.warning(f"Chunk {chunk_idx} analysis failed: {e}")
                    async with self._stats_lock:
                        self.stats["failed_calls"] += 1
                    return {
                        "descriptions": [],
                        "entities": [],
                        "relationships": [],
                        "success": False,
                    }

        # Execute all chunks in parallel
        results = await asyncio.gather(
            *[process_chunk_with_semaphore(chunk, i) for i, chunk in enumerate(chunks)],
            return_exceptions=True,
        )

        # Aggregate results
        all_descriptions = []
        all_entities = []
        all_relationships = []

        for result in results:
            if isinstance(result, Exception):
                logger.warning(f"Chunk processing exception: {result}")
                continue
            if not isinstance(result, dict):
                continue
            chunk_result: Dict[str, Any] = result
            if chunk_result.get("success"):
                all_descriptions.extend(chunk_result.get("descriptions", []))
                all_entities.extend(chunk_result.get("entities", []))
                all_relationships.extend(chunk_result.get("relationships", []))

        # Deduplicate Descriptions
        unique_descriptions = self._deduplicate(all_descriptions)

        # Deduplicate Entities (Phase 6: Fuzzy matching)
        unique_entities = self._deduplicate_entities(all_entities)

        async with self._stats_lock:
            self.stats["total_time"] += time.time() - start_time
            self.stats["total_descriptions"] += len(unique_descriptions)

        # Record Prometheus Metrics
        record_description_count(self.config.model_extraction, len(unique_descriptions))

        for ent in unique_entities:
            if ent.visual_summary:
                record_visual_summary_length(
                    self.config.model_extraction, len(ent.visual_summary)
                )

        logger.info(
            f"Parallel chunk processing complete: {len(unique_descriptions)} descriptions, "
            f"{len(unique_entities)} entities, {len(all_relationships)} relationships from {len(chunks)} chunks"
        )

        return ChapterAnalysisResult(
            descriptions=unique_descriptions,
            entities=unique_entities,
            relationships=all_relationships,
        )

    async def extract(
        self, text: str, chapter_id: Optional[str] = None
    ) -> List[ExtractedDescription]:
        """
        Legacy wrapper for backward compatibility.
        """
        result = await self.analyze_chapter(text, chapter_id)
        return result.descriptions

    async def _extract_from_chunk(
        self, chunk_text: str, offset: int
    ) -> List[ExtractedDescription]:
        """Extract descriptions from a single chunk using tenacity retry."""
        async with self._stats_lock:
            self.stats["total_calls"] += 1

        try:
            cache_key = self._get_cache_key(chunk_text)
            gemini_response = await self._get_cached_response(cache_key)

            if not gemini_response:
                prompt = self.EXTRACTION_PROMPT.format(text=chunk_text)
                gemini_response = await self._call_gemini_with_retry(prompt)
                await self._set_cached_response(cache_key, gemini_response)
                async with self._stats_lock:
                    self.stats["total_tokens"] += len(prompt) // 4

            descriptions = self._convert_descriptions(
                gemini_response.descriptions, offset, chunk_text
            )

            async with self._stats_lock:
                self.stats["successful_calls"] += 1

            return descriptions

        except Exception as e:
            logger.warning(f"Chunk extraction failed after all retries: {e}")
            async with self._stats_lock:
                self.stats["failed_calls"] += 1
            return []

    @retry_llm_extraction
    async def _call_gemini_with_retry(self, prompt: str) -> GeminiResponseSchema:
        """
        Call Gemini API with tenacity retry decorator.

        Phase 6: Returns parsed Pydantic model directly.
        """
        start_time = time.time()
        model_name = self.config.model_id

        try:
            config = self._types.GenerateContentConfig(
                temperature=0.3,
                top_p=0.95,
                response_mime_type="application/json",
                response_schema=GeminiResponseSchema,
            )

            response = await asyncio.wait_for(
                asyncio.to_thread(
                    self._client.models.generate_content,
                    model=self._model,
                    contents=prompt,
                    config=config,
                ),
                timeout=self.config.timeout_seconds,
            )

            duration = time.time() - start_time
            record_llm_request(model_name, "success", duration)

            if hasattr(response, "parsed") and response.parsed:
                parsed = response.parsed
                if isinstance(parsed, dict) and "data" in parsed:
                    logger.warning("Unwrapping 'data' key from Gemini legacy response")
                    parsed = parsed["data"]
                if isinstance(parsed, GeminiResponseSchema):
                    return parsed
                return GeminiResponseSchema.model_validate(parsed)

            text = response.text if hasattr(response, "text") else str(response)
            logger.warning(
                "Gemini returned text instead of parsed object, parsing manually"
            )
            cleaned = clean_json_text(text)
            try:
                data = json.loads(cleaned)
                if isinstance(data, dict) and "data" in data:
                    logger.warning(
                        "Unwrapping 'data' key from Gemini legacy text response"
                    )
                    data = data["data"]
                return GeminiResponseSchema.model_validate(data)
            except json.JSONDecodeError as e:
                raise LLMExtractionError(
                    f"Gemini legacy returned invalid JSON: {cleaned[:200]}"
                ) from e

        except asyncio.TimeoutError as e:
            duration = time.time() - start_time
            record_llm_request(model_name, "timeout", duration)
            record_llm_error(model_name, "timeout")
            error_msg = f"Gemini API timed out after {self.config.timeout_seconds}s"
            logger.warning(error_msg)
            raise RetryTimeoutError(error_msg) from e

        except Exception as e:
            duration = time.time() - start_time
            error_msg = str(e)

            if "rate" in error_msg.lower() and "limit" in error_msg.lower():
                record_llm_request(model_name, "rate_limited", duration)
                record_llm_rate_limit(model_name)
                raise RateLimitError(error_msg) from e
            if "quota" in error_msg.lower():
                record_llm_request(model_name, "rate_limited", duration)
                record_llm_rate_limit(model_name)
                raise RateLimitError(error_msg) from e
            if "429" in error_msg:
                record_llm_request(model_name, "rate_limited", duration)
                record_llm_rate_limit(model_name)
                raise RateLimitError(error_msg) from e

            record_llm_request(model_name, "error", duration)
            record_llm_error(model_name, "api_error")
            logger.error(f"Gemini extraction error: {error_msg}")
            raise LLMExtractionError(error_msg) from e

    @retry_llm_extraction
    async def _call_gemini_tsa(self, prompt: str) -> GeminiTSAResponseSchema:
        start_time = time.time()
        model_name = self.config.model_id

        try:
            config = self._types.GenerateContentConfig(
                temperature=0.3,
                top_p=0.95,
                response_mime_type="application/json",
                response_schema=GeminiTSAResponseSchema,
            )

            response = await asyncio.wait_for(
                asyncio.to_thread(
                    self._client.models.generate_content,
                    model=self._model,
                    contents=prompt,
                    config=config,
                ),
                timeout=self.config.timeout_seconds,
            )

            duration = time.time() - start_time
            record_llm_request(model_name, "success", duration)

            if hasattr(response, "parsed") and response.parsed:
                parsed = response.parsed
                if isinstance(parsed, dict) and "data" in parsed:
                    logger.warning("Unwrapping 'data' key from Gemini TSA response")
                    parsed = parsed["data"]
                if isinstance(parsed, GeminiTSAResponseSchema):
                    return parsed
                return GeminiTSAResponseSchema.model_validate(parsed)

            text = response.text if hasattr(response, "text") else str(response)
            cleaned = clean_json_text(text)
            try:
                data = json.loads(cleaned)
                if isinstance(data, dict) and "data" in data:
                    logger.warning(
                        "Unwrapping 'data' key from Gemini TSA text response"
                    )
                    data = data["data"]
                return GeminiTSAResponseSchema.model_validate(data)
            except json.JSONDecodeError as e:
                raise LLMExtractionError(
                    f"Gemini TSA returned invalid JSON: {cleaned[:200]}"
                ) from e

        except asyncio.TimeoutError as e:
            duration = time.time() - start_time
            record_llm_request(model_name, "timeout", duration)
            record_llm_error(model_name, "timeout")
            raise RetryTimeoutError(
                f"TSA call timed out after {self.config.timeout_seconds}s"
            ) from e

        except Exception as e:
            duration = time.time() - start_time
            error_msg = str(e)

            if any(x in error_msg.lower() for x in ["rate", "quota", "429"]):
                record_llm_request(model_name, "rate_limited", duration)
                record_llm_rate_limit(model_name)
                raise RateLimitError(error_msg) from e

            record_llm_request(model_name, "error", duration)
            record_llm_error(model_name, "api_error")
            raise LLMExtractionError(error_msg) from e

    def _convert_tsa_to_descriptions(
        self,
        tsa_response: GeminiTSAResponseSchema,
        original_text: str,
        chunk_offset: int,
    ) -> List[ExtractedDescription]:
        parser = get_tsa_parser()

        local_spans = parser.parse(
            original_text, tsa_response.tagged_text, chunk_offset=0
        )
        validated_spans = TSAParser.validate_spans(local_spans, original_text)

        descriptions = []
        for span in validated_spans:
            if len(span.text) < self.config.min_description_chars:
                continue

            try:
                desc_type = DescriptionType(span.span_type)
            except ValueError:
                desc_type = DescriptionType.LOCATION

            global_start = chunk_offset + span.start
            global_end = chunk_offset + span.end

            descriptions.append(
                ExtractedDescription(
                    content=span.text,
                    description_type=desc_type,
                    confidence=span.confidence,
                    entities=[],
                    attributes={"match_method": span.match_method},
                    position=global_start,
                    source_span=(global_start, global_end),
                )
            )

        logger.info(
            f"TSA extracted {len(descriptions)} descriptions from {len(local_spans)} spans"
        )
        return descriptions

    async def _process_chunk_tsa(
        self, chunk_text: str, chunk_offset: int, cache_key: str, chunk_idx: int
    ) -> Dict[str, Any]:
        cache_key_obj = ChapterCacheKey(
            book_id="unknown",
            chapter_id=cache_key,
            chapter_content_hash=llm_cache.compute_content_hash(chunk_text),
            prompt_template_hash=llm_cache.compute_content_hash(
                self.TSA_EXTRACTION_PROMPT
            ),
            model_name=self.config.model_id,
            analysis_type="tsa",
        )

        cached = await llm_cache.get(cache_key_obj)

        if cached:
            tsa_response = GeminiTSAResponseSchema.model_validate(cached)
        else:
            prompt = self.TSA_EXTRACTION_PROMPT.format(text=chunk_text)
            tsa_response = await self._call_gemini_tsa(prompt)
            await llm_cache.set(cache_key_obj, tsa_response.model_dump())

        chunk_descriptions = self._convert_tsa_to_descriptions(
            tsa_response, chunk_text, chunk_offset
        )
        chunk_entities = self._convert_entities(
            tsa_response.entities, chunk_offset, chunk_text
        )
        chunk_relationships = self._convert_relationships(tsa_response.relationships)

        return {
            "descriptions": chunk_descriptions,
            "entities": chunk_entities,
            "relationships": chunk_relationships,
            "success": True,
        }

    async def _process_chunk_legacy(
        self, chunk_text: str, chunk_offset: int, cache_key: str, chunk_idx: int
    ) -> Dict[str, Any]:
        cache_key_obj = ChapterCacheKey(
            book_id="unknown",
            chapter_id=cache_key,
            chapter_content_hash=llm_cache.compute_content_hash(chunk_text),
            prompt_template_hash=llm_cache.compute_content_hash(self.EXTRACTION_PROMPT),
            model_name=self.config.model_id,
            analysis_type="legacy",
        )

        cached = await llm_cache.get(cache_key_obj)

        if cached:
            gemini_response = GeminiResponseSchema.model_validate(cached)
        else:
            prompt = self.EXTRACTION_PROMPT.format(text=chunk_text)
            gemini_response = await self._call_gemini_with_retry(prompt)
            await llm_cache.set(cache_key_obj, gemini_response.model_dump())

        chunk_descriptions = self._convert_descriptions(
            gemini_response.descriptions, chunk_offset, chunk_text
        )
        chunk_entities = self._convert_entities(
            gemini_response.entities, chunk_offset, chunk_text
        )
        chunk_relationships = self._convert_relationships(gemini_response.relationships)

        return {
            "descriptions": chunk_descriptions,
            "entities": chunk_entities,
            "relationships": chunk_relationships,
            "success": True,
        }

    def _convert_descriptions(
        self,
        schema_descriptions: List[GeminiDescriptionSchema],
        offset: int,
        source_text: Optional[str] = None,
    ) -> List[ExtractedDescription]:
        """Convert Pydantic schemas to ExtractedDescription objects with validation."""
        descriptions = []
        source_lower = source_text.lower() if source_text else None

        for item in schema_descriptions:
            content = item.content

            if len(content) < self.config.min_description_chars:
                continue

            if item.confidence < self.config.min_confidence:
                logger.debug(
                    f"Skipping low confidence description: {content[:50]}... (conf={item.confidence})"
                )
                continue

            if source_lower:
                content_sample = content[:100].lower()
                if content_sample not in source_lower:
                    logger.debug(
                        f"Description not found in source text: {content[:50]}..."
                    )
                    continue

            if len(content) > self.config.max_description_chars:
                content = content[: self.config.max_description_chars]

            try:
                desc_type = DescriptionType(item.type.lower())
            except ValueError:
                desc_type = DescriptionType.LOCATION

            actual_position = self._find_exact_position(
                content, source_text, offset, item.text_offset
            )

            desc_obj = ExtractedDescription(
                content=content,
                description_type=desc_type,
                confidence=item.confidence,
                entities=[{"name": name} for name in item.entities],
                attributes={},
                position=actual_position,
                source_span=(actual_position, actual_position + len(content)),
            )
            descriptions.append(desc_obj)

        return descriptions

    def _find_exact_position(
        self,
        content: str,
        source_text: Optional[str],
        chunk_offset: int,
        llm_offset: Optional[int],
    ) -> int:
        """
        Find exact position of description in source text.

        Priority:
        1. Direct string match in source_text (most accurate)
        2. LLM-provided offset (if available)
        3. Chunk offset (fallback)
        """
        if not source_text:
            return llm_offset if llm_offset is not None else chunk_offset

        search_text = content[:150] if len(content) > 150 else content

        exact_pos = source_text.find(search_text)
        if exact_pos != -1:
            return chunk_offset + exact_pos

        search_lower = search_text.lower()
        source_lower = source_text.lower()
        lower_pos = source_lower.find(search_lower)
        if lower_pos != -1:
            return chunk_offset + lower_pos

        if llm_offset is not None:
            return chunk_offset + llm_offset

        return chunk_offset

    def _convert_entities(
        self,
        schema_entities: List[GeminiEntitySchema],
        chunk_offset: int = 0,
        source_text: Optional[str] = None,
    ) -> List[ExtractedEntity]:
        """Convert Pydantic schemas to ExtractedEntity objects with validation."""
        entities = []
        source_lower = source_text.lower() if source_text else None

        for item in schema_entities:
            name = item.name.strip() if item.name else ""
            if not name:
                continue

            if source_lower:
                name_in_text = name.lower() in source_lower
                aliases_in_text = any(
                    a.lower().strip() in source_lower for a in (item.aliases or []) if a
                )
                if not name_in_text and not aliases_in_text:
                    logger.debug(f"Entity '{name}' not found in source text, skipping")
                    continue

            importance = item.importance
            if importance < 1 or importance > 10:
                logger.debug(
                    f"Clamping importance {importance} to 1-10 for entity '{name}'"
                )
                importance = max(1, min(10, importance))

            confidence = item.confidence
            if confidence < 0.0 or confidence > 1.0:
                logger.debug(
                    f"Clamping confidence {confidence} to 0.0-1.0 for entity '{name}'"
                )
                confidence = max(0.0, min(1.0, confidence))

            first_mention_offset = None
            if item.first_mention_offset is not None:
                first_mention_offset = chunk_offset + item.first_mention_offset

            entities.append(
                ExtractedEntity(
                    name=name,
                    type=item.type.lower() if item.type else "character",
                    visual_summary=item.visual_summary or "",
                    aliases=(
                        [a.strip() for a in item.aliases if a] if item.aliases else []
                    ),
                    confidence=confidence,
                    importance=importance,
                    first_mention_offset=first_mention_offset,
                    chapter_event_action=item.chapter_event_action,
                    chapter_event_inner=item.chapter_event_inner,
                )
            )
        return entities

    def _convert_relationships(
        self, schema_relationships: List[GeminiRelationshipSchema]
    ) -> List[ExtractedRelationship]:
        """Convert Pydantic schemas to ExtractedRelationship objects."""
        relationships = []
        for item in schema_relationships:
            relationships.append(
                ExtractedRelationship(
                    source=item.source,
                    target=item.target,
                    type=item.type,
                    weight=item.weight,
                    context=item.context,
                )
            )
        return relationships

    def _deduplicate(
        self, descriptions: List[ExtractedDescription]
    ) -> List[ExtractedDescription]:
        """Удаление дубликатов описаний."""
        unique = []
        seen = set()

        for desc in descriptions:
            # Нормализуем для сравнения
            key = desc.content.strip().lower()[:150]

            if key not in seen:
                seen.add(key)
                unique.append(desc)

        return unique

    def _deduplicate_entities(
        self, entities: List[ExtractedEntity]
    ) -> List[ExtractedEntity]:
        """
        Deduplicate entities using fuzzy string matching.

        Merges entities with similar names (e.g. "Gandalf" and "Gandalf the Grey").
        Combines their aliases and keeps the longest visual summary.
        """
        if not entities:
            return []

        unique: List[ExtractedEntity] = []

        # Sort by name length (longest first) to prefer full names as canonical
        sorted_entities = sorted(entities, key=lambda x: len(x.name), reverse=True)

        for entity in sorted_entities:
            is_duplicate = False
            best_match = None

            for existing in unique:
                # 1. Exact match (case insensitive)
                if entity.name.lower() == existing.name.lower():
                    is_duplicate = True
                    best_match = existing
                    break

                # 2. Similarity match (SequenceMatcher)
                # Threshold 0.75 catches aliases like "Гарри" vs "Гарри Поттер"
                similarity = SequenceMatcher(
                    None, entity.name.lower(), existing.name.lower()
                ).ratio()
                if similarity > 0.75:
                    is_duplicate = True
                    best_match = existing
                    break

                # 3. Substring match for very long names (if one name contains the other)
                if (
                    len(entity.name) > 4
                    and len(existing.name) > 4
                    and (
                        entity.name.lower() in existing.name.lower()
                        or existing.name.lower() in entity.name.lower()
                    )
                ):
                    # Only merge if types match (don't merge "Ring" and "Ring of Power" if types differ)
                    if entity.type == existing.type:
                        is_duplicate = True
                        best_match = existing
                        break

            if is_duplicate and best_match:
                # Merge data into existing entity
                # 1. Aliases
                if entity.name != best_match.name:
                    if entity.name not in best_match.aliases:
                        best_match.aliases.append(entity.name)

                for alias in entity.aliases:
                    if alias not in best_match.aliases and alias != best_match.name:
                        best_match.aliases.append(alias)

                # 2. Visual summary (keep longest/richest description)
                if len(entity.visual_summary) > len(best_match.visual_summary):
                    best_match.visual_summary = entity.visual_summary

                # 3. Confidence (keep max)
                best_match.confidence = max(best_match.confidence, entity.confidence)

                # 4. Importance (keep max)
                best_match.importance = max(best_match.importance, entity.importance)

            else:
                unique.append(entity)

        return unique

    def get_statistics(self) -> Dict[str, Any]:
        """Получить статистику."""
        return {
            "available": self._available,
            "model": self.config.model_id,
            **self.stats,
            "success_rate": (
                self.stats["successful_calls"] / self.stats["total_calls"]
                if self.stats["total_calls"] > 0
                else 0
            ),
            "avg_descriptions_per_call": (
                self.stats["total_descriptions"] / self.stats["successful_calls"]
                if self.stats["successful_calls"] > 0
                else 0
            ),
        }


# Singleton with thread-safe initialization
_extractor: Optional[GeminiDirectExtractor] = None
_extractor_lock = __import__("threading").Lock()


def get_gemini_extractor(
    config: Optional[GeminiConfig] = None,
) -> GeminiDirectExtractor:
    """Получить singleton экстрактора."""
    global _extractor
    if _extractor is None:
        with _extractor_lock:
            if _extractor is None:
                _extractor = GeminiDirectExtractor(config)
    return _extractor


class _LazyGeminiExtractor:
    """Lazy singleton proxy for backward compatibility with langextract_processor API."""

    _instance: Optional[GeminiDirectExtractor] = None

    def _get_instance(self) -> GeminiDirectExtractor:
        if self._instance is None:
            self._instance = get_gemini_extractor()
        return self._instance

    def is_available(self) -> bool:
        return self._get_instance().is_available()

    async def extract_descriptions(self, text: str, chapter_id: Optional[str] = None):
        return await self._get_instance().extract(text, chapter_id)


gemini_extractor = _LazyGeminiExtractor()
