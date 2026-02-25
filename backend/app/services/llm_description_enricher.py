"""
LLM Description Enricher - использует LangExtract для семантического обогащения описаний.

Этот модуль использует Google LangExtract (2025) для извлечения структурированной информации
из описаний с помощью LLM (Gemini, OpenAI, или Ollama).

КЛЮЧЕВЫЕ ПРЕИМУЩЕСТВА:
- Semantic Understanding - понимание контекста и неявных описаний
- Source Grounding - привязка к источнику текста
- Structured Output - структурированный JSON вывод
- Long Document Support - обработка длинных текстов

ИНТЕГРАЦИЯ:
Используется как опциональный обогатитель для AdvancedDescriptionExtractor.
Работает только если API ключ доступен или используется локальная модель Ollama.
"""

import os
import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from app.models.description import DescriptionType

logger = logging.getLogger(__name__)



@dataclass
class EnrichedDescription:
    """
    Обогащенное описание с извлеченными семантическими данными.

    Attributes:
        original_text: Исходный текст описания
        description_type: Тип описания
        extracted_entities: Извлеченные сущности
        attributes: Семантические атрибуты
        confidence: Уверенность модели (0.0-1.0)
        source_spans: Привязка к источнику (source grounding)
    """

    original_text: str
    description_type: DescriptionType
    extracted_entities: List[Dict[str, Any]]
    attributes: Dict[str, Any]
    confidence: float = 0.0
    source_spans: Optional[List[tuple[int, int]]] = None


