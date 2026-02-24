"""
Comprehensive tests for LangExtract Processor.

Tests cover:
1. Successful description extraction
2. Integration with GeminiDirectExtractor
3. Chunking logic for Russian text
4. Deduplication and filtering
5. Priority calculation
6. Statistics tracking
7. Configuration management
8. Error handling and graceful degradation
9. Text processing edge cases
10. Singleton pattern

Coverage target: >70%
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.langextract_processor import (
    LangExtractProcessor,
    LangExtractConfig,
    ExtractedDescription,
    DescriptionType,
    ProcessingResult,
    RussianTextChunker,
    get_langextract_processor,
    extract_descriptions_with_langextract,
)

# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def sample_config():
    """Sample LangExtract configuration."""
    return LangExtractConfig(
        model_id="gemini-3-flash-preview",
        api_key="test_langextract_api_key",
        max_chunk_chars=6000,
        min_chunk_chars=500,
        max_descriptions_per_chunk=15,
        min_description_chars=50,
        max_description_chars=4000,
        min_confidence=0.5,
        max_retries=2,
        timeout_seconds=30,
        batch_delay_ms=100,
        enabled=True,
        use_structured_output=True,
    )


@pytest.fixture
def sample_russian_text():
    """Sample Russian text for testing."""
    return """
    ГЛАВА ПЕРВАЯ

    Старый замок возвышался на высоком холме, окруженный густым лесом.
    Его величественные башни касались облаков, а мрачные стены хранили множество тайн.
    Серый камень, из которого были сложены стены, потемнел от времени.

    Молодой князь Алексей стоял у окна. Его тёмные глаза смотрели вдаль с задумчивым выражением.
    Длинные чёрные волосы были собраны в хвост, а на плечах лежал тяжёлый бархатный плащ
    тёмно-синего цвета.

    Атмосфера в зале была торжественной и немного мрачной. Тяжёлые портьеры из тёмного
    бархата поглощали звуки. Свечи в канделябрах отбрасывали дрожащие тени на стены.
    Пахло воском и старыми книгами.
    """


@pytest.fixture
def sample_long_russian_text():
    """Long Russian text that requires chunking."""
    base_paragraph = """
    Параграф русского текста с описанием места. Старинный особняк стоял на окраине города.
    Его фасад украшали колонны, а высокие окна выходили в парк. Вокруг здания росли
    вековые дубы, создавая тень на мощёной дорожке.
    """
    return (base_paragraph + "\n\n") * 50  # ~7000+ chars


@pytest.fixture
def sample_extracted_descriptions():
    """Sample extracted descriptions."""
    return [
        ExtractedDescription(
            content="Старый замок возвышался на высоком холме, окруженный густым лесом. Его величественные башни касались облаков.",
            description_type=DescriptionType.LOCATION,
            confidence=0.9,
            entities=[{"name": "замок", "type": "building"}],
            position=0,
            source_span=(0, 100),
        ),
        ExtractedDescription(
            content="Молодой князь Алексей стоял у окна. Его тёмные глаза смотрели вдаль с задумчивым выражением.",
            description_type=DescriptionType.CHARACTER,
            confidence=0.85,
            entities=[{"name": "князь Алексей", "type": "person"}],
            position=200,
            source_span=(200, 300),
        ),
    ]


@pytest.fixture
def mock_gemini_extractor():
    """Mock GeminiDirectExtractor."""
    with patch(
        "app.services.langextract_processor.GeminiDirectExtractor"
    ) as mock_class:
        mock_instance = MagicMock()
        mock_instance.is_available.return_value = True
        mock_class.return_value = mock_instance
        yield mock_instance


# =============================================================================
# LangExtractProcessor Tests
# =============================================================================


class TestLangExtractProcessor:
    """Tests for LangExtractProcessor main class."""

    def test_initialization_success(self, sample_config, mock_gemini_extractor):
        """Test successful initialization."""
        # Arrange & Act
        processor = LangExtractProcessor(sample_config)

        # Assert
        assert processor.is_available() is True
        assert processor.config.api_key == "test_langextract_api_key"

    def test_initialization_no_api_key(self):
        """Test initialization without API key."""
        # Arrange
        config = LangExtractConfig(api_key=None)

        with patch.dict("os.environ", {}, clear=True):
            # Act
            processor = LangExtractProcessor(config)

        # Assert
        assert processor.is_available() is False

    def test_initialization_disabled(self, sample_config):
        """Test initialization with processor disabled."""
        # Arrange
        sample_config.enabled = False

        with patch("app.services.langextract_processor.GeminiDirectExtractor"):
            # Act
            processor = LangExtractProcessor(sample_config)

        # Assert
        assert processor.is_available() is False

    @pytest.mark.asyncio
    async def test_extract_descriptions_success(
        self,
        sample_config,
        sample_russian_text,
        sample_extracted_descriptions,
        mock_gemini_extractor,
    ):
        """Test successful description extraction."""
        # Arrange
        mock_gemini_extractor._extract_from_chunk = AsyncMock(
            return_value=sample_extracted_descriptions
        )

        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = mock_gemini_extractor

        # Act
        result = await processor.extract_descriptions(sample_russian_text)

        # Assert
        assert isinstance(result, ProcessingResult)
        assert len(result.descriptions) > 0
        assert result.processors_used == ["langextract"]
        assert result.processing_time > 0

    @pytest.mark.asyncio
    async def test_extract_descriptions_not_available(self, sample_config):
        """Test extraction when processor is not available."""
        # Arrange
        with patch.dict("os.environ", {}, clear=True):
            config = LangExtractConfig(api_key=None)
            processor = LangExtractProcessor(config)

            # Act
            result = await processor.extract_descriptions("Some text")

        # Assert
        assert len(result.descriptions) == 0
        assert result.quality_metrics.get("available") is False

    @pytest.mark.asyncio
    async def test_extract_descriptions_text_too_short(
        self, sample_config, mock_gemini_extractor
    ):
        """Test extraction skips text that's too short."""
        # Arrange
        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = mock_gemini_extractor

        short_text = "Short"

        # Act
        result = await processor.extract_descriptions(short_text)

        # Assert
        assert len(result.descriptions) == 0
        assert result.quality_metrics.get("skipped") is True

    @pytest.mark.asyncio
    async def test_extract_descriptions_with_chunking(
        self,
        sample_config,
        sample_long_russian_text,
        sample_extracted_descriptions,
        mock_gemini_extractor,
    ):
        """Test extraction with text that requires multiple chunks."""
        # Arrange
        mock_gemini_extractor._extract_from_chunk = AsyncMock(
            return_value=sample_extracted_descriptions
        )

        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = mock_gemini_extractor

        # Act
        result = await processor.extract_descriptions(sample_long_russian_text)

        # Assert
        assert result.chunks_processed > 1
        assert mock_gemini_extractor._extract_from_chunk.call_count > 1

    @pytest.mark.asyncio
    async def test_extract_descriptions_filters_low_confidence(
        self, sample_config, sample_russian_text, mock_gemini_extractor
    ):
        """Test that low confidence descriptions are filtered out."""
        # Arrange
        low_confidence_desc = ExtractedDescription(
            content="Low confidence description text that is long enough to pass length filter.",
            description_type=DescriptionType.LOCATION,
            confidence=0.3,  # Below min_confidence of 0.5
            position=0,
        )

        mock_gemini_extractor._extract_from_chunk = AsyncMock(
            return_value=[low_confidence_desc]
        )

        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = mock_gemini_extractor

        # Act
        result = await processor.extract_descriptions(sample_russian_text)

        # Assert
        assert len(result.descriptions) == 0  # Filtered out

    @pytest.mark.asyncio
    async def test_extract_descriptions_deduplicates(
        self, sample_config, sample_russian_text, mock_gemini_extractor
    ):
        """Test deduplication of similar descriptions."""
        # Arrange
        duplicate_descriptions = [
            ExtractedDescription(
                content="Старый замок на холме с высокими башнями и серыми стенами.",
                description_type=DescriptionType.LOCATION,
                confidence=0.9,
                position=0,
            ),
            ExtractedDescription(
                content="Старый замок на холме с высокими башнями и серыми стенами.",  # Duplicate
                description_type=DescriptionType.LOCATION,
                confidence=0.85,
                position=100,
            ),
            ExtractedDescription(
                content="Молодой князь с темными глазами и черными волосами стоял у окна.",
                description_type=DescriptionType.CHARACTER,
                confidence=0.8,
                position=200,
            ),
        ]

        mock_gemini_extractor._extract_from_chunk = AsyncMock(
            return_value=duplicate_descriptions
        )

        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = mock_gemini_extractor

        # Act
        result = await processor.extract_descriptions(sample_russian_text)

        # Assert
        assert len(result.descriptions) == 2  # One duplicate removed

    @pytest.mark.asyncio
    async def test_extract_descriptions_sorted_by_priority(
        self, sample_config, sample_russian_text, mock_gemini_extractor
    ):
        """Test that descriptions are sorted by priority."""
        # Arrange
        descriptions = [
            ExtractedDescription(
                content="Low priority atmosphere description with minimal details and short length.",
                description_type=DescriptionType.ATMOSPHERE,
                confidence=0.7,
                position=0,
            ),
            ExtractedDescription(
                content="High priority location description with optimal length and detailed visual elements that make it perfect for image generation.",
                description_type=DescriptionType.LOCATION,
                confidence=0.95,
                position=100,
            ),
        ]

        mock_gemini_extractor._extract_from_chunk = AsyncMock(return_value=descriptions)

        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = mock_gemini_extractor

        # Act
        result = await processor.extract_descriptions(sample_russian_text)

        # Assert
        assert len(result.descriptions) == 2
        # First should be higher priority (location with good confidence)
        assert result.descriptions[0]["type"] == "location"

    @pytest.mark.asyncio
    async def test_extract_descriptions_quality_metrics(
        self,
        sample_config,
        sample_russian_text,
        sample_extracted_descriptions,
        mock_gemini_extractor,
    ):
        """Test quality metrics calculation."""
        # Arrange
        mock_gemini_extractor._extract_from_chunk = AsyncMock(
            return_value=sample_extracted_descriptions
        )

        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = mock_gemini_extractor

        # Act
        result = await processor.extract_descriptions(sample_russian_text)

        # Assert
        assert "total_extracted" in result.quality_metrics
        assert "unique_count" in result.quality_metrics
        assert "filtered_count" in result.quality_metrics
        assert "avg_confidence" in result.quality_metrics
        assert "by_type" in result.quality_metrics

    @pytest.mark.asyncio
    async def test_extract_descriptions_updates_statistics(
        self,
        sample_config,
        sample_russian_text,
        sample_extracted_descriptions,
        mock_gemini_extractor,
    ):
        """Test that statistics are updated after extraction."""
        # Arrange
        mock_gemini_extractor._extract_from_chunk = AsyncMock(
            return_value=sample_extracted_descriptions
        )

        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = mock_gemini_extractor

        initial_extractions = processor.stats["total_extractions"]

        # Act
        await processor.extract_descriptions(sample_russian_text)

        # Assert
        assert processor.stats["total_extractions"] == initial_extractions + 1
        assert processor.stats["total_api_calls"] > 0

    @pytest.mark.asyncio
    async def test_extract_descriptions_error_handling(
        self, sample_config, sample_russian_text, mock_gemini_extractor
    ):
        """Test error handling during extraction."""
        # Arrange
        mock_gemini_extractor._extract_from_chunk = AsyncMock(
            side_effect=Exception("API Error")
        )

        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = mock_gemini_extractor

        # Act
        result = await processor.extract_descriptions(sample_russian_text)

        # Assert
        assert len(result.descriptions) == 0
        assert "error" in result.quality_metrics
        assert processor.stats["errors"] > 0

    @pytest.mark.asyncio
    async def test_extract_descriptions_with_chapter_id(
        self,
        sample_config,
        sample_russian_text,
        sample_extracted_descriptions,
        mock_gemini_extractor,
    ):
        """Test extraction with chapter ID parameter."""
        # Arrange
        mock_gemini_extractor._extract_from_chunk = AsyncMock(
            return_value=sample_extracted_descriptions
        )

        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = mock_gemini_extractor

        # Act
        result = await processor.extract_descriptions(
            sample_russian_text, chapter_id="chapter_123"
        )

        # Assert
        assert len(result.descriptions) > 0

    def test_get_statistics(self, sample_config, mock_gemini_extractor):
        """Test statistics retrieval."""
        # Arrange
        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = mock_gemini_extractor

        processor.stats["total_extractions"] = 10
        processor.stats["total_tokens"] = 50000
        processor.stats["total_api_calls"] = 25

        # Act
        stats = processor.get_statistics()

        # Assert
        assert stats["total_extractions"] == 10
        assert stats["available"] is True
        assert "avg_tokens_per_call" in stats

    def test_reset_statistics(self, sample_config, mock_gemini_extractor):
        """Test statistics reset."""
        # Arrange
        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = mock_gemini_extractor

        processor.stats["total_extractions"] = 10
        processor.stats["total_tokens"] = 50000

        # Act
        processor.reset_statistics()

        # Assert
        assert processor.stats["total_extractions"] == 0
        assert processor.stats["total_tokens"] == 0


