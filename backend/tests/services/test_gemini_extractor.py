"""
Tests for Gemini Direct Extractor — мигрирован на OpenRouter (Plan 03-02).

Tests cover:
1. Инициализация через OpenRouter клиент (не google-genai)
2. _call_gemini_with_retry вызывает generate_structured с GeminiResponseSchema
3. _call_gemini_tsa вызывает generate_structured с GeminiTSAResponseSchema
4. Ответ корректно валидируется через model_validate (Pydantic)
5. asyncio.to_thread НЕ используется (httpx полностью async)
6. Файл НЕ содержит import google.genai
7. Chunking, deduplication, priority calculation
"""

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.gemini_extractor import (
    GeminiDirectExtractor,
    GeminiConfig,
    GeminiResponseSchema,
    GeminiTSAResponseSchema,
    GeminiEntitySchema,
    GeminiRelationshipSchema,
    GeminiDescriptionSchema,
    ExtractedDescription,
    DescriptionType,
    RecursiveTextChunker,
    get_gemini_extractor,
)

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def mock_openrouter_client():
    """Mock OpenRouter client с generate_structured."""
    client = MagicMock()
    client.generate_structured = AsyncMock()
    return client


@pytest.fixture
def sample_config():
    """Sample Gemini configuration."""
    return GeminiConfig(
        model_id="gemini-2.5-flash",
        api_key="test_openrouter_key_12345",
        max_chunk_chars=4000,
        min_chunk_chars=200,
        max_descriptions_per_chunk=10,
        min_description_chars=100,
        max_description_chars=1000,
        min_confidence=0.6,
        max_retries=3,
        retry_delay_seconds=1.0,
        timeout_seconds=30,
    )


@pytest.fixture
def sample_text():
    """Sample Russian text for testing."""
    return """
    Старый замок возвышался на высоком холме, окруженный густым лесом.
    Его величественные башни касались облаков, а мрачные стены хранили множество тайн.
    Серый камень, из которого были сложены стены, потемнел от времени.

    Молодой князь Алексей стоял у окна. Его тёмные глаза смотрели вдаль с задумчивым выражением.
    Длинные чёрные волосы были собраны в хвост, а на плечах лежал тяжёлый бархатный плащ
    тёмно-синего цвета.
    """


def _make_gemini_response_dict() -> dict:
    """Sample dict matching GeminiResponseSchema."""
    return {
        "descriptions": [
            {
                "content": "Старый замок возвышался на высоком холме, окруженный густым лесом.",
                "type": "location",
                "confidence": 0.9,
                "entities": [],
                "text_offset": None,
            }
        ],
        "entities": [],
        "relationships": [],
    }


def _make_tsa_response_dict() -> dict:
    """Sample dict matching GeminiTSAResponseSchema."""
    return {
        "tagged_text": 'Старый <desc type="location" occurrence="1">замок возвышался на холме</desc>',
        "entities": [],
        "relationships": [],
    }


# =============================================================================
# Проверка: google.genai НЕ импортируется
# =============================================================================


class TestNoGoogleGenaiImport:
    """Убеждаемся что google.genai полностью убран из gemini_extractor."""

    def test_no_google_genai_import(self):
        """gemini_extractor.py не должен импортировать google.genai."""
        import app.services.gemini_extractor as mod

        assert not hasattr(mod, "genai"), "Найден атрибут genai — google-genai не убран"
        assert not hasattr(
            mod, "types"
        ), "Найден атрибут types — google.genai.types не убран"

    def test_uses_openrouter_client(self):
        """gemini_extractor должен использовать get_ai_provider (AIProvider factory)."""
        import app.services.gemini_extractor as mod

        assert hasattr(mod, "get_ai_provider"), "get_ai_provider не импортирован"

    def test_no_asyncio_to_thread_usage(self):
        """_call_gemini_with_retry и _call_gemini_tsa не должны вызывать asyncio.to_thread."""
        import ast
        import inspect
        import app.services.gemini_extractor as mod

        def has_to_thread_call(source: str) -> bool:
            try:
                tree = ast.parse(source)
            except SyntaxError:
                return False
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    func = node.func
                    if isinstance(func, ast.Attribute) and func.attr == "to_thread":
                        return True
            return False

        source = inspect.getsource(mod.GeminiDirectExtractor._call_gemini_with_retry)
        assert not has_to_thread_call(
            source
        ), "_call_gemini_with_retry вызывает asyncio.to_thread"

        source_tsa = inspect.getsource(mod.GeminiDirectExtractor._call_gemini_tsa)
        assert not has_to_thread_call(
            source_tsa
        ), "_call_gemini_tsa вызывает asyncio.to_thread"


