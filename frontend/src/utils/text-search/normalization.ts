/**
 * Advanced text normalization for better matching
 * Handles: whitespace, non-breaking spaces, chapter headers, punctuation,
 * soft hyphens, zero-width spaces, non-breaking hyphens, ellipsis
 */
export const normalizeText = (text: string): string => {
  return text
    .replace(/\u00AD/g, '') // Remove soft hyphens
    .replace(/\u200B/g, '') // Remove zero-width spaces
    .replace(/\u00A0/g, ' ') // Replace non-breaking spaces
    .replace(/\s+/g, ' ') // Normalize all whitespace to single space
    .replace(/[«»\u201C\u201D]/g, '"') // Normalize quotes
    .replace(/\u2013|\u2014/g, '-') // Normalize dashes (en/em dash)
    .replace(/\u2011/g, '-') // Non-breaking hyphen → regular hyphen
    .replace(/\u2026/g, '...') // Ellipsis → three dots
    .trim();
};

/**
 * Remove chapter headers from description content
 * Enhanced v2.1: Handles complex patterns like:
 * - "Глава 4 Нити Том Меррилин..." -> "Том Меррилин..."
 * - "Глава 1. Начало Он проснулся..." -> "Он проснулся..."
 * - "ЧАСТЬ ПЕРВАЯ ГЛАВА 1 Текст..." -> "Текст..."
 */
export const removeChapterHeaders = (text: string): string => {
  let result = text;

  // Pattern 1: "Глава X НазваниеГлавы " followed by content starting with capital
  // This catches "Глава 4 Нити Том Меррилин..." -> "Том Меррилин..."
  result = result.replace(/^Глава\s+\d+\.?\s+[А-Яа-яA-Za-z]+\s+(?=[А-ЯA-Z])/gi, '');

  // Pattern 2: "Глава X. Название главы" with period separator
  result = result.replace(/^Глава\s+\d+\.?\s*[А-Яа-яA-Za-z\s]{1,50}?\s+(?=[А-ЯA-Z][а-яa-z])/gi, '');

  // Pattern 3: Basic chapter headers "Глава 1", "Глава первая", "Глава I"
  result = result.replace(/^(Глава\s+[А-Яа-я\dIVXLC]+\.?\s*)+/gi, '');

  // Pattern 4: English chapters "Chapter 1", "Chapter One"
  result = result.replace(/^(Chapter\s+[A-Za-z\d]+\.?\s*)+/gi, '');

  // Pattern 5: Numbered headings "1.", "1.1", "1.1.1"
  result = result.replace(/^\d+(\.\d+)*\.?\s+/, '');

  // Pattern 6: Part headers "Часть 1", "Part I", "ЧАСТЬ ПЕРВАЯ"
  result = result.replace(/^(Часть|Part)\s+[А-Яа-яA-Za-z\dIVXLC]+\.?\s*/gi, '');

  // Pattern 7: "ПРОЛОГ", "ЭПИЛОГ", "ПРЕДИСЛОВИЕ"
  result = result.replace(/^(ПРОЛОГ|ЭПИЛОГ|ПРЕДИСЛОВИЕ|ВВЕДЕНИЕ|ПОСЛЕСЛОВИЕ)\s*/gi, '');

  // Pattern 8: Combination "ЧАСТЬ ПЕРВАЯ ГЛАВА 1"
  result = result.replace(/^ЧАСТЬ\s+[А-ЯA-Z]+\s+(ГЛАВА\s+\d+\s*)?/gi, '');

  // Pattern 9: Titles with dashes "Глава 1 - Название"
  result = result.replace(/^Глава\s+\d+\s*[-–—]\s*[А-Яа-яA-Za-z\s]+\s+(?=[А-ЯA-Z])/gi, '');

  return result.trim();
};

/**
 * Extract first N words from text for fuzzy matching
 */
export const getFirstWords = (text: string, count: number): string => {
  return text.split(/\s+/).slice(0, count).join(' ');
};

/**
 * Characters removed by normalizeText (N:0 mapping — produce no output)
 */
const REMOVED_CHARS = new Set(['\u00AD', '\u200B']);

/**
 * Characters expanded by normalizeText (1:N mapping — one input produces multiple output chars)
 * Maps original char → replacement string
 */
const EXPANDED_CHARS: Record<string, string> = {
  '\u2026': '...', // ellipsis → 3 dots
};

/**
 * Check if a character is whitespace (including NBSP which normalizeText converts to space)
 */
const isWhitespaceChar = (ch: string): boolean => /\s/.test(ch) || ch === '\u00A0';

/**
 * Build a mapping from normalized text indices to original text indices.
 * Mirrors ALL transformations done by normalizeText():
 * - Removed chars: \u00AD (soft hyphen), \u200B (zero-width space) → skipped
 * - NBSP \u00A0 → space (treated as whitespace for collapse)
 * - Whitespace collapse: \s+ → single space
 * - 1:1 replacements: quotes, dashes, non-breaking hyphen → same index
 * - 1:N expansions: \u2026 (ellipsis) → '...' (3 entries pointing to same original index)
 * - Trim: leading/trailing whitespace removed
 *
 * @returns Array where map[normalizedIdx] = originalIdx
 */
export const buildIndexMap = (original: string): number[] => {
  const map: number[] = [];

  let oi = 0;

  // Skip leading whitespace (trim)
  while (oi < original.length) {
    const ch = original[oi];
    if (REMOVED_CHARS.has(ch)) {
      // Skip removed chars in leading area
      oi++;
    } else if (isWhitespaceChar(ch)) {
      oi++;
    } else {
      break;
    }
  }

  let inWhitespace = false;
  while (oi < original.length) {
    const ch = original[oi];

    // Removed chars: skip entirely (no entry in map)
    if (REMOVED_CHARS.has(ch)) {
      oi++;
      continue;
    }

    // Expanded chars: one original char produces multiple normalized chars
    if (ch in EXPANDED_CHARS) {
      if (inWhitespace) {
        inWhitespace = false;
      }
      const expansion = EXPANDED_CHARS[ch];
      for (let j = 0; j < expansion.length; j++) {
        map.push(oi);
      }
      oi++;
      continue;
    }

    // Whitespace (including NBSP): collapse runs to single space
    if (isWhitespaceChar(ch)) {
      if (!inWhitespace) {
        map.push(oi);
        inWhitespace = true;
      }
      oi++;
      continue;
    }

    // Regular char or 1:1 replacement (quotes, dashes, non-breaking hyphen)
    inWhitespace = false;
    map.push(oi);
    oi++;
  }

  // Trim trailing whitespace entry to match normalizeText()'s trim()
  if (inWhitespace && map.length > 0) {
    map.pop();
  }

  return map;
};

/**
 * Map a range [startIdx, endIdx) from normalized text back to original text.
 * The indexMap should be pre-computed via buildIndexMap() for the same original text.
 */
export const mapNormalizedRange = (
  indexMap: number[],
  original: string,
  normalizedStartIdx: number,
  normalizedEndIdx: number
): { startIdx: number; endIdx: number } => {
  const startIdx =
    normalizedStartIdx < indexMap.length ? indexMap[normalizedStartIdx] : original.length;

  const lastNormIdx = normalizedEndIdx - 1;
  let endIdx: number;
  if (lastNormIdx < indexMap.length) {
    endIdx = indexMap[lastNormIdx] + 1;
  } else {
    endIdx = original.length;
  }

  return { startIdx, endIdx };
};
