/**
 * useChapterMapping - Maps EPUB spine hrefs to backend chapter numbers
 *
 * STRATEGY (Hybrid + Spine-based):
 * 1. Spine Map (Primary): Uses location.start.index + TOC-based spineChapterMap.
 *    Most reliable — works for all books regardless of title format.
 * 2. Hard Match (Secondary): Matches chapter.file_path from DB with tocItem.href.
 *    100% reliable for new books processed with updated backend.
 * 3. Heuristic Match (Fallback): Title similarity + regex for legacy books.
 * 4. Spine arithmetic fallback: bodymatterIdx + relative spine position.
 *
 * @example
 * const { getChapterNumberByHref } = useChapterMapping(toc, chapters, book);
 */

import { useMemo } from 'react';
import type { NavItem, Location, Book } from '@/types/epub';

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

// Compound-first: десятки для числительных 21–99
const TENS: Record<string, number> = {
  'двадцать': 20, 'тридцать': 30, 'сорок': 40, 'пятьдесят': 50,
  'шестьдесят': 60, 'семьдесят': 70, 'восемьдесят': 80, 'девяносто': 90,
};

// Единицы для составных: "двадцать первая" = 20 + 1
const UNIT_ORDINALS: Record<string, number> = {
  'первая': 1, 'вторая': 2, 'третья': 3, 'четвёртая': 4, 'четвертая': 4,
  'пятая': 5, 'шестая': 6, 'седьмая': 7, 'восьмая': 8, 'девятая': 9,
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

/**
 * Извлекает номер главы из заголовка.
 * Compound-first: сначала составные (21–99), потом простые.
 * Экспортируется для тестирования.
 */
export const extractChapterNumber = (title: string): number | null => {
  const lower = normalizeTitle(title);

  // 1. Составные числительные (21–99) — ПЕРВЫМИ
  // Иначе "двадцать вторая" → substring match "вторая" → 2 вместо 22
  for (const [tens, tensVal] of Object.entries(TENS)) {
    for (const [unit, unitVal] of Object.entries(UNIT_ORDINALS)) {
      if (lower.includes(`${tens} ${unit}`)) return tensVal + unitVal;
    }
  }

  // 2. Простые числительные — по убыванию длины
  // (предотвращает ранний матч "первая" перед "одиннадцатая")
  const sortedSimple = Object.entries(RUSSIAN_NUMERALS)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [word, num] of sortedSimple) {
    if (lower.includes(word)) return num;
  }

  // 3. Arabic / Roman числа из заголовка
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
// Spine-based bodymatter detection (Шаг 4.1)
// ============================================================================

/**
 * Возвращает spine index первого контентного (bodymatter) spine item.
 * Иерархия:
 * 1. EPUB 3 Landmarks (epub:type="bodymatter")
 * 2. NCX/TOC first entry gap detection — ключевой для российских FB2-EPUB 2
 * 3. Первый linear spine item (fallback)
 *
 * Экспортируется для тестирования.
 */
export function getBodymatterSpineIndex(book: Book): number {
  // Уровень 1: EPUB 3 Landmarks (epub:type="bodymatter")
  // book.navigation.landmarks всегда [], никогда null (для EPUB 2 всегда пусто)
  const landmark = book.navigation.landmarks?.find(l => l.type === 'bodymatter');
  if (landmark) {
    // book.spine.get() автоматически стрипает #fragment (spine.js line 143)
    const item = book.spine.get(landmark.href);
    if (item) return item.index;
  }

  // Уровень 2: NCX/TOC first entry
  // epub.js НЕ парсит <guide> — book.packaging.guide НЕ существует
  // NCX — лучший доступный fallback для российских FB2-EPUB 2
  const firstTocItem = book.navigation.toc?.[0];
  if (firstTocItem) {
    const spineItem = book.spine.get(firstTocItem.href);
    if (spineItem) {
      if (spineItem.index > 0) {
        // TOC начинается не с spine[0] → сервисные страницы перед ним
        return spineItem.index;
      }
      // spineItem.index === 0 → нет сервисных страниц перед контентом
      return 0;
    }
  }

  // Уровень 3: Первый linear spine item
  return book.spine.first()?.index ?? 0;
}

// ============================================================================
// Spine Chapter Map builder (Шаг 4.2)
// ============================================================================

/**
 * Строит маппинг: spineIndex → chapterNumber из TOC с учётом bodymatter.
 */
function buildSpineChapterMap(book: Book): Map<number, number> {
  const bodymatterIdx = getBodymatterSpineIndex(book);
  const chapterMap = new Map<number, number>(); // spineIndex → chapterNumber
  const seenIndices = new Set<number>();
  let chapterNumber = 0;

  const allTocItems = flattenToc(book.navigation.toc);

  for (const tocItem of allTocItems) {
    const spineItem = book.spine.get(tocItem.href);
    if (!spineItem) continue;
    if (spineItem.index < bodymatterIdx) continue;  // до bodymatter
    if (seenIndices.has(spineItem.index)) continue;  // дедупликация
    seenIndices.add(spineItem.index);
    chapterMap.set(spineItem.index, ++chapterNumber);
  }

  // Fallback: pure spine если TOC пустой или ничего не нашли
  if (chapterMap.size === 0) {
    book.spine.each((item) => {
      if (item.index >= bodymatterIdx) {
        chapterMap.set(item.index, chapterMap.size + 1);
      }
    });
  }

  return chapterMap;
}

// ============================================================================
// Hook implementation (Шаги 4.3–4.5)
// ============================================================================

export const useChapterMapping = (
  toc: NavItem[],
  chapters: ChapterMetadata[],
  book?: Book | null  // Шаг 4.3: book опциональный — backward compatible
): ChapterMapping => {
  // Spine-based chapter map (строится один раз при наличии book)
  const spineChapterMap = useMemo(() => {
    if (!book) return new Map<number, number>();
    try {
      return buildSpineChapterMap(book);
    } catch {
      return new Map<number, number>();
    }
  }, [book]);

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
      return mapping;
    }

    // Phase 2: Heuristic Matching (Legacy / Fallback)

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
          nextExpectedChapter++;
        }
      }
    });

    return mapping;
  }, [toc, chapters]);

  const getChapterNumberByHref = (href: string): number | null =>
    hrefToChapterNumber.get(normalizeHref(href)) ?? null;

  // Шаг 4.5: обновлённая getChapterNumberByLocation с spine index как приоритет 1
  const getChapterNumberByLocation = (location: Location): number | null => {
    // Приоритет 1: spine-based map по location.start.index
    const spineIndex = location?.start?.index;
    if (typeof spineIndex === 'number' && spineChapterMap.size > 0) {
      const ch = spineChapterMap.get(spineIndex);
      if (ch != null) return ch;
    }

    // Приоритет 2: hard-match по file_path (compatibility layer для DB)
    const href = location?.start?.href;
    if (href) {
      const hardMatch = getChapterNumberByHref(href);
      if (hardMatch !== null) return hardMatch;
    }

    // Приоритет 3: spine arithmetic fallback
    if (typeof spineIndex === 'number' && book) {
      try {
        const bodymatterIdx = getBodymatterSpineIndex(book);
        return Math.max(1, spineIndex - bodymatterIdx + 1);
      } catch {
        // fallthrough
      }
    }

    return null;
  };

  return {
    hrefToChapterNumber,
    getChapterNumberByHref,
    getChapterNumberByLocation,
  };
};
