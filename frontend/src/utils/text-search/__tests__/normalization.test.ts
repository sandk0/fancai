import { describe, it, expect } from 'vitest';
import { buildIndexMap, mapNormalizedRange, normalizeText } from '../normalization';

describe('buildIndexMap', () => {
  it('maps indices for text with leading whitespace (trim offset)', () => {
    const original = '   hello world';
    const map = buildIndexMap(original);
    // After trim: "hello world" — 'h' at normalized idx 0 → original idx 3
    expect(map[0]).toBe(3); // 'h'
    expect(map[5]).toBe(8); // ' '
    expect(map[6]).toBe(9); // 'w'
  });

  it('maps indices for collapsed whitespace', () => {
    const original = 'hello   world';
    const map = buildIndexMap(original);
    // Normalized: "hello world" (length 11)
    // 'h'(0→0), 'e'(1→1), 'l'(2→2), 'l'(3→3), 'o'(4→4),
    // ' '(5→5 first space), 'w'(6→8), 'o'(7→9), 'r'(8→10), 'l'(9→11), 'd'(10→12)
    expect(map[0]).toBe(0);
    expect(map[5]).toBe(5); // space (first of the run)
    expect(map[6]).toBe(8); // 'w' — after 3-char space run
  });

  it('maps indices for NBSP characters', () => {
    const original = 'a\u00A0b';
    const map = buildIndexMap(original);
    // NBSP is \s, so treated as whitespace
    // Normalized: "a b" — a(0→0), ' '(1→1), b(2→2)
    expect(map[0]).toBe(0);
    expect(map[1]).toBe(1);
    expect(map[2]).toBe(2);
  });

  it('maps indices for text with fancy quotes (1:1 replacement)', () => {
    // «hello» — quotes are 1:1 with " so index map is straightforward
    const original = '«hello»';
    const map = buildIndexMap(original);
    // No whitespace transformations, so map is identity
    expect(map.length).toBe(original.length);
    expect(map[0]).toBe(0); // «
    expect(map[6]).toBe(6); // »
  });

  it('maps indices for em dash (1:1 replacement)', () => {
    const original = 'a\u2014b';
    const map = buildIndexMap(original);
    // Em dash is non-whitespace, no index shift
    expect(map.length).toBe(3);
    expect(map[0]).toBe(0);
    expect(map[1]).toBe(1);
    expect(map[2]).toBe(2);
  });

  it('handles combination: leading whitespace + collapsed spaces + NBSP', () => {
    const original = '  hello\u00A0\u00A0 world  ';
    const map = buildIndexMap(original);
    // Leading "  " skipped (trim)
    // 'h' at idx 2, then ello at 3-5
    // Then \u00A0\u00A0\s → collapsed to single space
    // Then "world" at idx 10-14
    // Trailing "  " trimmed (matches normalizeText trim behavior)
    // Normalized: "hello world" (length 11)
    expect(map[0]).toBe(2); // 'h'
    expect(map[5]).toBe(7); // first NBSP of run → single space
    expect(map[6]).toBe(10); // 'w'
    expect(map.length).toBe(11);
  });

  it('returns empty map for empty string', () => {
    expect(buildIndexMap('')).toEqual([]);
  });

  it('returns empty map for whitespace-only string', () => {
    expect(buildIndexMap('   ')).toEqual([]);
  });
});

