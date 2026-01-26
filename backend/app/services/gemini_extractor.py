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
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum

from app.core.retry import (
    retry_llm_extraction,
    LLMExtractionError,
    RateLimitError,
    TimeoutError as RetryTimeoutError,
)
from app.monitoring.metrics import (
    record_llm_request,
    record_llm_error,
    record_llm_rate_limit,
)
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# Phase 6: Pydantic Schemas for Structured Output
class GeminiEntitySchema(BaseModel):
    name: str = Field(description="Имя сущности")
    type: str = Field(description="character, location, object")
    visual_summary: str = Field(description="Визуальное описание для художника")
    aliases: List[str] = Field(default_factory=list, description="Альтернативные имена")
    confidence: float = Field(description="Уверенность 0.0-1.0")
    importance: int = Field(description="Важность для сюжета (1-10). 10=Протагонист, 1=Фон")
    first_mention_offset: Optional[int] = Field(default=None, description="Позиция (символ) первого упоминания в тексте")

class GeminiRelationshipSchema(BaseModel):
    source: str
    target: str
    type: str
    weight: float
    context: str

class GeminiDescriptionSchema(BaseModel):
    content: str = Field(description="Полное описание из текста")
    type: str = Field(description="location, character, object, atmosphere")
    confidence: float
    entities: List[str] = Field(default_factory=list, description="Имена упомянутых сущностей")
    text_offset: Optional[int] = Field(default=None, description="Позиция начала описания в тексте (символ от начала)")

class GeminiResponseSchema(BaseModel):
    descriptions: List[GeminiDescriptionSchema]
    entities: List[GeminiEntitySchema]
    relationships: List[GeminiRelationshipSchema]