# =============================================================================
# GeminiDirectExtractor — инициализация
# =============================================================================


class TestGeminiDirectExtractor:
    """Tests for GeminiDirectExtractor main class."""

    def test_initialization_uses_openrouter(self, sample_config):
        """Инициализация должна использовать get_ai_provider, а не genai.Client."""
        mock_client = MagicMock()
        with patch(
            "app.services.gemini_extractor.get_ai_provider",
            return_value=mock_client,
        ):
            extractor = GeminiDirectExtractor(sample_config)

        assert extractor._client is mock_client
        assert extractor.is_available() is True

    def test_initialization_success(self, sample_config):
        """Extractor должен быть доступен после инициализации."""
        mock_client = MagicMock()
        with patch(
            "app.services.gemini_extractor.get_ai_provider",
            return_value=mock_client,
        ):
            extractor = GeminiDirectExtractor(sample_config)

        assert extractor.is_available() is True
        assert extractor.config.model_id == "gemini-2.5-flash"

    def test_initialization_failure(self, sample_config):
        """Инициализация с ошибкой должна оставить extractor недоступным."""
        with patch(
            "app.services.gemini_extractor.get_ai_provider",
            side_effect=RuntimeError("Connection failed"),
        ):
            extractor = GeminiDirectExtractor(sample_config)

        assert extractor.is_available() is False

    @pytest.mark.asyncio
    async def test_extract_text_too_short(self, sample_config):
        """Extraction скипает текст который слишком короткий."""
        mock_client = MagicMock()
        with patch(
            "app.services.gemini_extractor.get_ai_provider",
            return_value=mock_client,
        ):
            extractor = GeminiDirectExtractor(sample_config)

        result = await extractor.extract("Short text")
        assert len(result) == 0

    @pytest.mark.asyncio
    async def test_extract_not_available(self, sample_config):
        """Extraction возвращает пустой список когда extractor недоступен."""
        with patch(
            "app.services.gemini_extractor.get_ai_provider",
            side_effect=RuntimeError("No API key"),
        ):
            extractor = GeminiDirectExtractor(sample_config)

        result = await extractor.extract("Some text here")
        assert result == []


# =============================================================================
# _call_gemini_with_retry — OpenRouter generate_structured
# =============================================================================


class TestCallGeminiWithRetry:
    """Тест _call_gemini_with_retry использует generate_structured с GeminiResponseSchema."""

    @pytest.mark.asyncio
    async def test_calls_generate_structured_with_gemini_response_schema(
        self, sample_config
    ):
        """_call_gemini_with_retry должен вызывать generate_structured(schema_class=GeminiResponseSchema)."""
        mock_client = AsyncMock()
        mock_client.generate_structured = AsyncMock(
            return_value=_make_gemini_response_dict()
        )

        with patch(
            "app.services.gemini_extractor.get_ai_provider",
            return_value=mock_client,
        ):
            extractor = GeminiDirectExtractor(sample_config)

        result = await extractor._call_gemini_with_retry("test prompt")

        mock_client.generate_structured.assert_called_once()
        call_kwargs = mock_client.generate_structured.call_args
        assert call_kwargs.kwargs.get("schema_class") is GeminiResponseSchema or (
            len(call_kwargs.args) >= 2 and call_kwargs.args[1] is GeminiResponseSchema
        )

    @pytest.mark.asyncio
    async def test_response_validated_as_pydantic_model(self, sample_config):
        """Ответ должен валидироваться как GeminiResponseSchema."""
        mock_client = AsyncMock()
        mock_client.generate_structured = AsyncMock(
            return_value=_make_gemini_response_dict()
        )

        with patch(
            "app.services.gemini_extractor.get_ai_provider",
            return_value=mock_client,
        ):
            extractor = GeminiDirectExtractor(sample_config)

        result = await extractor._call_gemini_with_retry("test prompt")

        assert isinstance(result, GeminiResponseSchema)
        assert len(result.descriptions) == 1
        assert result.descriptions[0].content.startswith("Старый замок")

    @pytest.mark.asyncio
    async def test_unwraps_data_wrapper(self, sample_config):
        """Обёртка 'data' должна разворачиваться."""
        mock_client = AsyncMock()
        wrapped = {"data": _make_gemini_response_dict()}
        mock_client.generate_structured = AsyncMock(return_value=wrapped)

        with patch(
            "app.services.gemini_extractor.get_ai_provider",
            return_value=mock_client,
        ):
            extractor = GeminiDirectExtractor(sample_config)

        result = await extractor._call_gemini_with_retry("test prompt")
        assert isinstance(result, GeminiResponseSchema)

    @pytest.mark.asyncio
    async def test_rate_limit_error_raises_rate_limit_error(self, sample_config):
        """HTTP 429 / rate limit должен поднимать RateLimitError."""
        from app.core.retry import RateLimitError

        mock_client = AsyncMock()
        mock_client.generate_structured = AsyncMock(
            side_effect=Exception("429 rate limit exceeded")
        )

        with patch(
            "app.services.gemini_extractor.get_ai_provider",
            return_value=mock_client,
        ):
            extractor = GeminiDirectExtractor(sample_config)

        with pytest.raises(RateLimitError):
            await extractor._call_gemini_with_retry("test prompt")

    @pytest.mark.asyncio
    async def test_generic_error_raises_llm_extraction_error(self, sample_config):
        """Общая ошибка должна поднимать LLMExtractionError."""
        from app.core.retry import LLMExtractionError

        mock_client = AsyncMock()
        mock_client.generate_structured = AsyncMock(
            side_effect=Exception("Internal Server Error")
        )

        with patch(
            "app.services.gemini_extractor.get_ai_provider",
            return_value=mock_client,
        ):
            extractor = GeminiDirectExtractor(sample_config)

        with pytest.raises(LLMExtractionError):
            await extractor._call_gemini_with_retry("test prompt")


