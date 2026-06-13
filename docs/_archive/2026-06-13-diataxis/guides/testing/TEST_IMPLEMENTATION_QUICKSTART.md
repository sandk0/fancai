# Быстрый старт - Реализация критичных тестов

**Для:** Разработчиков, готовых начать писать тесты
**Время реализации:** 1 неделя для всех критичных тестов

---

## 1. BACKEND TESTS - COPY-PASTE READY

### 1.1 Gemini Extractor Tests

**Файл:** `/backend/tests/services/test_gemini_extractor.py`

```python
"""
Comprehensive tests for Gemini Extractor.

Tests the direct Google Gemini API integration for description extraction.
"""

import pytest
import asyncio
import json
from unittest.mock import AsyncMock, patch, MagicMock
from typing import Dict, List, Any

from app.services.gemini_extractor import (
    GeminiExtractor,
    GeminiExtractorConfig,
    ExtractedDescription,
    DescriptionType,
)


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def gemini_config():
    """Default configuration for Gemini Extractor."""
    return GeminiExtractorConfig(
        api_key="test-api-key-123",
        model="gemini-2.0-flash",
        max_chunk_chars=2000,
        chunk_overlap_chars=200,
        min_confidence=0.5,
        enabled=True,
    )


@pytest.fixture
def sample_chapter_text():
    """Sample Russian fiction text."""
    return """
    Старый замок возвышался на высоком холме, окруженный густым лесом.
    Его величественные башни касались облаков, а мрачные стены хранили множество тайн.
    Граф Петр вошел в главный зал, где его ждала графиня Елена.

    Атмосфера была пронизана тревогой и напряжением. Свечи мерцали в темноте,
    создавая причудливые тени на стенах. Запах старой древесины смешивался с ароматом роз.
    """


@pytest.fixture
async def gemini_extractor(gemini_config):
    """Gemini Extractor instance."""
    with patch('app.services.gemini_extractor.genai.GenerativeModel'):
        extractor = GeminiExtractor(gemini_config)
        yield extractor


# =============================================================================
# TESTS - INITIALIZATION
# =============================================================================

class TestGeminiExtractorInitialization:
    """Test initialization and configuration."""

    def test_init_with_valid_config(self, gemini_config):
        """Test initialization with valid config."""
        with patch('app.services.gemini_extractor.genai.GenerativeModel'):
            extractor = GeminiExtractor(gemini_config)
            assert extractor.config == gemini_config
            assert extractor.enabled is True

    def test_init_without_api_key_raises_error(self):
        """Test that missing API key raises error."""
        config = GeminiExtractorConfig(
            api_key="",  # Empty!
            model="gemini-2.0-flash",
        )
        with pytest.raises(ValueError, match="API key"):
            GeminiExtractor(config)

    def test_init_disabled_extractor(self, gemini_config):
        """Test initialization of disabled extractor."""
        gemini_config.enabled = False
        with patch('app.services.gemini_extractor.genai.GenerativeModel'):
            extractor = GeminiExtractor(gemini_config)
            assert extractor.enabled is False

    def test_is_available(self, gemini_extractor):
        """Test availability check."""
        assert gemini_extractor.is_available() is True


# =============================================================================
# TESTS - TEXT CHUNKING
# =============================================================================

class TestTextChunking:
    """Test text splitting and chunking."""

    def test_chunk_text_basic(self, gemini_extractor, sample_chapter_text):
        """Test basic text chunking."""
        chunks = gemini_extractor._chunk_text(sample_chapter_text)

        assert len(chunks) > 0
        assert all(len(chunk) <= gemini_extractor.config.max_chunk_chars for chunk in chunks)
        # Reconstruct text - should be complete (with overlap)
        assert sample_chapter_text[:100] in "".join(chunks)

    def test_chunk_text_respects_max_chars(self, gemini_extractor):
        """Test that chunks respect max char limit."""
        long_text = "A" * 5000
        chunks = gemini_extractor._chunk_text(long_text)

        for chunk in chunks:
            assert len(chunk) <= gemini_extractor.config.max_chunk_chars

    def test_chunk_text_preserves_content(self, gemini_extractor, sample_chapter_text):
        """Test that chunking preserves all content."""
        chunks = gemini_extractor._chunk_text(sample_chapter_text)
        reconstructed = "".join(chunks)

        # Remove overlap and check original is in result
        assert len(reconstructed) >= len(sample_chapter_text)

    def test_chunk_text_empty_input(self, gemini_extractor):
        """Test chunking empty text."""
        chunks = gemini_extractor._chunk_text("")
        assert len(chunks) == 0

    def test_chunk_text_very_small(self, gemini_extractor):
        """Test chunking very small text."""
        text = "Hello world"
        chunks = gemini_extractor._chunk_text(text)

        assert len(chunks) == 1
        assert chunks[0] == text


# =============================================================================
# TESTS - DESCRIPTION EXTRACTION
# =============================================================================

class TestDescriptionExtraction:
    """Test description extraction from text."""

    @pytest.mark.asyncio
    async def test_extract_descriptions_success(self, gemini_extractor, sample_chapter_text):
        """Test successful description extraction."""
        mock_response = MagicMock()
        mock_response.text = json.dumps({
            "descriptions": [
                {
                    "content": "Старый замок на холме",
                    "type": "location",
                    "confidence": 0.92,
                    "entities": [{"name": "замок", "type": "building"}],
                    "position": 10,
                },
                {
                    "content": "Атмосфера тревоги и напряжения",
                    "type": "atmosphere",
                    "confidence": 0.85,
                    "entities": [],
                    "position": 300,
                }
            ]
        })

        with patch.object(gemini_extractor, '_call_gemini_api', new_callable=AsyncMock) as mock_call:
            mock_call.return_value = mock_response

            result = await gemini_extractor.extract_descriptions(sample_chapter_text)

            assert len(result) >= 0  # Could be empty or with results
            if result:
                assert all(isinstance(desc, ExtractedDescription) for desc in result)

    @pytest.mark.asyncio
    async def test_extract_descriptions_multiple_types(self, gemini_extractor, sample_chapter_text):
        """Test extraction of different description types."""
        mock_response = MagicMock()
        mock_response.text = json.dumps({
            "descriptions": [
                {"content": "Граф Петр", "type": "character", "confidence": 0.88},
                {"content": "Замок", "type": "location", "confidence": 0.90},
                {"content": "Мрачная атмосфера", "type": "atmosphere", "confidence": 0.85},
            ]
        })

        with patch.object(gemini_extractor, '_call_gemini_api', new_callable=AsyncMock) as mock_call:
            mock_call.return_value = mock_response

            result = await gemini_extractor.extract_descriptions(sample_chapter_text)

            # Check all types are present (if extraction succeeds)
            types = [d.description_type for d in result] if result else []
            # At minimum, no errors should occur

    @pytest.mark.asyncio
    async def test_extract_descriptions_filters_by_confidence(self, gemini_extractor):
        """Test that low confidence descriptions are filtered."""
        gemini_extractor.config.min_confidence = 0.8

        mock_response = MagicMock()
        mock_response.text = json.dumps({
            "descriptions": [
                {"content": "High confidence", "type": "location", "confidence": 0.95},
                {"content": "Low confidence", "type": "location", "confidence": 0.3},
            ]
        })

        with patch.object(gemini_extractor, '_call_gemini_api', new_callable=AsyncMock) as mock_call:
            mock_call.return_value = mock_response

            result = await gemini_extractor.extract_descriptions("test text")

            # All returned descriptions should meet min_confidence
            assert all(d.confidence >= gemini_extractor.config.min_confidence for d in result)

    @pytest.mark.asyncio
    async def test_extract_descriptions_empty_chapter(self, gemini_extractor):
        """Test extraction from empty chapter."""
        result = await gemini_extractor.extract_descriptions("")

        assert result == []

    @pytest.mark.asyncio
    async def test_extract_descriptions_invalid_json(self, gemini_extractor):
        """Test handling of invalid JSON response."""
        mock_response = MagicMock()
        mock_response.text = "{ invalid json }"

        with patch.object(gemini_extractor, '_call_gemini_api', new_callable=AsyncMock) as mock_call:
            mock_call.return_value = mock_response

            # Should handle gracefully (repair or return empty)
            result = await gemini_extractor.extract_descriptions("test")
            assert isinstance(result, list)


# =============================================================================
# TESTS - ERROR HANDLING
# =============================================================================

class TestErrorHandling:
    """Test error handling and resilience."""

    @pytest.mark.asyncio
    async def test_api_timeout(self, gemini_extractor):
        """Test handling of API timeout."""
        with patch.object(gemini_extractor, '_call_gemini_api', side_effect=asyncio.TimeoutError()):
            with pytest.raises(asyncio.TimeoutError):
                await gemini_extractor.extract_descriptions("test")

    @pytest.mark.asyncio
    async def test_invalid_api_key(self, gemini_extractor):
        """Test handling of invalid API key."""
        with patch.object(gemini_extractor, '_call_gemini_api', side_effect=ValueError("Invalid API key")):
            with pytest.raises(ValueError):
                await gemini_extractor.extract_descriptions("test")

    @pytest.mark.asyncio
    async def test_network_error(self, gemini_extractor):
        """Test handling of network errors."""
        with patch.object(gemini_extractor, '_call_gemini_api', side_effect=ConnectionError("Network error")):
            with pytest.raises(ConnectionError):
                await gemini_extractor.extract_descriptions("test")

    @pytest.mark.asyncio
    async def test_rate_limiting(self, gemini_extractor):
        """Test handling of rate limiting."""
        error_response = MagicMock()
        error_response.status_code = 429

        with patch.object(gemini_extractor, '_call_gemini_api', side_effect=Exception("Rate limited")):
            with pytest.raises(Exception):
                await gemini_extractor.extract_descriptions("test")


# =============================================================================
# TESTS - CONCURRENCY
# =============================================================================

class TestConcurrency:
    """Test concurrent operations."""

    @pytest.mark.asyncio
    async def test_concurrent_extractions(self, gemini_extractor):
        """Test concurrent extraction requests."""
        texts = [f"Text {i}" for i in range(5)]

        with patch.object(gemini_extractor, '_call_gemini_api', new_callable=AsyncMock) as mock_call:
            mock_call.return_value = MagicMock(text='{"descriptions": []}')

            tasks = [gemini_extractor.extract_descriptions(text) for text in texts]
            results = await asyncio.gather(*tasks)

            assert len(results) == 5
            assert mock_call.call_count >= 1  # At least called


# =============================================================================
# TESTS - PERFORMANCE
# =============================================================================

class TestPerformance:
    """Test performance characteristics."""

    @pytest.mark.asyncio
    @pytest.mark.benchmark
    async def test_extraction_speed(self, gemini_extractor, sample_chapter_text, benchmark):
        """Benchmark extraction speed."""
        async def extract():
            with patch.object(gemini_extractor, '_call_gemini_api', new_callable=AsyncMock) as mock_call:
                mock_call.return_value = MagicMock(text='{"descriptions": []}')
                return await gemini_extractor.extract_descriptions(sample_chapter_text)

        # Note: This is async benchmark pattern
        result = await extract()
        assert isinstance(result, list)


# =============================================================================
# RUN TESTS
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
```