describe('mapNormalizedRange', () => {
  it('maps a range in the middle of text', () => {
    const original = 'hello   world';
    const indexMap = buildIndexMap(original);
    // Normalized: "hello world" — "world" is at indices 6-10
    const { startIdx, endIdx } = mapNormalizedRange(indexMap, original, 6, 11);
    expect(original.substring(startIdx, endIdx)).toBe('world');
  });

  it('maps full range for simple text', () => {
    const original = 'hello world';
    const indexMap = buildIndexMap(original);
    const { startIdx, endIdx } = mapNormalizedRange(indexMap, original, 0, 11);
    expect(startIdx).toBe(0);
    expect(endIdx).toBe(11);
    expect(original.substring(startIdx, endIdx)).toBe('hello world');
  });

  it('handles out-of-bounds range gracefully', () => {
    const original = 'short';
    const indexMap = buildIndexMap(original);
    const { startIdx, endIdx } = mapNormalizedRange(indexMap, original, 10, 20);
    expect(startIdx).toBe(original.length);
    expect(endIdx).toBe(original.length);
  });

  it('maps range with leading whitespace offset', () => {
    const original = '   abc';
    const indexMap = buildIndexMap(original);
    // Normalized: "abc" — 'a' at normalized idx 0 → original idx 3
    const { startIdx, endIdx } = mapNormalizedRange(indexMap, original, 0, 3);
    expect(original.substring(startIdx, endIdx)).toBe('abc');
  });

  it('maps range across collapsed whitespace', () => {
    const original = 'a    b';
    const indexMap = buildIndexMap(original);
    // Normalized: "a b" — range [0, 3) should cover from 'a' to after 'b'
    const { startIdx, endIdx } = mapNormalizedRange(indexMap, original, 0, 3);
    expect(startIdx).toBe(0);
    expect(endIdx).toBe(6);
    expect(original.substring(startIdx, endIdx)).toBe('a    b');
  });
});

describe('normalizeText special characters', () => {
  it('removes soft hyphen', () => {
    expect(normalizeText('hel\u00ADlo')).toBe('hello');
  });

  it('removes zero-width space', () => {
    expect(normalizeText('hel\u200Blo')).toBe('hello');
  });

  it('replaces non-breaking hyphen with regular hyphen', () => {
    expect(normalizeText('well\u2011known')).toBe('well-known');
  });

  it('replaces ellipsis with three dots', () => {
    expect(normalizeText('wait\u2026')).toBe('wait...');
  });

  it('handles multiple special chars together', () => {
    expect(normalizeText('Он\u00AD шёл\u200B по\u00A0улице\u2026')).toBe('Он шёл по улице...');
  });
});

describe('buildIndexMap special characters', () => {
  it('skips soft hyphen (N:0 — removed char)', () => {
    const original = 'hel\u00ADlo';
    const map = buildIndexMap(original);
    const normalized = normalizeText(original);
    // normalized: "hello" (length 5)
    // h(0->0), e(1->1), l(2->2), \u00AD skipped, l(3->4), o(4->5) -- wait, original is "hel\u00ADlo"
    // original indices: h=0, e=1, l=2, \u00AD=3, l=4, o=5
    // normalized: "hello" = h(0), e(1), l(2), l(3), o(4)
    // map: [0, 1, 2, 4, 5]
    expect(map.length).toBe(normalized.length);
    expect(map[0]).toBe(0); // h
    expect(map[3]).toBe(4); // l (after soft hyphen)
    expect(map[4]).toBe(5); // o
  });

  it('skips zero-width space (N:0 — removed char)', () => {
    const original = 'ab\u200Bcd';
    const map = buildIndexMap(original);
    const normalized = normalizeText(original);
    // normalized: "abcd" (length 4)
    // map: [0, 1, 3, 4]
    expect(map.length).toBe(normalized.length);
    expect(map[0]).toBe(0); // a
    expect(map[1]).toBe(1); // b
    expect(map[2]).toBe(3); // c (after ZWS)
    expect(map[3]).toBe(4); // d
  });

  it('handles non-breaking hyphen as 1:1 replacement', () => {
    const original = 'a\u2011b';
    const map = buildIndexMap(original);
    const normalized = normalizeText(original);
    // normalized: "a-b" (length 3)
    expect(map.length).toBe(normalized.length);
    expect(map[0]).toBe(0);
    expect(map[1]).toBe(1); // \u2011 position
    expect(map[2]).toBe(2);
  });

  it('handles ellipsis as 1:3 expansion', () => {
    const original = 'end\u2026';
    const map = buildIndexMap(original);
    const normalized = normalizeText(original);
    // normalized: "end..." (length 6)
    // e(0->0), n(1->1), d(2->2), .(3->3), .(4->3), .(5->3)
    expect(map.length).toBe(normalized.length);
    expect(map.length).toBe(6);
    expect(map[3]).toBe(3); // first dot -> ellipsis position
    expect(map[4]).toBe(3); // second dot -> same position
    expect(map[5]).toBe(3); // third dot -> same position
  });
});

