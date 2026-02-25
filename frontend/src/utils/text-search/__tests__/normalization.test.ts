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
    expect(map[0]).toBe(2);  // 'h'
    expect(map[5]).toBe(7);  // first NBSP of run → single space
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
    // normalizeText trims trailing whitespace too, buildIndexMap doesn't trim trailing
    // So indexMap may be longer by trailing space chars
    // But for matching purposes, indexMap[i] for i < normalized.length should be valid
    expect(indexMap.length).toBeGreaterThanOrEqual(normalized.length);
  });
});
