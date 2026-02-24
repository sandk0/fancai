import { describe, it, expect } from 'vitest';
import { strategies, strategyFirst40, strategyLCS, type StrategyResult } from '../strategies';
import type { SearchPatterns } from '../cache';

const makePatterns = (text: string): SearchPatterns => ({
  normalized: text,
  original: text,
  first40: text.substring(0, 40),
  skip10: text.substring(10, 50),
  skip20: text.substring(20, 80),
  firstWords: text.split(/\s+/).slice(0, 5).join(' '),
  middleSection: text.substring(Math.floor(text.length / 2) - 25, Math.floor(text.length / 2) + 25),
  firstSentence: text.split(/[.!?]/)[0],
});

describe('Position-aware strategies', () => {
  it('returns startIdx and endIdx for S1_First40', () => {
    const desc = 'библиотека занимала три этажа уставленных книгами от пола до потолка';
    const patterns = makePatterns(desc);
    const result: StrategyResult = strategyFirst40(desc, patterns, desc.length);
    expect(result.found).toBe(true);
    expect(result.startIdx).toBe(0);
    expect(result.endIdx).toBeGreaterThan(0);
  });

  it('returns found:false when no match', () => {
    const patterns = makePatterns('что-то совершенно другое и длинное для сорока символов минимум');
    const result = strategies[0].fn('текст без совпадений', patterns, 50);
    expect(result.found).toBe(false);
    expect(result.startIdx).toBeUndefined();
  });

  it('returns correct startIdx for mid-text match', () => {
    const desc = 'старый замок стоял на холме окутанный туманом и тишиной веков';
    const patterns = makePatterns(desc);
    const pageText = 'далеко от города ' + desc + ' а вокруг росли сосны';
    const result = strategies[0].fn(pageText, patterns, pageText.length);
    expect(result.found).toBe(true);
    expect(result.startIdx).toBe(17); // after "далеко от города "
    expect(pageText.substring(result.startIdx!, result.endIdx!)).toBe(patterns.first40);
  });

  it('all strategies return StrategyResult object', () => {
    const desc = 'простой текст для тестирования всех стратегий поиска описаний в книге';
    const patterns = makePatterns(desc);
    for (const s of strategies) {
      const result = s.fn(desc, patterns, desc.length);
      expect(typeof result.found).toBe('boolean');
      if (result.found) {
        expect(result.startIdx).toBeDefined();
        expect(result.endIdx).toBeDefined();
        expect(result.endIdx!).toBeGreaterThan(result.startIdx!);
      }
    }
  });

  it('LCS strategy returns position for fuzzy match', () => {
    const desc = 'короткий текст для теста лцс стратегии';
    const patterns = makePatterns(desc);
    // Slightly different text that shares a long common substring
    const similar = 'короткий текст для теста лцс стратегии с добавкой';
    const result = strategyLCS(similar, patterns, similar.length);
    expect(result.found).toBe(true);
    expect(result.startIdx).toBeDefined();
    expect(result.endIdx).toBeDefined();
  });
});
