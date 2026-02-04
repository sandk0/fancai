"""
Tagged Span Annotation (TSA) Parser for LLM-based text extraction.

Based on research from arXiv:2601.16946 (January 2026):
- XML-style tagging achieves 78.2% F1 vs 23.4% for character indexing
- Hybrid approach: tagged_text + structured JSON metadata

Architecture:
1. LLM returns original text with XML tags around descriptions
2. Parser extracts tags and finds exact positions in original text
3. Handles edge cases: duplicates, fuzzy matching, multi-line spans
"""

import re
import logging
from dataclasses import dataclass
from typing import List, Optional, Set, Tuple
from difflib import SequenceMatcher

logger = logging.getLogger(__name__)


@dataclass
class ParsedSpan:
    """A span extracted from TSA-tagged text with exact positions."""

    text: str
    span_type: str
    start: int
    end: int
    occurrence: int = 1
    confidence: float = 1.0
    match_method: str = "exact"


class TSAParser:
    """
    Robust parser for Tagged Span Annotation output from LLMs.

    Supports XML-style tags: <desc type="location" occurrence="1">text</desc>

    Features:
    - Occurrence tracking for duplicate text
    - Fuzzy matching fallback for LLM copy errors
    - Position-aware parsing with expected offset hints
    - Multi-line span support
    """

    TAG_PATTERN = re.compile(
        r'<desc\s+type=["\']([^"\']+)["\']'
        r'(?:\s+occurrence=["\'](\d+)["\'])?'
        r'(?:\s+confidence=["\']([0-9.]+)["\'])?'
        r"[^>]*>"
        r"(.*?)"
        r"</desc>",
        re.DOTALL | re.IGNORECASE,
    )

    FUZZY_THRESHOLD = 0.85
    POSITION_TOLERANCE = 100

    def __init__(self, fuzzy_threshold: float = 0.85, position_tolerance: int = 100):
        self.fuzzy_threshold = fuzzy_threshold
        self.position_tolerance = position_tolerance

    def parse(
        self, original_text: str, tagged_text: str, chunk_offset: int = 0
    ) -> List[ParsedSpan]:
        """
        Parse tagged text and find exact positions in original.

        Args:
            original_text: The original unmodified text
            tagged_text: Text with XML tags from LLM
            chunk_offset: Offset if original_text is a chunk of larger document

        Returns:
            List of ParsedSpan with exact positions
        """
        if not tagged_text or not original_text:
            return []

        results: List[ParsedSpan] = []
        used_positions: Set[int] = set()
        expected_position = 0
        last_tag_end = 0

        for match in self.TAG_PATTERN.finditer(tagged_text):
            span_type = match.group(1).lower()
            occurrence = int(match.group(2)) if match.group(2) else 1
            confidence = float(match.group(3)) if match.group(3) else 1.0
            span_text = match.group(4).strip()

            if not span_text:
                continue

            text_before_tag = self._strip_tags(
                tagged_text[last_tag_end : match.start()]
            )
            expected_position += len(text_before_tag)

            found_start, match_method = self._find_span_position(
                original_text, span_text, occurrence, used_positions, expected_position
            )

            if found_start >= 0:
                results.append(
                    ParsedSpan(
                        text=span_text,
                        span_type=span_type,
                        start=chunk_offset + found_start,
                        end=chunk_offset + found_start + len(span_text),
                        occurrence=occurrence,
                        confidence=confidence,
                        match_method=match_method,
                    )
                )
                used_positions.add(found_start)
                logger.debug(
                    f"TSA parsed: '{span_text[:30]}...' at {found_start} "
                    f"(method={match_method})"
                )
            else:
                logger.warning(
                    f"TSA span not found: '{span_text[:50]}...' "
                    f"(type={span_type}, occurrence={occurrence})"
                )

            expected_position += len(span_text)
            last_tag_end = match.end()

        return results

    def _find_span_position(
        self, text: str, span: str, occurrence: int, used: Set[int], expected_pos: int
    ) -> Tuple[int, str]:
        """
        Find span position using multiple strategies.

        Returns:
            Tuple of (position, match_method) or (-1, "not_found")
        """
        pos = self._find_nth_occurrence(text, span, occurrence, used)
        if pos >= 0:
            return pos, "exact"

        pos = self._find_near_expected(text, span, expected_pos, used)
        if pos >= 0:
            return pos, "positional"

        pos = self._find_case_insensitive(text, span, occurrence, used)
        if pos >= 0:
            return pos, "case_insensitive"

        pos = self._find_fuzzy(text, span, expected_pos, used)
        if pos >= 0:
            return pos, "fuzzy"

        return -1, "not_found"

    def _find_nth_occurrence(self, text: str, span: str, n: int, used: Set[int]) -> int:
        pos = -1
        count = 0
        while count < n:
            pos = text.find(span, pos + 1)
            if pos == -1:
                break
            if pos not in used:
                count += 1
        return pos

    def _find_near_expected(
        self, text: str, span: str, expected_pos: int, used: Set[int]
    ) -> int:
        start = max(0, expected_pos - self.position_tolerance)
        end = min(len(text), expected_pos + self.position_tolerance + len(span))

        window = text[start:end]
        idx = window.find(span)

        if idx >= 0:
            absolute_pos = start + idx
            if absolute_pos not in used:
                return absolute_pos

        return -1

    def _find_case_insensitive(
        self, text: str, span: str, occurrence: int, used: Set[int]
    ) -> int:
        text_lower = text.lower()
        span_lower = span.lower()

        pos = -1
        count = 0
        while count < occurrence:
            pos = text_lower.find(span_lower, pos + 1)
            if pos == -1:
                break
            if pos not in used:
                count += 1

        return pos

    def _find_fuzzy(
        self, text: str, span: str, expected_pos: int, used: Set[int]
    ) -> int:
        """
        Find span using fuzzy matching near expected position.

        Handles minor LLM copy errors (typos, missing punctuation).
        """
        start = max(0, expected_pos - self.position_tolerance)
        end = min(len(text), expected_pos + self.position_tolerance + len(span) * 2)

        window = text[start:end]
        best_pos = -1
        best_ratio = 0.0

        span_len = len(span)
        for i in range(len(window) - span_len + 1):
            candidate = window[i : i + span_len]
            ratio = SequenceMatcher(None, span.lower(), candidate.lower()).ratio()

            if ratio > best_ratio and ratio >= self.fuzzy_threshold:
                absolute_pos = start + i
                if absolute_pos not in used:
                    best_ratio = ratio
                    best_pos = absolute_pos

        if best_pos >= 0:
            logger.debug(f"Fuzzy match: '{span[:30]}...' ratio={best_ratio:.2f}")

        return best_pos

    def _strip_tags(self, text: str) -> str:
        return re.sub(r"<[^>]+>", "", text)

    @staticmethod
    def validate_spans(spans: List[ParsedSpan], original_text: str) -> List[ParsedSpan]:
        """
        Validate that parsed spans actually exist in original text.

        Returns only verified spans.
        """
        verified = []
        for span in spans:
            actual_text = original_text[span.start : span.end]
            if actual_text == span.text:
                verified.append(span)
            elif actual_text.lower() == span.text.lower():
                span.match_method = "case_mismatch"
                verified.append(span)
            else:
                logger.warning(
                    f"Span validation failed: expected '{span.text[:30]}...', "
                    f"got '{actual_text[:30]}...'"
                )
        return verified


_parser: Optional[TSAParser] = None


def get_tsa_parser() -> TSAParser:
    global _parser
    if _parser is None:
        _parser = TSAParser()
    return _parser