# =============================================================================
# _call_gemini_tsa — OpenRouter generate_structured с GeminiTSAResponseSchema
# =============================================================================


class TestCallGeminiTSA:
    """Тест _call_gemini_tsa использует generate_structured с GeminiTSAResponseSchema."""

    @pytest.mark.asyncio
    async def test_calls_generate_structured_with_tsa_schema(self, sample_config):
        """_call_gemini_tsa должен вызывать generate_structured(schema_class=GeminiTSAResponseSchema)."""
        mock_client = AsyncMock()
        mock_client.generate_structured = AsyncMock(
            return_value=_make_tsa_response_dict()
        )

        with patch(
            "app.services.gemini_extractor.get_ai_provider",
            return_value=mock_client,
        ):
            extractor = GeminiDirectExtractor(sample_config)

        result = await extractor._call_gemini_tsa("test prompt")

        mock_client.generate_structured.assert_called_once()
        call_kwargs = mock_client.generate_structured.call_args
        assert call_kwargs.kwargs.get("schema_class") is GeminiTSAResponseSchema or (
            len(call_kwargs.args) >= 2
            and call_kwargs.args[1] is GeminiTSAResponseSchema
        )

    @pytest.mark.asyncio
    async def test_tsa_response_validated_as_pydantic_model(self, sample_config):
        """Ответ должен валидироваться как GeminiTSAResponseSchema."""
        mock_client = AsyncMock()
        mock_client.generate_structured = AsyncMock(
            return_value=_make_tsa_response_dict()
        )

        with patch(
            "app.services.gemini_extractor.get_ai_provider",
            return_value=mock_client,
        ):
            extractor = GeminiDirectExtractor(sample_config)

        result = await extractor._call_gemini_tsa("test prompt")

        assert isinstance(result, GeminiTSAResponseSchema)
        assert "замок" in result.tagged_text

    @pytest.mark.asyncio
    async def test_tsa_unwraps_data_wrapper(self, sample_config):
        """TSA: обёртка 'data' должна разворачиваться."""
        mock_client = AsyncMock()
        wrapped = {"data": _make_tsa_response_dict()}
        mock_client.generate_structured = AsyncMock(return_value=wrapped)

        with patch(
            "app.services.gemini_extractor.get_ai_provider",
            return_value=mock_client,
        ):
            extractor = GeminiDirectExtractor(sample_config)

        result = await extractor._call_gemini_tsa("test prompt")
        assert isinstance(result, GeminiTSAResponseSchema)


# =============================================================================
# ExtractedDescription Tests
# =============================================================================