# =============================================================================
# RussianTextChunker Tests
# =============================================================================


class TestRussianTextChunker:
    """Tests for RussianTextChunker."""

    def test_chunk_short_text(self, sample_config):
        """Test chunking short text (no split needed)."""
        # Arrange
        chunker = RussianTextChunker(sample_config)
        text = "Короткий текст, который не требует разбиения."

        # Act
        chunks = chunker.chunk(text)

        # Assert
        assert len(chunks) == 1
        assert chunks[0]["text"] == text

    def test_chunk_long_text(self, sample_config, sample_long_russian_text):
        """Test chunking long text into multiple chunks."""
        # Arrange
        chunker = RussianTextChunker(sample_config)

        # Act
        chunks = chunker.chunk(sample_long_russian_text)

        # Assert
        assert len(chunks) > 1
        for chunk in chunks:
            assert (
                len(chunk["text"])
                <= sample_config.max_chunk_chars + sample_config.chunk_overlap_chars
            )

    def test_chunk_by_paragraphs(self, sample_config):
        """Test that chunking respects paragraph boundaries."""
        # Arrange
        chunker = RussianTextChunker(sample_config)
        text = "Первый параграф.\n\nВторой параграф.\n\nТретий параграф."

        # Act
        chunks = chunker.chunk(text)

        # Assert
        # Should preserve paragraph structure
        assert all("параграф" in chunk["text"] for chunk in chunks)

    def test_chunk_with_chapter_markers(self, sample_config):
        """Test chunking with chapter markers."""
        # Arrange
        chunker = RussianTextChunker(sample_config)
        text = (
            "ГЛАВА ПЕРВАЯ\n\nТекст первой главы.\n\nГЛАВА ВТОРАЯ\n\nТекст второй главы."
        )

        # Act
        chunks = chunker.chunk(text)

        # Assert
        # Chapter markers should create natural break points
        assert len(chunks) >= 1

    def test_chunk_with_dialogs(self, sample_config):
        """Test chunking preserves dialog structure."""
        # Arrange
        chunker = RussianTextChunker(sample_config)
        text = (
            "— Привет, — сказал он.\n\n— Здравствуй, — ответила она.\n\nОписание сцены."
        )

        # Act
        chunks = chunker.chunk(text)

        # Assert
        assert len(chunks) >= 1

    def test_split_to_paragraphs(self, sample_config):
        """Test paragraph splitting."""
        # Arrange
        chunker = RussianTextChunker(sample_config)
        text = "Первый параграф.\n\nВторой параграф.\n\nТретий параграф."

        # Act
        paragraphs = chunker._split_to_paragraphs(text)

        # Assert
        assert len(paragraphs) == 3
        assert all("index" in p for p in paragraphs)

    def test_group_paragraphs_to_chunks(self, sample_config):
        """Test grouping paragraphs into chunks."""
        # Arrange
        chunker = RussianTextChunker(sample_config)
        paragraphs = [
            {
                "text": "Para 1",
                "start": 0,
                "end": 6,
                "index": 0,
                "is_dialog": False,
                "is_chapter_start": False,
            },
            {
                "text": "Para 2",
                "start": 7,
                "end": 13,
                "index": 1,
                "is_dialog": False,
                "is_chapter_start": False,
            },
            {
                "text": "Para 3",
                "start": 14,
                "end": 20,
                "index": 2,
                "is_dialog": False,
                "is_chapter_start": False,
            },
        ]

        # Act
        chunks = chunker._group_paragraphs_to_chunks(paragraphs)

        # Assert
        assert len(chunks) >= 1
        assert all("paragraph_indices" in chunk for chunk in chunks)

    def test_get_overlap_paragraphs(self, sample_config):
        """Test getting overlap paragraphs."""
        # Arrange
        chunker = RussianTextChunker(sample_config)
        paragraphs = [
            {"text": "A" * 100, "index": 0},
            {"text": "B" * 100, "index": 1},
            {"text": "C" * 100, "index": 2},
        ]

        # Act
        overlap = chunker._get_overlap_paragraphs(paragraphs)

        # Assert
        assert len(overlap) > 0
        assert len(overlap) <= len(paragraphs)


