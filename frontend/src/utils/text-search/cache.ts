export interface SearchPatterns {
  normalized: string;
  first40: string;
  skip10: string;
  skip20: string;
  firstWords: string;
  middleSection: string;
  firstSentence: string;
  original: string;
}

/**
 * Maximum cache size to prevent memory leaks
 * LRU-style eviction: removes oldest entry when limit is reached
 */
const MAX_CACHE_SIZE = 500;
const searchPatternsCache = new Map<string, SearchPatterns>();

/**
 * Add an entry to the search patterns cache with size limit enforcement
 * Uses LRU-style eviction (removes oldest/first entry when full)
 *
 * @param key - Description ID
 * @param value - Preprocessed search patterns
 */
export function addToCache(key: string, value: SearchPatterns): void {
  if (searchPatternsCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry (first key in Map iteration order)
    const firstKey = searchPatternsCache.keys().next().value;
    if (firstKey) {
      searchPatternsCache.delete(firstKey);
    }
  }
  searchPatternsCache.set(key, value);
}

export function getFromCache(key: string): SearchPatterns | undefined {
  return searchPatternsCache.get(key);
}