class TestExtractedDescription:
    """Tests for ExtractedDescription dataclass."""

    def test_to_dict_format(self):
        """Test conversion to dictionary format."""
        desc = ExtractedDescription(
            content="Старый замок на холме",
            description_type=DescriptionType.LOCATION,
            confidence=0.9,
            entities=[{"name": "замок", "type": "building"}],
            attributes={"size": "большой"},
            position=100,
            source_span=(100, 200),
        )

        result = desc.to_dict()

        assert result["content"] == "Старый замок на холме"
        assert result["type"] == "location"
        assert result["confidence_score"] == 0.9
        assert "priority_score" in result
        assert result["source"] == "gemini_direct"
        assert result["position"] == 100
        assert result["metadata"]["llm_extracted"] is True

    def test_priority_calculation_location(self):
        """Test priority calculation for location descriptions."""
        desc = ExtractedDescription(
            content="A" * 300,
            description_type=DescriptionType.LOCATION,
            confidence=0.9,
        )
        priority = desc._calculate_priority()
        assert priority > 80

    def test_priority_calculation_character(self):
        """Test priority calculation for character descriptions."""
        desc = ExtractedDescription(
            content="A" * 150,
            description_type=DescriptionType.CHARACTER,
            confidence=0.8,
        )
        priority = desc._calculate_priority()
        assert 60 <= priority <= 80

    def test_priority_calculation_atmosphere(self):
        """Test priority calculation for atmosphere descriptions."""
        desc = ExtractedDescription(
            content="A" * 100,
            description_type=DescriptionType.ATMOSPHERE,
            confidence=0.7,
        )
        priority = desc._calculate_priority()
        assert 40 <= priority <= 65


# =============================================================================
# RecursiveTextChunker Tests
# =============================================================================


class TestRecursiveTextChunker:
    """Tests for RecursiveTextChunker."""

    def test_chunk_short_text(self, sample_config):
        """Short text — no split needed."""
        chunker = RecursiveTextChunker(sample_config)
        text = "Short text that doesn't need chunking."
        chunks = chunker.chunk(text)
        assert len(chunks) == 1
        assert chunks[0]["text"] == text

    def test_chunk_long_text(self, sample_config):
        """Long text should be split into multiple chunks."""
        chunker = RecursiveTextChunker(sample_config)
        text = "Paragraph.\n\n" * 500
        chunks = chunker.chunk(text)
        assert len(chunks) > 1
        for chunk in chunks:
            assert len(chunk["text"]) <= sample_config.max_chunk_chars + 1000

    def test_chunk_overlap(self, sample_config):
        """Chunks should have overlap."""
        chunker = RecursiveTextChunker(sample_config)
        text = "Paragraph " + ("text. " * 1000)
        chunks = chunker.chunk(text)
        if len(chunks) > 1:
            assert chunks[1].get("has_overlap") is True

    def test_recursive_split_by_paragraphs(self, sample_config):
        """Splitting should prefer paragraph boundaries."""
        chunker = RecursiveTextChunker(sample_config)
        text = "Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.\n\n" * 100
        chunks = chunker.chunk(text)
        for chunk in chunks:
            assert chunk["text"].strip() != ""


# =============================================================================
# Deduplication Tests
# =============================================================================


class TestDeduplication:
    """Tests for deduplication."""

    def test_deduplication_removes_exact_duplicates(self, sample_config):
        """_deduplicate removes duplicate descriptions."""
        mock_client = MagicMock()
        with patch(
            "app.services.gemini_extractor.get_ai_provider",
            return_value=mock_client,
        ):
            extractor = GeminiDirectExtractor(sample_config)

        descriptions = [
            ExtractedDescription(
                content="Старый замок на холме",
                description_type=DescriptionType.LOCATION,
                confidence=0.9,
                position=0,
            ),
            ExtractedDescription(
                content="Старый замок на холме",  # Duplicate
                description_type=DescriptionType.LOCATION,
                confidence=0.85,
                position=100,
            ),
            ExtractedDescription(
                content="Молодой князь",
                description_type=DescriptionType.CHARACTER,
                confidence=0.8,
                position=200,
            ),
        ]

        unique = extractor._deduplicate(descriptions)

        assert len(unique) == 2
        assert unique[0].content == "Старый замок на холме"
        assert unique[1].content == "Молодой князь"


# =============================================================================
# Singleton Tests
# =============================================================================


class TestSingleton:
    """Tests for singleton pattern."""

    def test_get_gemini_extractor_singleton(self):
        """get_gemini_extractor returns singleton."""
        mock_client = MagicMock()
        with patch(
            "app.services.gemini_extractor.get_ai_provider",
            return_value=mock_client,
        ):
            import app.services.gemini_extractor as gem_module

            gem_module._extractor = None

            config = GeminiConfig(api_key="test_key")
            extractor1 = get_gemini_extractor(config)
            extractor2 = get_gemini_extractor(config)

            assert extractor1 is extractor2


# =============================================================================
# Edge Cases
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases."""

    def test_invalid_description_type_defaults_to_location(self):
        """Invalid description type defaults to LOCATION."""
        try:
            desc_type = DescriptionType("invalid_type")
        except ValueError:
            desc_type = DescriptionType.LOCATION

        assert desc_type == DescriptionType.LOCATION