class LLMDescriptionEnricher:
    """
    LLM-based обогатитель описаний с использованием Google LangExtract.

    Особенности:
    - Опциональное использование (только если API ключ доступен)
    - Поддержка разных моделей (Gemini, OpenAI, Ollama)
    - Source grounding для проверяемости
    - Structured output с валидацией

    Example:
        >>> enricher = LLMDescriptionEnricher(model_id="gemini-3-flash-preview")
        >>> if enricher.is_available():
        >>>     result = enricher.enrich_location_description(
        >>>         "Высокий темный замок возвышался на холме"
        >>>     )
        >>>     print(result.extracted_entities)
    """

    def __init__(
        self,
        model_id: str = "gemini-3-flash-preview",  # Dec 2025: gemini-3-flash-preview
        api_key: Optional[str] = None,
        use_ollama: bool = False,
    ):
        """
        Инициализация LLM enricher.

        Args:
            model_id: ID модели ("gemini-3-flash-preview", "gpt-4", "llama3")
            api_key: API ключ (опционально, можно через env)
            use_ollama: Использовать локальную Ollama вместо API
        """
        self.model_id = model_id
        self.api_key = api_key or os.getenv("LANGEXTRACT_API_KEY")
        self.use_ollama = use_ollama
        self._available = False
        self._lx = None

        # Попытка импорта LangExtract
        try:
            import langextract as lx

            self._lx = lx
            self._available = True
            logger.info("✅ LangExtract library loaded successfully")
        except ImportError:
            logger.warning(
                "LangExtract not installed. Install with: pip install langextract"
            )
            self._available = False

        # Проверка доступности API или Ollama
        if self._available and not use_ollama and not self.api_key:
            logger.warning(
                "LangExtract API key not found. Set LANGEXTRACT_API_KEY environment variable "
                "or use Ollama for local inference."
            )
            self._available = False

    def is_available(self) -> bool:
        """Проверить, доступен ли LLM enricher."""
        return self._available

    def enrich_location_description(self, text: str) -> Optional[EnrichedDescription]:
        """
        Обогатить описание локации.

        Извлекает:
        - Архитектурные элементы (walls, towers, gates)
        - Природные элементы (hills, forests, rivers)
        - Атмосферные качества (dark, ancient, mysterious)
        - Размер и масштаб (tall, vast, narrow)

        Args:
            text: Текст описания локации

        Returns:
            EnrichedDescription или None если обогащение не удалось
        """
        if not self._available:
            return None

        prompt = """
        Извлеките из текста описание локации. Определите:
        1. Архитектурные элементы (walls, towers, doors, windows)
        2. Природные элементы (hills, trees, water, sky)
        3. Атмосферные качества (dark, bright, mysterious, ancient)
        4. Размер и масштаб (tall, vast, small, narrow)
        5. Пространственные отношения (above, below, inside, near)
        """

        examples = self._create_location_examples()

        return self._extract_with_langextract(
            text=text,
            prompt=prompt,
            examples=examples,
            description_type=DescriptionType.LOCATION,
        )

    def enrich_character_description(self, text: str) -> Optional[EnrichedDescription]:
        """
        Обогатить описание персонажа.

        Извлекает:
        - Физические характеристики (height, build, hair, eyes)
        - Одежда и экипировка (armor, cloak, weapons)
        - Эмоции и выражения (smile, frown, anger)
        - Возраст и опыт (young, old, weathered)

        Args:
            text: Текст описания персонажа

        Returns:
            EnrichedDescription или None если обогащение не удалось
        """
        if not self._available:
            return None

        prompt = """
        Извлеките из текста описание персонажа. Определите:
        1. Физические характеристики (рост, телосложение, волосы, глаза)
        2. Одежду и экипировку (доспехи, плащ, оружие)
        3. Эмоции и выражения лица (улыбка, хмурость, гнев)
        4. Возраст и опыт (молодой, старый, опытный)
        5. Характерные черты (шрамы, татуировки, украшения)
        """

        examples = self._create_character_examples()

        return self._extract_with_langextract(
            text=text,
            prompt=prompt,
            examples=examples,
            description_type=DescriptionType.CHARACTER,
        )

    def enrich_atmosphere_description(self, text: str) -> Optional[EnrichedDescription]:
        """
        Обогатить описание атмосферы.

        Извлекает:
        - Освещение (bright, dark, dim, glowing)
        - Погоду (rain, wind, fog, storm)
        - Звуки (silence, whisper, roar, music)
        - Запахи (smoke, flowers, decay, spice)
        - Настроение (tense, peaceful, ominous, joyful)

        Args:
            text: Текст описания атмосферы

        Returns:
            EnrichedDescription или None если обогащение не удалось
        """
        if not self._available:
            return None

        prompt = """
        Извлеките из текста описание атмосферы. Определите:
        1. Освещение (яркое, темное, тусклое, сияющее)
        2. Погодные условия (дождь, ветер, туман, буря)
        3. Звуки (тишина, шепот, рев, музыка)
        4. Запахи (дым, цветы, гниль, специи)
        5. Общее настроение (напряженное, мирное, зловещее, радостное)
        """

        examples = self._create_atmosphere_examples()

        return self._extract_with_langextract(
            text=text,
            prompt=prompt,
            examples=examples,
            description_type=DescriptionType.ATMOSPHERE,
        )

    def _extract_with_langextract(
        self,
        text: str,
        prompt: str,
        examples: List[Any],
        description_type: DescriptionType,
    ) -> Optional[EnrichedDescription]:
        """
        Общий метод для извлечения с помощью LangExtract.

        Args:
            text: Текст для обработки
            prompt: Промпт для модели
            examples: Примеры для few-shot learning
            description_type: Тип описания

        Returns:
            EnrichedDescription или None
        """
        if not self._available or not self._lx:
            return None

        try:
            # Выполнить извлечение
            result = self._lx.extract(
                text_or_documents=text,
                prompt_description=prompt,
                examples=examples,
                model_id=self.model_id,
                api_key=self.api_key if not self.use_ollama else None,
            )

            # Парсинг результатов
            extracted_entities = []
            attributes = {}
            source_spans = []

            if hasattr(result, "extractions"):
                for extraction in result.extractions:
                    entity = {
                        "class": getattr(extraction, "extraction_class", "unknown"),
                        "text": getattr(extraction, "extraction_text", ""),
                        "attributes": getattr(extraction, "attributes", {}),
                    }
                    extracted_entities.append(entity)

                    # Source grounding
                    if hasattr(extraction, "source_span"):
                        source_spans.append(extraction.source_span)

                    # Собрать атрибуты
                    if hasattr(extraction, "attributes"):
                        attributes.update(extraction.attributes)

            # Вычислить confidence
            confidence = getattr(result, "confidence", 0.5)

            return EnrichedDescription(
                original_text=text,
                description_type=description_type,
                extracted_entities=extracted_entities,
                attributes=attributes,
                confidence=confidence,
                source_spans=source_spans,
            )

        except Exception as e:
            logger.error(f"LangExtract extraction failed: {e}")
            return None

    def _create_location_examples(self) -> List[Any]:
        """Создать примеры для извлечения описаний локаций."""
        if not self._lx:
            return []

        examples = [
            self._lx.data.ExampleData(
                text="Высокий темный замок возвышался на крутом холме.",
                extractions=[
                    self._lx.data.Extraction(
                        extraction_class="architecture",
                        extraction_text="замок",
                        attributes={
                            "size": "высокий",
                            "atmosphere": "темный",
                            "location": "на холме",
                        },
                    ),
                    self._lx.data.Extraction(
                        extraction_class="natural",
                        extraction_text="холм",
                        attributes={"slope": "крутой"},
                    ),
                ],
            )
        ]
        return examples

    def _create_character_examples(self) -> List[Any]:
        """Создать примеры для извлечения описаний персонажей."""
        if not self._lx:
            return []

        examples = [
            self._lx.data.ExampleData(
                text="Старый маг с длинной седой бородой и проницательными глазами.",
                extractions=[
                    self._lx.data.Extraction(
                        extraction_class="physical",
                        extraction_text="маг",
                        attributes={
                            "age": "старый",
                            "hair": "длинная седая борода",
                            "eyes": "проницательные",
                        },
                    )
                ],
            )
        ]
        return examples

    def _create_atmosphere_examples(self) -> List[Any]:
        """Создать примеры для извлечения описаний атмосферы."""
        if not self._lx:
            return []

        examples = [
            self._lx.data.ExampleData(
                text="Холодный ветер пронесся через улицы, принося запах дождя.",
                extractions=[
                    self._lx.data.Extraction(
                        extraction_class="weather",
                        extraction_text="ветер",
                        attributes={"temperature": "холодный", "movement": "пронесся"},
                    ),
                    self._lx.data.Extraction(
                        extraction_class="smell",
                        extraction_text="запах дождя",
                        attributes={"type": "дождь"},
                    ),
                ],
            )
        ]
        return examples

    def get_statistics(self) -> Dict[str, Any]:
        """
        Получить статистику использования enricher.

        Returns:
            Словарь со статистикой
        """
        return {
            "available": self._available,
            "model_id": self.model_id,
            "use_ollama": self.use_ollama,
            "api_key_set": bool(self.api_key),
        }


# Singleton instance
_llm_enricher = None


def get_llm_enricher(
    model_id: str = "gemini-3-flash-preview", use_ollama: bool = False
) -> LLMDescriptionEnricher:
    """
    Получить singleton instance LLM enricher.

    Args:
        model_id: ID модели
        use_ollama: Использовать Ollama

    Returns:
        Единственный экземпляр enricher
    """
    global _llm_enricher
    if _llm_enricher is None:
        _llm_enricher = LLMDescriptionEnricher(model_id=model_id, use_ollama=use_ollama)
    return _llm_enricher
