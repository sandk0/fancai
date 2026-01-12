/**
 * useChapterMapping - Maps EPUB spine hrefs to backend chapter numbers
 *
 * Solves the mismatch between:
 * - Frontend: spine index (0, 1, 2, 3, ...)
 * - Backend: logical chapter numbers (1, 2, 3, ...)
 *
 * The backend parser skips non-chapter spine items (cover, TOC, etc.)
 * and extracts chapter numbers from content ("Глава первая" -> 1).
 *
 * This hook creates a mapping using a 2-level strategy:
 * 1. Match by title similarity (exact, partial, or chapter number)
 * 2. Sequential fallback (assume TOC order matches chapter order)
 *
 * @example
 * const { getChapterNumberByHref, getChapterNumberByLocation } = useChapterMapping(toc, chapters);
 * const chapterNum = getChapterNumberByLocation(rendition.currentLocation());
 */

import { useMemo } from 'react';
import type { NavItem, Location } from '@/types/epub';

// ============================================================================
// Types
// ============================================================================

interface ChapterMetadata {
  id: string;
  number: number;
  title: string;
  word_count: number;
}

interface ChapterMapping {
  /** Maps normalized href to backend chapter number */
  hrefToChapterNumber: Map<string, number>;
  /** Get chapter number by spine href */
  getChapterNumberByHref: (href: string) => number | null;
  /** Get chapter number by epub.js location object */
  getChapterNumberByLocation: (location: Location) => number | null;
}

// ============================================================================
// Constants
// ============================================================================

/** Russian numeral words to numbers (feminine form for "глава") */
const RUSSIAN_NUMERALS: Record<string, number> = {
  'первая': 1, 'вторая': 2, 'третья': 3, 'четвертая': 4, 'пятая': 5,
  'шестая': 6, 'седьмая': 7, 'восьмая': 8, 'девятая': 9, 'десятая': 10,
  'одиннадцатая': 11, 'двенадцатая': 12, 'тринадцатая': 13, 'четырнадцатая': 14,
  'пятнадцатая': 15, 'шестнадцатая': 16, 'семнадцатая': 17, 'восемнадцатая': 18,
  'девятнадцатая': 19, 'двадцатая': 20,
};

/** Regex to extract chapter numbers (Russian words or digits) */
const CHAPTER_NUMBER_REGEX = new RegExp(
  `(${Object.keys(RUSSIAN_NUMERALS).join('|')}|\\d+)`,
  'i'
);

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Normalize href for comparison.
 * Removes hash fragments, query params, and leading slashes.
 */
const normalizeHref = (href: string): string =>
  href.split('#')[0].split('?')[0].replace(/^\/+/, '').toLowerCase();

/**
 * Normalize title for comparison.
 * Lowercases and collapses whitespace.
 */
const normalizeTitle = (title: string): string =>
  title.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Extract chapter number from text.
 * Supports both Russian numerals ("первая") and digits ("1").
 * @returns Chapter number or null if not found
 */
const extractChapterNumber = (text: string): number | null => {
  const match = normalizeTitle(text).match(CHAPTER_NUMBER_REGEX);
  if (!match) return null;

  const value = match[1].toLowerCase();
  const numericValue = RUSSIAN_NUMERALS[value] ?? parseInt(value, 10);
  return isNaN(numericValue) ? null : numericValue;
};

/**
 * Check if two titles refer to the same chapter.
 * Uses 3 matching strategies in order:
 * 1. Exact match after normalization
 * 2. One title contains the other
 * 3. Both contain the same chapter number
 */
const titlesMatch = (title1: string, title2: string): boolean => {
  const norm1 = normalizeTitle(title1);
  const norm2 = normalizeTitle(title2);

  // Strategy 1: Exact match
  if (norm1 === norm2) return true;

  // Strategy 2: Substring match (e.g., "Глава 1" in "Глава первая: начало")
  if (norm1.includes(norm2) || norm2.includes(norm1)) return true;

  // Strategy 3: Same chapter number in both titles
  const num1 = extractChapterNumber(norm1);
  const num2 = extractChapterNumber(norm2);
  return num1 !== null && num2 !== null && num1 === num2;
};

/**
 * Flatten nested TOC structure into a flat array.
 * Preserves order: parent items come before their children.
 */
const flattenToc = (toc: NavItem[]): NavItem[] =>
  toc.flatMap(item => [item, ...flattenToc(item.subitems ?? [])]);

// ============================================================================
// Hook
// ============================================================================

export const useChapterMapping = (
  toc: NavItem[],
  chapters: ChapterMetadata[]
): ChapterMapping => {
  const hrefToChapterNumber = useMemo(() => {
    const mapping = new Map<string, number>();

    // Early return if data is missing
    if (!toc?.length || !chapters?.length) {
      return mapping;
    }

    const flatToc = flattenToc(toc);
    const sortedChapters = [...chapters].sort((a, b) => a.number - b.number);

    flatToc.forEach((tocItem, index) => {
      const normalizedHref = normalizeHref(tocItem.href);
      const tocTitle = tocItem.label || '';

      // Strategy 1: Match by title similarity
      const matchedChapter = sortedChapters.find(ch => titlesMatch(tocTitle, ch.title));

      if (matchedChapter) {
        mapping.set(normalizedHref, matchedChapter.number);
        return;
      }

      // Strategy 2: Sequential fallback (assume same order as chapters)
      if (index < sortedChapters.length) {
        mapping.set(normalizedHref, sortedChapters[index].number);
      }
    });

    return mapping;
  }, [toc, chapters]);

  const getChapterNumberByHref = (href: string): number | null =>
    hrefToChapterNumber.get(normalizeHref(href)) ?? null;

  const getChapterNumberByLocation = (location: Location): number | null => {
    const href = location?.start?.href;
    return href ? getChapterNumberByHref(href) : null;
  };

  return {
    hrefToChapterNumber,
    getChapterNumberByHref,
    getChapterNumberByLocation,
  };
};