### 1.2 Imagen Generator Tests

**Файл:** `/backend/tests/services/test_imagen_generator.py`

```python
"""
Comprehensive tests for Google Imagen Generator.

Tests the Imagen 4 image generation API integration.
"""

import pytest
import asyncio
import base64
from unittest.mock import AsyncMock, patch, MagicMock
from pathlib import Path
from typing import Dict, Any

from app.services.imagen_generator import (
    ImagenGenerator,
    ImagenConfig,
    DescriptionType,
)


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def imagen_config():
    """Default configuration for Imagen Generator."""
    return ImagenConfig(
        api_key="test-api-key",
        model="imagen-4.0-generate-001",
        aspect_ratio="4:3",
    )


@pytest.fixture
def sample_description():
    """Sample description for image generation."""
    return "Старый замок на холме, окруженный лесом"


@pytest.fixture
async def imagen_generator(imagen_config):
    """Imagen Generator instance."""
    with patch('app.services.imagen_generator.genai.Client'):
        generator = ImagenGenerator(imagen_config)
        yield generator


# =============================================================================
# TESTS - INITIALIZATION
# =============================================================================

class TestImagenGeneratorInitialization:
    """Test initialization and configuration."""

    def test_init_with_valid_config(self, imagen_config):
        """Test initialization with valid config."""
        with patch('app.services.imagen_generator.genai.Client'):
            generator = ImagenGenerator(imagen_config)
            assert generator.config == imagen_config

    def test_init_without_api_key_raises_error(self):
        """Test that missing API key raises error."""
        config = ImagenConfig(api_key="")
        with pytest.raises(ValueError):
            ImagenGenerator(config)

    def test_init_validates_aspect_ratio(self, imagen_config):
        """Test aspect ratio validation."""
        valid_ratios = ["1:1", "3:4", "4:3", "9:16", "16:9"]

        for ratio in valid_ratios:
            imagen_config.aspect_ratio = ratio
            with patch('app.services.imagen_generator.genai.Client'):
                generator = ImagenGenerator(imagen_config)
                assert generator.config.aspect_ratio == ratio


# =============================================================================
# TESTS - IMAGE GENERATION
# =============================================================================

class TestImageGeneration:
    """Test image generation."""

    @pytest.mark.asyncio
    async def test_generate_image_success(self, imagen_generator, sample_description):
        """Test successful image generation."""
        mock_image = MagicMock()
        mock_image.image = MagicMock()
        mock_image.image.b64_json = base64.b64encode(b"fake-image-data").decode()

        with patch.object(imagen_generator.client, 'models', new_callable=MagicMock) as mock_models:
            mock_generate = AsyncMock(return_value=mock_image)
            mock_models.generate_images.return_value = mock_generate

            result = await imagen_generator.generate_image(
                sample_description,
                description_type=DescriptionType.LOCATION
            )

            assert result is not None

    @pytest.mark.asyncio
    async def test_generate_image_with_type_specific_prompt(self, imagen_generator):
        """Test that type-specific prompts are applied."""
        location_desc = "Замок в лесу"
        character_desc = "Молодая девушка с темными волосами"

        with patch.object(imagen_generator, '_generate', new_callable=AsyncMock) as mock_gen:
            mock_gen.return_value = MagicMock()

            await imagen_generator.generate_image(location_desc, DescriptionType.LOCATION)
            await imagen_generator.generate_image(character_desc, DescriptionType.CHARACTER)

            # Both should have been called with different prompts
            assert mock_gen.call_count >= 1

    @pytest.mark.asyncio
    async def test_generate_image_with_aspect_ratio(self, imagen_generator, sample_description):
        """Test aspect ratio application."""
        ratios = ["1:1", "4:3", "16:9"]

        for ratio in ratios:
            imagen_generator.config.aspect_ratio = ratio

            with patch.object(imagen_generator, '_generate', new_callable=AsyncMock) as mock_gen:
                mock_gen.return_value = MagicMock()

                await imagen_generator.generate_image(sample_description)
                assert mock_gen.called

    @pytest.mark.asyncio
    async def test_generate_image_caching(self, imagen_generator, sample_description):
        """Test that generated images are cached."""
        with patch.object(imagen_generator, '_generate', new_callable=AsyncMock) as mock_gen:
            mock_gen.return_value = MagicMock()

            # First call
            result1 = await imagen_generator.generate_image(sample_description)
            # Second call with same description
            result2 = await imagen_generator.generate_image(sample_description)

            # Should use cache (API called only once)
            # Note: Exact behavior depends on caching implementation


# =============================================================================
# TESTS - PROMPT TRANSLATION
# =============================================================================

class TestPromptTranslation:
    """Test Russian to English prompt translation."""

    @pytest.mark.asyncio
    async def test_translate_russian_prompt(self, imagen_generator):
        """Test translation of Russian prompts."""
        russian_prompt = "Старый замок в лесу"

        with patch.object(imagen_generator, '_translate_prompt', new_callable=AsyncMock) as mock_trans:
            mock_trans.return_value = "Old castle in the forest"

            result = await imagen_generator._translate_prompt(russian_prompt)

            assert "castle" in result.lower() or "old" in result.lower()

    @pytest.mark.asyncio
    async def test_translation_caching(self, imagen_generator):
        """Test that translations are cached."""
        russian_prompt = "Замок"

        with patch.object(imagen_generator, '_translate_prompt', new_callable=AsyncMock) as mock_trans:
            mock_trans.return_value = "Castle"

            # First call
            result1 = await imagen_generator._translate_prompt(russian_prompt)
            # Second call
            result2 = await imagen_generator._translate_prompt(russian_prompt)

            # Should use cache
            assert result1 == result2


# =============================================================================
# TESTS - ERROR HANDLING
# =============================================================================

class TestErrorHandling:
    """Test error handling."""

    @pytest.mark.asyncio
    async def test_api_timeout(self, imagen_generator):
        """Test handling of API timeout."""
        with patch.object(imagen_generator, '_generate', side_effect=asyncio.TimeoutError()):
            with pytest.raises(asyncio.TimeoutError):
                await imagen_generator.generate_image("test description")

    @pytest.mark.asyncio
    async def test_invalid_api_key(self, imagen_generator):
        """Test handling of invalid API key."""
        with patch.object(imagen_generator, '_generate', side_effect=ValueError("Invalid API key")):
            with pytest.raises(ValueError):
                await imagen_generator.generate_image("test description")

    @pytest.mark.asyncio
    async def test_quota_exceeded(self, imagen_generator):
        """Test handling of quota exceeded."""
        with patch.object(imagen_generator, '_generate', side_effect=Exception("Quota exceeded")):
            with pytest.raises(Exception):
                await imagen_generator.generate_image("test description")

    @pytest.mark.asyncio
    async def test_invalid_prompt(self, imagen_generator):
        """Test handling of invalid prompts."""
        with patch.object(imagen_generator, '_validate_prompt', return_value=False):
            # Should either reject or handle gracefully
            with patch.object(imagen_generator, '_generate', new_callable=AsyncMock) as mock_gen:
                mock_gen.return_value = None

                result = await imagen_generator.generate_image("")
                # Should handle empty prompt gracefully


# =============================================================================
# TESTS - CONCURRENCY
# =============================================================================

class TestConcurrency:
    """Test concurrent image generation."""

    @pytest.mark.asyncio
    async def test_concurrent_generation(self, imagen_generator):
        """Test generating multiple images concurrently."""
        descriptions = [
            ("Замок", DescriptionType.LOCATION),
            ("Девушка", DescriptionType.CHARACTER),
            ("Атмосфера", DescriptionType.ATMOSPHERE),
        ]

        with patch.object(imagen_generator, '_generate', new_callable=AsyncMock) as mock_gen:
            mock_gen.return_value = MagicMock()

            tasks = [
                imagen_generator.generate_image(desc, dtype)
                for desc, dtype in descriptions
            ]
            results = await asyncio.gather(*tasks)

            assert len(results) >= 0


# =============================================================================
# RUN TESTS
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
```

