"""
Gemini Direct Extractor - Direct Google Gemini API calls for description extraction.

REPLACES LangExtract library:
- LangExtract returns entities (NER) instead of descriptions
- This module uses direct API calls to get full paragraphs

ARCHITECTURE:
- google-generativeai SDK for direct Gemini access
- Few-shot prompts for Russian literature
- JSON repair with retry logic
- Recursive text chunking
- Exponential backoff retry with tenacity

Created: 2025-12-13
Updated: 2025-12-28 - Added tenacity-based retry logic
Author: fancai Team
"""

import os
import re
import json
import time
import logging
import asyncio
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum

from app.core.retry import (
    retry_llm_extraction,
    LLMExtractionError,
    RateLimitError,
    TimeoutError as RetryTimeoutError,
)

logger = logging.getLogger(__name__)


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
        return {
            "content": self.content,
            "type": self.description_type.value,
            "confidence_score": self.confidence,
            "priority_score": self._calculate_priority(),
            "source": "gemini_direct",
            "position": self.position,
            "word_count": len(self.content.split()),
            "entities_mentioned": [e.get("name", "") for e in self.entities],
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
            DescriptionType.ATMOPSHERE: 45, # Note: Fixed typo ATMOSPHERE if present, relying on enum
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
    max_chunk_chars: int = 4000  # ~1000 токенов
    min_chunk_chars: int = 200
    chunk_overlap_percent: float = 0.15  # 15% перекрытие

    # Извлечение
    max_descriptions_per_chunk: int = 10
    min_description_chars: int = 100
    max_description_chars: int = 1000
    min_confidence: float = 0.6

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


class JSONResponseParser:
    """
    Парсер JSON ответов от LLM с автоматическим исправлением.
    """

    @staticmethod
    def parse(response: str) -> Dict[str, Any]:
        """
        Парсинг ответа LLM с несколькими стратегиями.

        Args:
            response: Сырой ответ от LLM

        Returns:
            Распарсенный JSON или пустой результат
        """
        # Стратегия 1: Прямой парсинг
        try:
            result = json.loads(response)
            if isinstance(result, list):
                return {"descriptions": result}
            return result
        except json.JSONDecodeError:
            pass

        # Стратегия 2: Извлечение из markdown блока (более агрессивная очистка)
        # Сначала удаляем markdown код блоки
        cleaned = response.strip()
        if cleaned.startswith("```"):
            # Удаляем открывающий блок (```json или ```)
            cleaned = re.sub(r'^```(?:json)?\s*\n?', '', cleaned)
            # Удаляем закрывающий блок
            cleaned = re.sub(r'\n?```\s*$', '', cleaned)
            try:
                result = json.loads(cleaned)
                # Handle both dict and list formats
                if isinstance(result, list):
                    logger.debug(f"Parsed via markdown cleanup: {len(result)} descriptions (list)")
                    return {"descriptions": result}
                elif isinstance(result, dict):
                    logger.debug(f"Parsed via markdown cleanup: {len(result.get('descriptions', []))} descriptions")
                    return result
                return result
            except json.JSONDecodeError as e:
                logger.debug(f"Markdown cleanup parse failed: {e}")
                pass

        # Стратегия 2b: Стандартный regex для markdown блока
        json_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', response)
        if json_match:
            try:
                result = json.loads(json_match.group(1))
                if isinstance(result, list):
                    return {"descriptions": result}
                return result
            except json.JSONDecodeError:
                pass

        # Стратегия 3: Поиск JSON-подобной структуры
        json_match = re.search(r'\{[\s\S]*"descriptions"[\s\S]*\}', response)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                # Попытка исправить
                fixed = JSONResponseParser._fix_json(json_match.group())
                try:
                    return json.loads(fixed)
                except json.JSONDecodeError:
                    pass

        # Стратегия 4: Извлечение массива descriptions
        array_match = re.search(r'\[[\s\S]*\]', response)
        if array_match:
            try:
                descriptions = json.loads(array_match.group())
                return {"descriptions": descriptions}
            except json.JSONDecodeError:
                pass

        logger.warning(f"Failed to parse JSON response: {response[:200]}...")
        return {"descriptions": []}

    @staticmethod
    def _fix_json(text: str) -> str:
        """Попытка исправить невалидный JSON."""
        # Удаляем trailing commas
        text = re.sub(r',\s*}', '}', text)
        text = re.sub(r',\s*]', ']', text)

        # Заменяем одинарные кавычки на двойные
        text = re.sub(r"(?<=[{,:\[])\s*'([^']*?)'\s*(?=[},:\]])", r'"\1"', text)

        # Экранируем переносы строк в строках
        text = re.sub(r'(?<!\\)\n(?=[^"]*"[^"]*$)', r'\\n', text)

        return text


class GeminiDirectExtractor:
    """
    Прямой экстрактор описаний через Google Gemini API.

    Заменяет LangExtract библиотеку для получения полных описаний
    вместо коротких сущностей (NER).
    """

    # Промпт для извлечения описаний
    # Двойные скобки {{ }} экранированы для использования с .format()
    EXTRACTION_PROMPT = """Ты - литературный редактор и визуальный директор. Твоя задача - подготовить детальные справки для художников и создать схему связей персонажей.

ЗАДАЧА:
1. Выдели все СУЩНОСТИ (Персонажи, Локации, Значимые Предметы).
2. Для каждой сущности дай "visual_summary" (описание внешности одним абзацем для промпта).
3. Определи СВЯЗИ между сущностями (кто с кем взаимодействует, где кто находится) и оцени ВЕС связи (1-10) на основе частоты взаимодействий.

ТИПЫ СУЩНОСТЕЙ:
- character: Люди, существа. Описывай: лицо, волосы, одежда, возраст, особые приметы.
- location: Места действия. Описывай: освещение, архитектура, погода, атмосфера, детали интерьера/экстерьера.
- object: Важные предметы (меч, кольцо, автомобиль). Описывай: материал, цвет, форма, состояние.

ФОРМАТ ОТВЕТА (JSON):
```json
{
  "entities": [
    {
      "name": "Имя или Название",
      "type": "character",
      "visual_summary": "Высокий старик с длинной седой бородой, в синей остроконечной шляпе и серой мантии. Добрые голубые глаза.",
      "aliases": ["Гэндальф", "Митрандир"],
      "confidence": 0.95
    },
    {
      "name": "Шир",
      "type": "location",
      "visual_summary": "Уютная деревня с зелеными холмами и круглыми дверями нор. Солнечный летний день, цветущие сады.",
      "aliases": ["Хоббитон"],
      "confidence": 0.9
    }
  ],
  "relationships": [
    {
      "source": "Имя1",
      "target": "Имя2",
      "type": "FRIEND",
      "weight": 0.8,
      "context": "Давно знают друг друга, часто беседуют."
    },
    {
      "source": "Имя1",
      "target": "НазваниеЛокации",
      "type": "LOCATED_IN",
      "weight": 1.0
    }
  ],
  "descriptions": [  // BACKWARD COMPATIBILITY: Старый формат для генерации сцен
    {
      "content": "Полное предложение с описанием из текста...",
      "type": "location",
      "confidence": 0.9,
      "entities": ["Имя1", "НазваниеЛокации"]
    }
  ]
}
```

ТЕКСТ ДЛЯ АНАЛИЗА:
{text}

Верни ТОЛЬКО валидный JSON."""

    def __init__(self, config: Optional[GeminiConfig] = None):
        """Инициализация экстрактора."""
        self.config = config or GeminiConfig()
        self.config.api_key = self.config.api_key or os.getenv("LANGEXTRACT_API_KEY")

        self.chunker = RecursiveTextChunker(self.config)
        self.parser = JSONResponseParser()

        self._client = None  # google-genai Client
        self._model = None   # model ID string
        self._types = None   # google.genai.types module
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

        all_descriptions = []
        all_entities = []
        all_relationships = []

        for i, chunk in enumerate(chunks):
            try:
                # Extract raw JSON response
                prompt = self.EXTRACTION_PROMPT.format(text=chunk["text"])
                response_text = await self._call_gemini_with_retry(prompt)
                parsed = self.parser.parse(response_text)
                
                # Parse descriptions (legacy + new)
                descriptions = self._parse_descriptions(parsed, chunk["start"])
                all_descriptions.extend(descriptions)
                
                # Parse entities
                entities_json = parsed.get("entities", [])
                for e in entities_json:
                    all_entities.append(ExtractedEntity(
                        name=e.get("name", "Unknown"),
                        type=e.get("type", "object"),
                        visual_summary=e.get("visual_summary", ""),
                        aliases=e.get("aliases", []),
                        confidence=float(e.get("confidence", 0.0))
                    ))
                    
                # Parse relationships
                rels_json = parsed.get("relationships", [])
                for r in rels_json:
                    all_relationships.extend(rels_json) # Raw dicts first, simplified for now
                    # TODO: Convert to ExtractedRelationship objects strictly
                
                # Rate limiting
                if i < len(chunks) - 1:
                    await asyncio.sleep(0.1)

            except Exception as e:
                logger.warning(f"Chunk {i} analysis failed: {e}")
                self.stats["failed_calls"] += 1

        # Deduplicate Descriptions
        unique_descriptions = self._deduplicate(all_descriptions)
        
        # Deduplicate Entities (Merge logic needed in ConsistencyManager, here just raw list)
        # We return all found entities, ConsistencyManager will clean them up.

        # Stats
        self.stats["total_time"] += time.time() - start_time
        self.stats["total_descriptions"] += len(unique_descriptions)

        return ChapterAnalysisResult(
            descriptions=unique_descriptions,
            entities=all_entities,
            relationships=[] # Placeholder - relationships need complex merging logic
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
            response_text = await self._call_gemini_with_retry(prompt)

            # Parse JSON response
            parsed = self.parser.parse(response_text)

            # Convert to ExtractedDescription objects
            descriptions = self._parse_descriptions(parsed, offset)

            self.stats["successful_calls"] += 1

            # Estimate tokens
            self.stats["total_tokens"] += len(prompt) // 4 + len(response_text) // 4

            return descriptions

        except Exception as e:
            logger.warning(f"Chunk extraction failed after all retries: {e}")
            self.stats["failed_calls"] += 1
            return []

    @retry_llm_extraction
    async def _call_gemini_with_retry(self, prompt: str) -> str:
        """
        Call Gemini API with tenacity retry decorator.

        Raises retryable exceptions that trigger tenacity retry logic.
        """
        try:
            # Call Gemini API with new SDK (google-genai)
            # Using types.GenerateContentConfig for proper configuration
            config = self._types.GenerateContentConfig(
                temperature=0.3,
                top_p=0.95,
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

            # Extract text from response - handle both string and list formats
            response_text = response.text if hasattr(response, 'text') else str(response)

            return response_text

        except asyncio.TimeoutError as e:
            error_msg = f"Gemini API timed out after {self.config.timeout_seconds}s"
            logger.warning(error_msg)
            raise RetryTimeoutError(error_msg) from e

        except Exception as e:
            error_msg = str(e)
            # Check if it's a rate limit error
            if "rate" in error_msg.lower() and "limit" in error_msg.lower():
                raise RateLimitError(error_msg) from e
            if "quota" in error_msg.lower():
                raise RateLimitError(error_msg) from e
            if "429" in error_msg:
                raise RateLimitError(error_msg) from e
            # Other errors - wrap as retryable LLMExtractionError
            logger.error(f"Gemini extraction error: {error_msg}")
            raise LLMExtractionError(error_msg) from e

    def _parse_descriptions(
        self,
        parsed: Any,
        offset: int
    ) -> List[ExtractedDescription]:
        """Конвертация JSON в ExtractedDescription объекты."""
        descriptions = []

        # Handle different response formats
        if isinstance(parsed, list):
            # Direct list of descriptions
            items = parsed
        elif isinstance(parsed, dict):
            # Dict with "descriptions" key
            items = parsed.get("descriptions", [])
        else:
            logger.warning(f"Unexpected parsed type: {type(parsed)}")
            return descriptions

        for item in items:
            try:
                content = item.get("content", "")

                # Проверяем минимальную длину
                if len(content) < self.config.min_description_chars:
                    continue

                # Ограничиваем максимальную длину
                if len(content) > self.config.max_description_chars:
                    content = content[:self.config.max_description_chars]

                # Определяем тип
                type_str = item.get("type", "location").lower()
                try:
                    desc_type = DescriptionType(type_str)
                except ValueError:
                    desc_type = DescriptionType.LOCATION

                # Получаем confidence
                confidence = float(item.get("confidence", 0.7))
                confidence = max(0.0, min(1.0, confidence))

                # Получаем entities
                entities = item.get("entities", [])
                if not isinstance(entities, list):
                    entities = []

                descriptions.append(ExtractedDescription(
                    content=content,
                    description_type=desc_type,
                    confidence=confidence,
                    entities=entities,
                    position=offset,
                    source_span=(offset, offset + len(content)),
                ))

            except Exception as e:
                logger.debug(f"Failed to parse description: {e}")
                continue

        return descriptions

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