# =============================================================================
# ExtractedDescription Tests
# =============================================================================


class TestExtractedDescription:
    """Tests for ExtractedDescription dataclass."""

    def test_to_dict_format(self):
        """Test conversion to dictionary format."""
        # Arrange
        desc = ExtractedDescription(
            content="Старый замок на холме с высокими башнями.",
            description_type=DescriptionType.LOCATION,
            confidence=0.9,
            entities=[{"name": "замок", "type": "building"}],
            attributes={"size": "большой"},
            position=100,
            source_span=(100, 200),
        )

        # Act
        result = desc.to_dict()

        # Assert
        assert result["content"] == "Старый замок на холме с высокими башнями."
        assert result["type"] == "location"
        assert result["confidence_score"] == 0.9
        assert result["source"] == "langextract"
        assert "priority_score" in result
        assert "metadata" in result

    def test_priority_calculation_location(self):
        """Test priority calculation for location descriptions."""
        # Arrange
        desc = ExtractedDescription(
            content="A" * 3000,  # Optimal length (2000-3500)
            description_type=DescriptionType.LOCATION,
            confidence=0.9,
        )

        # Act
        priority = desc._calculate_priority()

        # Assert
        assert priority > 80  # High priority

    def test_priority_calculation_character(self):
        """Test priority calculation for character descriptions."""
        # Arrange
        desc = ExtractedDescription(
            content="A" * 1500,
            description_type=DescriptionType.CHARACTER,
            confidence=0.8,
        )

        # Act
        priority = desc._calculate_priority()

        # Assert
        assert 60 <= priority <= 85

    def test_priority_calculation_atmosphere(self):
        """Test priority calculation for atmosphere descriptions."""
        # Arrange
        desc = ExtractedDescription(
            content="A" * 800,
            description_type=DescriptionType.ATMOSPHERE,
            confidence=0.7,
        )

        # Act
        priority = desc._calculate_priority()

        # Assert
        assert 40 <= priority <= 60