describe('round-trip special characters', () => {
  /** Helper: normalize text, find substring in normalized, map back to original */
  const roundTrip = (original: string, searchInNormalized: string) => {
    const normalized = normalizeText(original);
    const indexMap = buildIndexMap(original);
    expect(indexMap.length).toBe(normalized.length);
    const start = normalized.indexOf(searchInNormalized);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = start + searchInNormalized.length;
    const { startIdx, endIdx } = mapNormalizedRange(indexMap, original, start, end);
    return original.substring(startIdx, endIdx);
  };

  it('round-trip with soft hyphen', () => {
    const original = 'при\u00ADмер текста';
    // normalized: "пример текста", searching "пример"
    expect(roundTrip(original, 'пример')).toBe('при\u00ADмер');
  });

  it('round-trip with zero-width space', () => {
    const original = 'сло\u200Bво';
    // normalized: "слово", searching "слово"
    expect(roundTrip(original, 'слово')).toBe('сло\u200Bво');
  });

  it('round-trip with non-breaking hyphen', () => {
    const original = 'кое\u2011что';
    // normalized: "кое-что", searching "кое-что"
    expect(roundTrip(original, 'кое-что')).toBe('кое\u2011что');
  });

  it('round-trip with ellipsis', () => {
    const original = 'ждал\u2026 долго';
    // normalized: "ждал... долго", searching "ждал..."
    expect(roundTrip(original, 'ждал...')).toBe('ждал\u2026');
  });

  it('round-trip with mixed special characters', () => {
    const original = 'Он\u00AD шёл\u200B по\u00A0улице\u2026';
    // normalized: "Он шёл по улице..."
    expect(roundTrip(original, 'шёл')).toBe('шёл');
    expect(roundTrip(original, 'улице...')).toBe('улице\u2026');
  });

  it('round-trip preserves original text exactly for all special chars', () => {
    const original = 'Пре\u00ADкрас\u00ADный\u200B день\u2026 Всё\u2011таки';
    const normalized = normalizeText(original);
    const indexMap = buildIndexMap(original);
    // Full round-trip: entire normalized text maps back to entire original
    const { startIdx, endIdx } = mapNormalizedRange(indexMap, original, 0, normalized.length);
    expect(original.substring(startIdx, endIdx)).toBe(original);
  });
});

describe('normalizeText + buildIndexMap round-trip', () => {
  it('normalized text length matches indexMap length for simple text', () => {
    const original = 'hello world';
    const normalized = normalizeText(original);
    const indexMap = buildIndexMap(original);
    expect(indexMap.length).toBe(normalized.length);
  });

  it('normalized text length matches indexMap length for complex text', () => {
    const original = '  «Привет»   мир\u00A0\u2014\u00A0друг  ';
    const normalized = normalizeText(original);
    const indexMap = buildIndexMap(original);
    expect(indexMap.length).toBe(normalized.length);
  });

  it('normalized text length matches indexMap length with special chars', () => {
    const original = 'soft\u00ADhyphen zero\u200Bwidth nb\u2011hyphen ellipsis\u2026';
    const normalized = normalizeText(original);
    const indexMap = buildIndexMap(original);
    expect(indexMap.length).toBe(normalized.length);
  });
});
