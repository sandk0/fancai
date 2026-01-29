/**
 * Advanced text normalization for better matching
 * Handles: whitespace, non-breaking spaces, chapter headers, punctuation
 */
export const normalizeText = (text: string): string => {
  return text
    .replace(/\u00A0/g, ' ') // Replace non-breaking spaces
    .replace(/\s+/g, ' ') // Normalize all whitespace to single space
    .replace(/[«»""]/g, '"') // Normalize quotes
    .replace(/\u2013|\u2014/g, '-') // Normalize dashes
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