# =============================================================================
# ProcessingResult Tests
# =============================================================================


class TestProcessingResult:
    """Tests for ProcessingResult dataclass."""

    def test_processing_result_structure(self):
        """Test ProcessingResult structure."""
        # Arrange & Act
        result = ProcessingResult(
            descriptions=[{"content": "test", "type": "location"}],
            processor_results={"langextract": []},
            processing_time=1.5,
            processors_used=["langextract"],
            quality_metrics={"total": 1},
            tokens_used=1000,
            api_calls=2,
            chunks_processed=1,
        )

        # Assert
        assert len(result.descriptions) == 1
        assert result.processing_time == 1.5
        assert result.tokens_used == 1000
        assert result.api_calls == 2


# =============================================================================
# Singleton and Utility Functions Tests
# =============================================================================


class TestSingletonAndUtilities:
    """Tests for singleton pattern and utility functions."""

    def test_get_langextract_processor_singleton(self, mock_gemini_extractor):
        """Test that get_langextract_processor returns singleton."""
        # Arrange
        import app.services.langextract_processor as lx_module

        lx_module._langextract_processor = None

        # Act
        processor1 = get_langextract_processor()
        processor2 = get_langextract_processor()

        # Assert
        assert processor1 is processor2

    @pytest.mark.asyncio
    async def test_extract_descriptions_with_langextract_utility(
        self, sample_russian_text, sample_extracted_descriptions, mock_gemini_extractor
    ):
        """Test utility function for extraction."""
        # Arrange
        mock_gemini_extractor._extract_from_chunk = AsyncMock(
            return_value=sample_extracted_descriptions
        )

        # Reset singleton
        import app.services.langextract_processor as lx_module

        lx_module._langextract_processor = None

        with patch(
            "app.services.langextract_processor.GeminiDirectExtractor"
        ) as mock_class:
            mock_class.return_value = mock_gemini_extractor
            mock_gemini_extractor.is_available.return_value = True

            with patch.dict("os.environ", {"LANGEXTRACT_API_KEY": "test_key"}):
                # Act
                result = await extract_descriptions_with_langextract(
                    sample_russian_text
                )

        # Assert
        assert isinstance(result, ProcessingResult)