class DescriptionType(Enum):
    """Типы описаний для извлечения."""
    LOCATION = "location"
    CHARACTER = "character"
    OBJECT = "object"
    ATMOSPHERE = "atmosphere"


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
            "type": self.description_type.value.upper(),
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
            }
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
    model_id: str = "gemini-3-flash-preview"  # Dec 2025: gemini-3-flash-preview (not 3.0)
    api_key: Optional[str] = None

    # Чанкинг
    max_chunk_chars: int = 100000  # v16: 100k chars for Massive Context
    min_chunk_chars: int = 200
    chunk_overlap_percent: float = 0.15  # 15% перекрытие

    # Извлечение
    max_descriptions_per_chunk: int = 10
    min_description_chars: int = 50
    max_description_chars: int = 1000
    min_confidence: float = 0.4

    # Retry логика
    max_retries: int = 3
    retry_delay_seconds: float = 1.0
    timeout_seconds: int = 30


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
        self,
        text: str,
        offset: int,
        separators: List[str]
    ) -> List[Dict[str, Any]]:
        """Рекурсивное разбиение текста."""
        if len(text) <= self.config.max_chunk_chars:
            return [{"text": text, "start": offset, "end": offset + len(text)}]

        if not separators:
            # Fallback: разбиваем по символам
            chunks = []
            for i in range(0, len(text), self.config.max_chunk_chars):
                chunk_text = text[i:i + self.config.max_chunk_chars]
                chunks.append({
                    "text": chunk_text,
                    "start": offset + i,
                    "end": offset + i + len(chunk_text)
                })
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
                    chunks.append({
                        "text": current_chunk.strip(),
                        "start": current_start,
                        "end": current_start + len(current_chunk.strip())
                    })

                # Если часть слишком большая, разбиваем рекурсивно
                if len(part_with_sep) > self.config.max_chunk_chars:
                    sub_chunks = self._recursive_split(
                        part_with_sep,
                        current_start + len(current_chunk),
                        separators[1:]
                    )
                    chunks.extend(sub_chunks)
                    current_chunk = ""
                    current_start = sub_chunks[-1]["end"] if sub_chunks else current_start
                else:
                    current_chunk = part_with_sep
                    current_start = current_start + len(current_chunk) - len(part_with_sep)
            else:
                current_chunk += part_with_sep

        if current_chunk.strip():
            chunks.append({
                "text": current_chunk.strip(),
                "start": current_start,
                "end": current_start + len(current_chunk.strip())
            })

        return self._add_overlap(chunks, text, offset)

    def _add_overlap(
        self,
        chunks: List[Dict[str, Any]],
        original_text: str,
        offset: int
    ) -> List[Dict[str, Any]]:
        """Добавить перекрытие между чанками."""
        if len(chunks) <= 1:
            return chunks

        overlap_chars = int(self.config.max_chunk_chars * self.config.chunk_overlap_percent)

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

    EXTRACTION_PROMPT = """Ты - литературный редактор и визуальный директор. Твоя задача - подготовить детальные справки для художников и создать схему связей персонажей.

ЗАДАЧА:
1. Выдели ТОЛЬКО ГЛАВНЫХ персонажей и КЛЮЧЕВЫЕ локации (Top-15 для сюжета). Игнорируй обычные предметы и фоновых персонажей.
2. Оцени ВАЖНОСТЬ (importance) каждой сущности от 1 до 10.
   - 9-10: Протагонисты, Главные антагонисты, Основные локации.
   - 7-8: Значимые второстепенные персонажи, Частые локации.
   - 1-6: ИГНОРИРОВАТЬ.
3. Для каждой сущности дай "visual_summary" (описание внешности одним абзацем).
4. КРИТИЧНО: Укажи ВСЕ АЛЬТЕРНАТИВНЫЕ ИМЕНА (aliases) персонажа!
   - Примеры: "Геральт" → aliases: ["Белый Волк", "Ведьмак", "Мясник из Блавикена"]
   - Примеры: "Гарри Поттер" → aliases: ["Мальчик-который-выжил", "Избранный"]
   - Примеры: "Aragorn" → aliases: ["Strider", "Elessar", "Isildur's Heir"]
5. Определи СВЯЗИ между сущностями.
6. Выдели ОПИСАТЕЛЬНЫЕ ФРАГМЕНТЫ (descriptions) длиннее 50 символов.
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
            self._model = self.config.model_id
            self._types = types

            self._available = True
            logger.info(f"Gemini extractor initialized (model: {self.config.model_id}, SDK: google-genai)")

        except ImportError:
            logger.error("google-genai not installed. Run: pip install google-genai")
        except Exception as e:
            logger.error(f"Failed to initialize Gemini: {e}")

    def is_available(self) -> bool:
        """Проверить доступность экстрактора."""
        return self._available

    async def analyze_chapter(
        self,
        text: str,
        chapter_id: Optional[str] = None
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

        # Phase 2: Parallel chunk processing with semaphore (rate limit)
        semaphore = asyncio.Semaphore(3)  # Max 3 concurrent Gemini calls
        
        async def process_chunk_with_semaphore(chunk_data: dict, chunk_idx: int):
            """Process single chunk with rate limiting."""
            async with semaphore:
                try:
                    prompt = self.EXTRACTION_PROMPT.format(text=chunk_data["text"])
                    # Phase 6: Returns GeminiResponseSchema object directly
                    gemini_response = await self._call_gemini_with_retry(prompt)
                    
                    chunk_descriptions = self._convert_descriptions(
                        gemini_response.descriptions, chunk_data["start"], chunk_data["text"]
                    )
                    chunk_entities = self._convert_entities(
                        gemini_response.entities, chunk_data["start"], chunk_data["text"]
                    )
                    chunk_relationships = self._convert_relationships(gemini_response.relationships)
                    
                    return {
                        "descriptions": chunk_descriptions,
                        "entities": chunk_entities,
                        "relationships": chunk_relationships,
                        "success": True
                    }
                except Exception as e:
                    logger.warning(f"Chunk {chunk_idx} analysis failed: {e}")
                    self.stats["failed_calls"] += 1
                    return {"descriptions": [], "entities": [], "relationships": [], "success": False}
        
        # Execute all chunks in parallel
        results = await asyncio.gather(*[
            process_chunk_with_semaphore(chunk, i) 
            for i, chunk in enumerate(chunks)
        ], return_exceptions=True)
        
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
        
        # Stats
        self.stats["total_time"] += time.time() - start_time
        self.stats["total_descriptions"] += len(unique_descriptions)
        
        logger.info(
            f"Parallel chunk processing complete: {len(unique_descriptions)} descriptions, "
            f"{len(unique_entities)} entities, {len(all_relationships)} relationships from {len(chunks)} chunks"
        )

        return ChapterAnalysisResult(
            descriptions=unique_descriptions,
            entities=unique_entities,
            relationships=all_relationships
        )

    async def extract(
        self,
        text: str,
        chapter_id: Optional[str] = None
    ) -> List[ExtractedDescription]:
        """
        Legacy wrapper for backward compatibility.
        """
        result = await self.analyze_chapter(text, chapter_id)
        return result.descriptions

    async def _extract_from_chunk(
        self,
        chunk_text: str,
        offset: int
    ) -> List[ExtractedDescription]:
        """Extract descriptions from a single chunk using tenacity retry."""
        self.stats["total_calls"] += 1

        prompt = self.EXTRACTION_PROMPT.format(text=chunk_text)

        try:
            # Use tenacity retry decorator for the actual extraction
            # Phase 6: parsed Pydantic object
            gemini_response = await self._call_gemini_with_retry(prompt)

            descriptions = self._convert_descriptions(gemini_response.descriptions, offset, chunk_text)

            self.stats["successful_calls"] += 1
            self.stats["total_tokens"] += len(prompt) // 4  # Approximately

            return descriptions

        except Exception as e:
            logger.warning(f"Chunk extraction failed after all retries: {e}")
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
                timeout=self.config.timeout_seconds
            )

            duration = time.time() - start_time
            record_llm_request(model_name, "success", duration)

            if hasattr(response, 'parsed') and response.parsed:
                logger.debug("Gemini structured response received and parsed successfully")
                return response.parsed
                
            text = response.text if hasattr(response, 'text') else str(response)
            logger.warning("Gemini returned text instead of parsed object, parsing manually")
            return GeminiResponseSchema.model_validate_json(text)

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

    def _convert_descriptions(
        self,
        schema_descriptions: List[GeminiDescriptionSchema],
        offset: int,
        source_text: Optional[str] = None
    ) -> List[ExtractedDescription]:
        """Convert Pydantic schemas to ExtractedDescription objects with validation."""
        descriptions = []
        source_lower = source_text.lower() if source_text else None

        for item in schema_descriptions:
            content = item.content

            if len(content) < self.config.min_description_chars:
                continue

            if item.confidence < self.config.min_confidence:
                logger.debug(f"Skipping low confidence description: {content[:50]}... (conf={item.confidence})")
                continue

            if source_lower:
                content_sample = content[:100].lower()
                if content_sample not in source_lower:
                    logger.debug(f"Description not found in source text: {content[:50]}...")
                    continue

            if len(content) > self.config.max_description_chars:
                content = content[:self.config.max_description_chars]

            try:
                desc_type = DescriptionType(item.type.lower())
            except ValueError:
                desc_type = DescriptionType.LOCATION

            actual_position = item.text_offset if item.text_offset is not None else offset
            
            desc_obj = ExtractedDescription(
                content=content,
                description_type=desc_type,
                confidence=item.confidence,
                entities=[{"name": name} for name in item.entities],
                attributes={},
                position=actual_position,
                source_span=(actual_position, actual_position + len(content))
            )
            descriptions.append(desc_obj)

        return descriptions

    def _convert_entities(
        self,
        schema_entities: List[GeminiEntitySchema],
        chunk_offset: int = 0,
        source_text: Optional[str] = None
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
                    a.lower().strip() in source_lower 
                    for a in (item.aliases or []) if a
                )
                if not name_in_text and not aliases_in_text:
                    logger.debug(f"Entity '{name}' not found in source text, skipping")
                    continue
            
            importance = item.importance
            if importance < 1 or importance > 10:
                logger.debug(f"Clamping importance {importance} to 1-10 for entity '{name}'")
                importance = max(1, min(10, importance))
            
            confidence = item.confidence
            if confidence < 0.0 or confidence > 1.0:
                logger.debug(f"Clamping confidence {confidence} to 0.0-1.0 for entity '{name}'")
                confidence = max(0.0, min(1.0, confidence))
            
            first_mention_offset = None
            if item.first_mention_offset is not None:
                first_mention_offset = chunk_offset + item.first_mention_offset
            
            entities.append(ExtractedEntity(
                name=name,
                type=item.type.lower() if item.type else "character",
                visual_summary=item.visual_summary or "",
                aliases=[a.strip() for a in item.aliases if a] if item.aliases else [],
                confidence=confidence,
                importance=importance,
                first_mention_offset=first_mention_offset
            ))
        return entities

    def _convert_relationships(
        self,
        schema_relationships: List[GeminiRelationshipSchema]
    ) -> List[ExtractedRelationship]:
        """Convert Pydantic schemas to ExtractedRelationship objects."""
        relationships = []
        for item in schema_relationships:
            relationships.append(ExtractedRelationship(
                source=item.source,
                target=item.target,
                type=item.type,
                weight=item.weight,
                context=item.context
            ))
        return relationships

    def _deduplicate(
        self,
        descriptions: List[ExtractedDescription]
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
        self,
        entities: List[ExtractedEntity]
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
                # Need strictly high threshold (>0.85) to avoid false positives
                similarity = SequenceMatcher(None, entity.name.lower(), existing.name.lower()).ratio()
                if similarity > 0.85:
                    is_duplicate = True
                    best_match = existing
                    break
                    
                # 3. Substring match for very long names (if one name contains the other)
                if (len(entity.name) > 4 and len(existing.name) > 4 and 
                   (entity.name.lower() in existing.name.lower() or existing.name.lower() in entity.name.lower())):
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
                if self.stats["total_calls"] > 0 else 0
            ),
            "avg_descriptions_per_call": (
                self.stats["total_descriptions"] / self.stats["successful_calls"]
                if self.stats["successful_calls"] > 0 else 0
            ),
        }


# Singleton
_extractor: Optional[GeminiDirectExtractor] = None


def get_gemini_extractor(config: Optional[GeminiConfig] = None) -> GeminiDirectExtractor:
    """Получить singleton экстрактора."""
    global _extractor
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