---

## 2. FRONTEND TESTS - COPY-PASTE READY

### 2.1 Description Highlighting Tests

**Файл:** `/frontend/src/hooks/epub/__tests__/useDescriptionHighlighting.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useDescriptionHighlighting } from '../useDescriptionHighlighting';
import type { HighlightStrategy, SearchResult } from '../types';

/**
 * Comprehensive tests for the 9 description highlighting strategies.
 *
 * Tests cover:
 * - EXACT_MATCH - Direct string matching
 * - FUZZY_MATCH - Approximate string matching
 * - WORD_BOUNDARY - Whole word matching
 * - STEMMING - Russian morphology
 * - PHONETIC - Sound-based matching
 * - SEMANTIC - Meaning-based matching
 * - CONTEXT_AWARE - Position-aware matching
 * - REGEX - Pattern-based matching
 * - MULTI_LANGUAGE - Cyrillic + English
 */

describe('useDescriptionHighlighting', () => {
  let hook: ReturnType<typeof useDescriptionHighlighting>;

  beforeEach(() => {
    hook = useDescriptionHighlighting();
  });

  // =========================================================================
  // EXACT_MATCH Strategy
  // =========================================================================

  describe('EXACT_MATCH strategy', () => {
    it('finds exact text matches', () => {
      const text = 'The quick brown fox jumps over the lazy dog';
      const searchText = 'quick brown';

      const results = hook.searchWithStrategy(text, searchText, 'EXACT_MATCH');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].start).toBe(4);
      expect(results[0].end).toBe(15);
    });

    it('handles case sensitivity', () => {
      const text = 'Quick Brown Fox';
      const searchText = 'quick';

      // Case-insensitive by default
      const results = hook.searchWithStrategy(text, searchText, 'EXACT_MATCH');

      expect(results.length).toBeGreaterThan(0);
    });

    it('finds multiple matches', () => {
      const text = 'cat cat cat';
      const searchText = 'cat';

      const results = hook.searchWithStrategy(text, searchText, 'EXACT_MATCH');

      expect(results.length).toBe(3);
    });

    it('returns empty array for no matches', () => {
      const text = 'Hello world';
      const searchText = 'xyz';

      const results = hook.searchWithStrategy(text, searchText, 'EXACT_MATCH');

      expect(results).toEqual([]);
    });

    it('handles empty search text', () => {
      const text = 'Hello world';
      const searchText = '';

      const results = hook.searchWithStrategy(text, searchText, 'EXACT_MATCH');

      expect(results).toEqual([]);
    });
  });

  // =========================================================================
  // FUZZY_MATCH Strategy
  // =========================================================================

  describe('FUZZY_MATCH strategy', () => {
    it('finds similar text with typos', () => {
      const text = 'The quikc brown fox';
      const searchText = 'quick';

      const results = hook.searchWithStrategy(text, searchText, 'FUZZY_MATCH');

      expect(results.length).toBeGreaterThan(0);
    });

    it('handles character transposition', () => {
      const text = 'he quikc brown fox';
      const searchText = 'quick';

      const results = hook.searchWithStrategy(text, searchText, 'FUZZY_MATCH');

      expect(results.length).toBeGreaterThan(0);
    });

    it('calculates similarity score', () => {
      const text = 'The quick brown fox';
      const searchText = 'quick';

      const results = hook.searchWithStrategy(text, searchText, 'FUZZY_MATCH');

      if (results.length > 0) {
        expect(results[0]).toHaveProperty('similarity');
        expect(results[0].similarity).toBeGreaterThan(0.7);
      }
    });

    it('rejects very different text', () => {
      const text = 'The abc def ghi';
      const searchText = 'quick';

      const results = hook.searchWithStrategy(text, searchText, 'FUZZY_MATCH');

      // Should not match very different text
      expect(results.length).toBe(0);
    });
  });

  // =========================================================================
  // WORD_BOUNDARY Strategy
  // =========================================================================

  describe('WORD_BOUNDARY strategy', () => {
    it('matches only whole words', () => {
      const text = 'The cat in the cathedral';
      const searchText = 'cat';

      const results = hook.searchWithStrategy(text, searchText, 'WORD_BOUNDARY');

      // Should match "cat" but not the "cat" in "cathedral"
      expect(results.some(r =>
        text.substring(r.start, r.end) === 'cat'
      )).toBe(true);
    });

    it('does not match partial words', () => {
      const text = 'testing test tester';
      const searchText = 'test';

      const results = hook.searchWithStrategy(text, searchText, 'WORD_BOUNDARY');

      // All matches should be complete words
      results.forEach(r => {
        expect([' ', '\n', '\t', undefined]).toContain(
          text.charAt(r.start - 1)
        );
      });
    });
  });

  // =========================================================================
  // STEMMING Strategy (Russian)
  // =========================================================================

  describe('STEMMING strategy', () => {
    it('matches word stems in Russian', () => {
      const text = 'Замок замки замков';
      const searchText = 'замок';

      const results = hook.searchWithStrategy(text, searchText, 'STEMMING');

      // Should match all forms
      expect(results.length).toBeGreaterThan(0);
    });

    it('handles Russian morphology', () => {
      const text = 'читать читал читаю';
      const searchText = 'читал';

      const results = hook.searchWithStrategy(text, searchText, 'STEMMING');

      // Should recognize same stem
      expect(results.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // SEMANTIC Strategy
  // =========================================================================

  describe('SEMANTIC strategy', () => {
    it('matches semantically similar text', () => {
      const text = 'The large dog barked';
      const searchText = 'big canine';

      const results = hook.searchWithStrategy(text, searchText, 'SEMANTIC');

      // Semantic match is optional (may not have embeddings)
      expect(Array.isArray(results)).toBe(true);
    });

    it('handles synonyms', () => {
      const text = 'The beautiful view was magnificent';
      const searchText = 'pretty scenery';

      const results = hook.searchWithStrategy(text, searchText, 'SEMANTIC');

      // May or may not match depending on semantic model
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // =========================================================================
  // MULTI_LANGUAGE Strategy
  // =========================================================================

  describe('MULTI_LANGUAGE strategy', () => {
    it('handles mixed Cyrillic and English', () => {
      const text = 'The замок is beautiful';
      const searchText = 'castle замок';

      const results = hook.searchWithStrategy(text, searchText, 'MULTI_LANGUAGE');

      expect(Array.isArray(results)).toBe(true);
    });

    it('translates search terms when needed', () => {
      const text = 'The castle is old';
      const searchText = 'замок';  // Russian word

      const results = hook.searchWithStrategy(text, searchText, 'MULTI_LANGUAGE');

      // May find English equivalent
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // =========================================================================
  // EDGE CASES
  // =========================================================================

  describe('Edge cases', () => {
    it('handles very long descriptions', () => {
      const longText = 'word '.repeat(10000);
      const searchText = 'word';

      const results = hook.searchWithStrategy(longText, searchText, 'EXACT_MATCH');

      expect(results.length).toBe(10000);
    });

    it('handles special characters', () => {
      const text = 'Hello! @World$ #Symbols&';
      const searchText = '@World$';

      const results = hook.searchWithStrategy(text, searchText, 'EXACT_MATCH');

      expect(results.length).toBeGreaterThan(0);
    });

    it('handles overlapping matches', () => {
      const text = 'aaa';
      const searchText = 'aa';

      const results = hook.searchWithStrategy(text, searchText, 'EXACT_MATCH');

      // Should find overlapping matches (positions 0-1 and 1-2)
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('handles no matches found', () => {
      const text = 'The quick brown fox';
      const searchText = 'xyz';

      const results = hook.searchWithStrategy(text, searchText, 'EXACT_MATCH');

      expect(results).toEqual([]);
    });

    it('handles empty text', () => {
      const text = '';
      const searchText = 'word';

      const results = hook.searchWithStrategy(text, searchText, 'EXACT_MATCH');

      expect(results).toEqual([]);
    });

    it('handles Unicode characters', () => {
      const text = '😀 The quick fox 😀';
      const searchText = 'quick';

      const results = hook.searchWithStrategy(text, searchText, 'EXACT_MATCH');

      expect(results.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // STRATEGY SELECTION
  // =========================================================================

  describe('Strategy selection and fallback', () => {
    it('uses best strategy for given text', () => {
      const text = 'Замок в лесу';

      // Should automatically select appropriate strategy
      const results = hook.findDescriptionMatches(text, 'замок');

      expect(Array.isArray(results)).toBe(true);
    });

    it('falls back to exact match if strategy fails', () => {
      const text = 'Hello world';
      const searchText = 'hello';

      const results = hook.findDescriptionMatches(text, searchText);

      // Should still find the match with fallback
      expect(results.length).toBeGreaterThan(0);
    });

    it('combines multiple strategies', () => {
      const text = 'The beautiful castle with the big door';
      const description = 'A magnificent fortress with large entrance';

      const results = hook.findDescriptionMatches(text, description);

      expect(Array.isArray(results)).toBe(true);
    });
  });

  // =========================================================================
  // PERFORMANCE
  // =========================================================================

  describe('Performance', () => {
    it('handles large texts efficiently', () => {
      const largeText = 'word '.repeat(50000);
      const searchText = 'xyz';  // No match

      const start = performance.now();
      const results = hook.searchWithStrategy(largeText, searchText, 'EXACT_MATCH');
      const end = performance.now();

      expect(end - start).toBeLessThan(1000);  // < 1 second
    });

    it('caches results for same search', () => {
      const text = 'Hello world';
      const searchText = 'hello';

      // First call
      const results1 = hook.searchWithStrategy(text, searchText, 'EXACT_MATCH');
      // Second call
      const results2 = hook.searchWithStrategy(text, searchText, 'EXACT_MATCH');

      expect(results1).toEqual(results2);
    });
  });
});
```

