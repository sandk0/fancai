"""
Unit-tests for TextChunker from ner_service.py.

Uses a mock tokenizer to avoid loading real DeBERTa model.
"""

import pytest
from unittest.mock import MagicMock

from app.services.ner_service import TextChunker


def make_mock_tokenizer(chars_per_token: int = 3):
    """Create a mock tokenizer that approximates token count."""
    tokenizer = MagicMock()
    tokenizer.encode = lambda text, add_special_tokens=False: [0] * (
        len(text) // chars_per_token
    )
    return tokenizer


class TestTextChunkerShortChapter:
    """test_chunk_text_short_chapter: text < 384 tokens -> 1 chunk, start_offset=0."""

    def test_short_chapter_returns_single_chunk(self):
        tokenizer = make_mock_tokenizer(chars_per_token=3)
        # ~100 chars -> ~33 tokens, well under 384
        text = "Геральт сидел у костра. Он смотрел на звёзды. Ночь была тихой."
        chunks = TextChunker.chunk_text(
            text, tokenizer, max_tokens=384, overlap_sentences=2
        )
        assert len(chunks) == 1
        assert chunks[0].start_offset == 0
        assert chunks[0].end_offset == len(text)

    def test_short_chapter_text_matches_original(self):
        tokenizer = make_mock_tokenizer(chars_per_token=3)
        text = "Геральт сидел у костра. Он смотрел на звёзды."
        chunks = TextChunker.chunk_text(text, tokenizer, max_tokens=384)
        assert chunks[0].text == text


class TestTextChunkerLongChapter:
    """test_chunk_text_long_chapter: text > 384 tokens -> multiple chunks with overlap."""

    def test_long_chapter_produces_multiple_chunks(self):
        tokenizer = make_mock_tokenizer(chars_per_token=2)
        # Generate text with many sentences to exceed 384 tokens
        sentences = [
            f"Предложение номер {i} содержит достаточно слов для тестирования."
            for i in range(50)
        ]
        text = " ".join(sentences)
        # With chars_per_token=2, total tokens ~ len(text)/2 >> 384
        chunks = TextChunker.chunk_text(
            text, tokenizer, max_tokens=384, overlap_sentences=2
        )
        assert len(chunks) > 1

    def test_chunks_cover_entire_text(self):
        tokenizer = make_mock_tokenizer(chars_per_token=2)
        sentences = [
            f"Предложение номер {i} в длинном тексте для проверки." for i in range(50)
        ]
        text = " ".join(sentences)
        chunks = TextChunker.chunk_text(
            text, tokenizer, max_tokens=384, overlap_sentences=2
        )
        # Last chunk should end at the end of text
        assert chunks[-1].end_offset == len(text)
        # First chunk should start at 0
        assert chunks[0].start_offset == 0


class TestTextChunkerOverlapSentences:
    """test_chunk_text_overlap_sentences: last N sentences repeat in next chunk."""

    def test_overlap_sentences_present(self):
        tokenizer = make_mock_tokenizer(chars_per_token=2)
        sentences = [
            f"Уникальное предложение под номером {i} для теста overlap."
            for i in range(50)
        ]
        text = " ".join(sentences)
        chunks = TextChunker.chunk_text(
            text, tokenizer, max_tokens=384, overlap_sentences=2
        )
        if len(chunks) >= 2:
            # The end of chunk[0] text should overlap with the beginning of chunk[1] text
            # At minimum, some content from the end of chunk 0 should appear at start of chunk 1
            chunk0_text = chunks[0].text
            chunk1_text = chunks[1].text
            # Find common content
            assert chunks[1].start_offset < chunks[0].end_offset or any(
                sent in chunk1_text
                for sent in chunk0_text.split(".")[-3:]
                if sent.strip()
            )


class TestTextChunkerOffsetsMatchOriginal:
    """test_chunk_text_offsets_match_original: chunk.text matches original_text slice."""

    def test_offsets_match_original_text(self):
        tokenizer = make_mock_tokenizer(chars_per_token=2)
        sentences = [
            f"Предложение {i} для проверки корректности смещений." for i in range(50)
        ]
        text = " ".join(sentences)
        chunks = TextChunker.chunk_text(
            text, tokenizer, max_tokens=384, overlap_sentences=2
        )
        for chunk in chunks:
            original_slice = text[chunk.start_offset : chunk.end_offset]
            assert chunk.text == original_slice, (
                f"Chunk text mismatch: chunk.text={chunk.text[:50]}... "
                f"vs original[{chunk.start_offset}:{chunk.end_offset}]={original_slice[:50]}..."
            )


class TestTextChunkerEmptyText:
    """test_chunk_text_empty_text: empty text -> empty list."""

    def test_empty_text_returns_empty_list(self):
        tokenizer = make_mock_tokenizer()
        chunks = TextChunker.chunk_text("", tokenizer, max_tokens=384)
        assert chunks == []

    def test_whitespace_only_returns_empty_list(self):
        tokenizer = make_mock_tokenizer()
        chunks = TextChunker.chunk_text("   \n\t  ", tokenizer, max_tokens=384)
        assert chunks == []


class TestTextChunkerSingleSentence:
    """test_chunk_text_single_sentence: one sentence -> 1 chunk."""

    def test_single_sentence_returns_one_chunk(self):
        tokenizer = make_mock_tokenizer(chars_per_token=3)
        text = "Геральт из Ривии был знаменитым ведьмаком."
        chunks = TextChunker.chunk_text(text, tokenizer, max_tokens=384)
        assert len(chunks) == 1
        assert chunks[0].text == text
