/**
 * Тесты для useChapterMapping — маппинг spine hrefs на номера глав.
 *
 * Фаза 3 (TDD): тесты написаны до реализации compound-first и spine-based логики.
 * Шаг 3.2: extractChapterNumber (compound-first)
 * Шаг 3.3: getBodymatterSpineIndex (мок book)
 */

import { describe, it, expect, vi } from 'vitest';

// ============================================================================
// Импорт тестируемых функций (будут экспортированы в Фазе 4)
// ============================================================================

import {
  extractChapterNumber,
  getBodymatterSpineIndex,
} from '../useChapterMapping';

// ============================================================================
// Helpers: Мок Book объект для epub.js
// ============================================================================

interface MockSpineItem {
  index: number;
  href: string;
}

function mockBook(options: {
  landmarks?: Array<{ type: string; href: string }>;
  toc?: Array<{ href: string; label: string; subitems: unknown[] }>;
  spineItems?: MockSpineItem[];
}) {
  const { landmarks = [], toc = [], spineItems = [] } = options;

  const spineGet = vi.fn((href: string): MockSpineItem | null => {
    const clean = href.split('#')[0];
    return spineItems.find(i => i.href === clean) ?? null;
  });

  const spineFirst = vi.fn((): MockSpineItem | null => {
    const linear = spineItems.find(i => i.index >= 0);
    return linear ?? null;
  });

  return {
    navigation: {
      landmarks,
      toc,
    },
    spine: {
      get: spineGet,
      first: spineFirst,
      items: spineItems,
    },
  };
}

// ============================================================================
// Тесты: extractChapterNumber (Шаг 3.2)
// ============================================================================

describe('extractChapterNumber', () => {
  describe('Составные числительные (compound-first) — регрессионные тесты', () => {
    it('Глава двадцать вторая → 22, не 2', () => {
      expect(extractChapterNumber('Глава двадцать вторая')).toBe(22);
    });

    it('Глава двадцать первая → 21, не 1', () => {
      expect(extractChapterNumber('Глава двадцать первая')).toBe(21);
    });

    it('Глава двадцать третья → 23, не 3', () => {
      expect(extractChapterNumber('Глава двадцать третья')).toBe(23);
    });

    it('Глава тридцать пятая → 35', () => {
      expect(extractChapterNumber('Глава тридцать пятая')).toBe(35);
    });

    it('Глава девяносто девятая → 99', () => {
      expect(extractChapterNumber('Глава девяносто девятая')).toBe(99);
    });
  });

  describe('Простые числительные — не регрессия', () => {
    it('Глава вторая → 2', () => {
      expect(extractChapterNumber('Глава вторая')).toBe(2);
    });

    it('Глава двадцатая → 20', () => {
      expect(extractChapterNumber('Глава двадцатая')).toBe(20);
    });

    it('глава ПЕРВАЯ → 1 (case insensitive)', () => {
      expect(extractChapterNumber('глава ПЕРВАЯ')).toBe(1);
    });
  });

  describe('Без числового указания → null', () => {
    it('Пролог → null (spine-based назначит позицию)', () => {
      expect(extractChapterNumber('Пролог')).toBeNull();
    });

    it('The Storm → null', () => {
      expect(extractChapterNumber('The Storm')).toBeNull();
    });
  });
});

// ============================================================================
// Тесты: getBodymatterSpineIndex (Шаг 3.3)
// ============================================================================

describe('getBodymatterSpineIndex', () => {
  it('EPUB 3 Landmarks: возвращает index spine item по bodymatter href', () => {
    const book = mockBook({
      landmarks: [{ type: 'bodymatter', href: 'ch1.xhtml' }],
      spineItems: [
        { index: 0, href: 'cover.xhtml' },
        { index: 1, href: 'ch1.xhtml' },
      ],
    });
    expect(getBodymatterSpineIndex(book as any)).toBe(1);
  });

  it('NCX gap (российский FB2-EPUB): toc[0] != spine[0] → index toc[0]', () => {
    const book = mockBook({
      landmarks: [],
      toc: [{ href: 'ch1.xhtml', label: 'Глава 1', subitems: [] }],
      spineItems: [
        { index: 0, href: 'cover.xhtml' },
        { index: 1, href: 'annotation.xhtml' },
        { index: 2, href: 'ch1.xhtml' },
      ],
    });
    expect(getBodymatterSpineIndex(book as any)).toBe(2);
  });

  it('NCX без gap: toc[0] == spine[0] → 0 (нет сервисных страниц)', () => {
    const book = mockBook({
      landmarks: [],
      toc: [{ href: 'ch1.xhtml', label: 'Глава 1', subitems: [] }],
      spineItems: [{ index: 0, href: 'ch1.xhtml' }],
    });
    expect(getBodymatterSpineIndex(book as any)).toBe(0);
  });

  it('Нет landmarks, нет toc → первый linear spine item (fallback)', () => {
    const book = mockBook({
      landmarks: [],
      toc: [],
      spineItems: [
        { index: 0, href: 'cover.xhtml' },
        { index: 1, href: 'ch1.xhtml' },
      ],
    });
    // spine.first() вернёт spine[0] → index = 0
    expect(getBodymatterSpineIndex(book as any)).toBe(0);
  });
});
