/**
 * useChapterMapping - Maps EPUB spine hrefs to backend chapter numbers
 *
 * STRATEGY (Hybrid):
 * 1. Hard Match (Primary): Matches `chapter.file_path` from DB with `tocItem.href`.
 *    This is 100% reliable for new books processed with the updated backend.
 * 2. Heuristic Match (Fallback): Uses title similarity and regex for legacy books
 *    (where file_path is missing) or fallback scenarios.
 *
 * @example
 * const { getChapterNumberByHref } = useChapterMapping(toc, chapters);
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
  file_path?: string; // Internal EPUB path (e.g. "Text/chapter1.xhtml")
}

interface ChapterMapping {
  hrefToChapterNumber: Map<string, number>;
  getChapterNumberByHref: (href: string) => number | null;
  getChapterNumberByLocation: (location: Location) => number | null;
}

// ============================================================================
// Constants & Regex
// ============================================================================

const RUSSIAN_NUMERALS: Record<string, number> = {
  'первая': 1, 'вторая': 2, 'третья': 3, 'четвертая': 4, 'четвёртая': 4, 'пятая': 5,
  'шестая': 6, 'седьмая': 7, 'восьмая': 8, 'девятая': 9, 'десятая': 10,
  'одиннадцатая': 11, 'двенадцатая': 12, 'тринадцатая': 13, 'четырнадцатая': 14,
  'пятнадцатая': 15, 'шестнадцатая': 16, 'семнадцатая': 17, 'восемнадцатая': 18,
  'девятнадцатая': 19, 'двадцатая': 20,
};

const SERVICE_KEYWORDS = [
  'содержание', 'оглавление', 'table of contents', 'contents',
  'copyright', 'издательство', 'об авторе', 'about the author',
  'примечания', 'notes', 'благодарности', 'acknowledgments',
  'алфавитный указатель', 'index', 'библиография', 'bibliography',
  'isbn'
];

// ============================================================================
// Utility Functions
// ============================================================================

const normalizeHref = (href: string): string =>
  href.split('#')[0].split('?')[0].replace(/^\/+/, '').toLowerCase();

const normalizeTitle = (title: string): string =>
  title.toLowerCase().replace(/\s+/g, ' ').trim();

const extractChapterNumber = (title: string): number | null => {
  const lower = normalizeTitle(title);

  for (const [word, num] of Object.entries(RUSSIAN_NUMERALS)) {
    if (lower.includes(word)) return num;
  }

  const explicitMatch = lower.match(/(?:chapter|глава|часть|part)\s*(\d+|[ivxlcdm]+)/i);
  if (explicitMatch) {
    const val = explicitMatch[1];
    if (/^[ivxlcdm]+$/.test(val)) return romanToInt(val);
    return parseInt(val, 10);
  }

  const startMatch = lower.match(/^(\d+)\./);
  if (startMatch) return parseInt(startMatch[1], 10);

  return null;
};

const romanToInt = (s: string): number => {
  const map: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let res = 0;
  s = s.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    const curr = map[s[i]] || 0;
    const next = map[s[i + 1]] || 0;
    if (curr < next) res -= curr;
    else res += curr;
  }
  return res;
};

const flattenToc = (toc: NavItem[]): NavItem[] =>
  toc.flatMap(item => [item, ...flattenToc(item.subitems ?? [])]);

// ============================================================================
// Hook implementation
// ============================================================================

export const useChapterMapping = (
  toc: NavItem[],
  chapters: ChapterMetadata[]
): ChapterMapping => {
  const hrefToChapterNumber = useMemo(() => {
    const mapping = new Map<string, number>();

    if (!toc?.length || !chapters?.length) {
      return mapping;
    }

    const flatToc = flattenToc(toc);
    const sortedChapters = [...chapters].sort((a, b) => a.number - b.number);
    const chapterMap = new Map<number, ChapterMetadata>();
    sortedChapters.forEach(c => chapterMap.set(c.number, c));

    // Phase 1: Hard Matching (File Path)
    // Used for new books where backend provides file_path
    let hasHardMatches = false;

    flatToc.forEach(item => {
      const href = normalizeHref(item.href);
      const match = sortedChapters.find(c => c.file_path && normalizeHref(c.file_path) === href);
      if (match) {
        mapping.set(href, match.number);
        hasHardMatches = true;
      }
    });

    if (hasHardMatches) {
      // If we found hard matches, rely on them primarily.
      // We can optionally fill gaps if needed, but usually hard match is complete
      // if the backend did its job.
      // Returning here implicitly prefers "Strict Mode".
      return mapping;
    }

    // Phase 2: Heuristic Matching (Legacy / Fallback)
    // Executed ONLY if no hard matches were found (Legacy books)

    const assignments: Array<{ href: string; chapterNum: number | null; confidence: 'high' | 'low' | 'none' }> = [];

    flatToc.forEach(item => {
      const title = item.label || '';
      const normTitle = normalizeTitle(title);
      const href = normalizeHref(item.href);

      if (SERVICE_KEYWORDS.some(k => normTitle.includes(k))) {
        assignments.push({ href, chapterNum: null, confidence: 'high' });
        return;
      }

      const extractedNum = extractChapterNumber(title);
      if (extractedNum !== null && chapterMap.has(extractedNum)) {
        assignments.push({ href, chapterNum: extractedNum, confidence: 'high' });
        mapping.set(href, extractedNum);
        return;
      }

      const exactMatch = sortedChapters.find(c => normalizeTitle(c.title) === normTitle);
      if (exactMatch) {
        assignments.push({ href, chapterNum: exactMatch.number, confidence: 'high' });
        mapping.set(href, exactMatch.number);
        return;
      }

      assignments.push({ href, chapterNum: null, confidence: 'none' });
    });

    // Interpolation for gaps (Legacy Sequential Fallback)
    let nextExpectedChapter = 1;
    assignments.forEach((assign) => {
      if (assign.confidence === 'high') {
        if (assign.chapterNum !== null) nextExpectedChapter = assign.chapterNum + 1;
      } else {
        if (chapterMap.has(nextExpectedChapter)) {
          mapping.set(assign.href, nextExpectedChapter);
          nextExpectedChapter++; // Increment only if assigned
        }
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