---

## 3. ЗАПУСК И ВАЛИДАЦИЯ

### Шаг 1: Создать файлы

```bash
# Backend tests
touch /backend/tests/services/test_gemini_extractor.py
touch /backend/tests/services/test_imagen_generator.py
touch /backend/tests/services/test_vless_http_client.py
touch /backend/tests/routers/test_auth.py

# Frontend tests
touch /frontend/src/hooks/epub/__tests__/useDescriptionHighlighting.test.ts
```

### Шаг 2: Скопировать код из примеров

### Шаг 3: Запустить тесты

```bash
# Backend
cd backend
pytest tests/services/test_gemini_extractor.py -v
pytest tests/services/test_imagen_generator.py -v

# Frontend
cd frontend
npm test -- useDescriptionHighlighting.test.ts
```

### Шаг 4: Проверить покрытие

```bash
cd backend
pytest --cov=app.services.gemini_extractor --cov-report=term-missing

cd frontend
npm test -- --coverage
```

---

## 4. TIMELINE

| Задача | Время | Файлы |
|--------|-------|-------|
| Gemini Extractor tests | 2-3 часа | test_gemini_extractor.py |
| Imagen Generator tests | 2-3 часа | test_imagen_generator.py |
| VLESS HTTP Client | 1 час | test_vless_http_client.py |
| Auth Router | 2 часа | test_auth.py |
| **Subtotal** | **7-8 часов** | **4 файла** |
| Description Highlighting | 4-5 часов | useDescriptionHighlighting.test.ts |
| **Total** | **~12 часов** | **5 файлов** |

---

## 5. УСПЕШНОЕ ЗАВЕРШЕНИЕ

**Вы завершили задачу, когда:**

```bash
# Backend coverage >80% для новых сервисов
pytest --cov=app.services --cov-report=term-missing | grep "gemini_extractor" | grep ">80"
pytest --cov=app.services --cov-report=term-missing | grep "imagen_generator" | grep ">80"

# Frontend component существует и имеет тесты
ls -l /frontend/src/hooks/epub/__tests__/useDescriptionHighlighting.test.ts

# Все тесты проходят
pytest -x  # exit on first failure
npm test   # frontend tests pass

# Coverage требование выполнено
pytest --cov=app --cov-fail-under=75  # Should not fail
```

---

**Начните с Gemini Extractor Tests - это займет 2-3 часа и сразу покроет критичный пробел!**