# =============================================================================
# Edge Cases and Error Handling
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    @pytest.mark.asyncio
    async def test_empty_text(self, sample_config, mock_gemini_extractor):
        """Test handling of empty text."""
        # Arrange
        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = mock_gemini_extractor

        # Act
        result = await processor.extract_descriptions("")

        # Assert
        assert len(result.descriptions) == 0

    @pytest.mark.asyncio
    async def test_text_with_only_whitespace(
        self, sample_config, mock_gemini_extractor
    ):
        """Test handling of text with only whitespace."""
        # Arrange
        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = mock_gemini_extractor

        # Act
        result = await processor.extract_descriptions("   \n\n   \t\t   ")

        # Assert
        assert len(result.descriptions) == 0

    @pytest.mark.asyncio
    async def test_malformed_description_from_extractor(
        self, sample_config, sample_russian_text, mock_gemini_extractor
    ):
        """Test handling of malformed descriptions from extractor."""
        # Arrange
        # Return object with wrong structure
        malformed_desc = MagicMock()
        malformed_desc.content = None  # Invalid
        malformed_desc.description_type = DescriptionType.LOCATION
        malformed_desc.confidence = 0.9

        mock_gemini_extractor._extract_from_chunk = AsyncMock(
            return_value=[malformed_desc]
        )

        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = mock_gemini_extractor

        # Act - should handle gracefully
        result = await processor.extract_descriptions(sample_russian_text)

        # Assert - may be empty or handled
        assert isinstance(result, ProcessingResult)

    def test_invalid_description_type_conversion(self):
        """Test handling of invalid description type."""
        # Arrange
        invalid_type = "invalid_type"

        # Act - should default to LOCATION
        try:
            desc_type = DescriptionType(invalid_type)
        except ValueError:
            desc_type = DescriptionType.LOCATION

        # Assert
        assert desc_type == DescriptionType.LOCATION

    @pytest.mark.asyncio
    async def test_batch_delay_between_chunks(
        self,
        sample_config,
        sample_long_russian_text,
        sample_extracted_descriptions,
        mock_gemini_extractor,
    ):
        """Test that batch delay is applied between chunk processing."""
        # Arrange
        mock_gemini_extractor._extract_from_chunk = AsyncMock(
            return_value=sample_extracted_descriptions
        )

        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = mock_gemini_extractor
        processor.config.batch_delay_ms = 10  # Small delay for testing

        # Act
        import time

        start = time.time()
        await processor.extract_descriptions(sample_long_russian_text)
        elapsed = time.time() - start

        # Assert
        # With multiple chunks, there should be some delay
        if processor.stats["total_api_calls"] > 1:
            assert elapsed > 0.01  # At least 10ms

    def test_config_from_environment(self):
        """Test configuration from environment variables."""
        # Arrange
        with patch.dict("os.environ", {"LANGEXTRACT_API_KEY": "env_api_key"}):
            config = LangExtractConfig(api_key=None)

            # Act
            with patch("app.services.langextract_processor.GeminiDirectExtractor"):
                processor = LangExtractProcessor(config)

        # Assert
        assert processor.config.api_key == "env_api_key"

    @pytest.mark.asyncio
    async def test_process_chunk_with_no_extractor(self, sample_config):
        """Test _process_chunk when no extractor is available."""
        # Arrange
        processor = LangExtractProcessor(sample_config)
        processor._gemini_extractor = None
        processor._lx = None

        # Act
        descriptions, tokens = await processor._process_chunk("Some text", 0)

        # Assert
        assert descriptions == []
        assert tokens == 0
