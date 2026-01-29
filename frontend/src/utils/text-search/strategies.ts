import { findLCS } from './lcs';
import type { SearchPatterns } from './cache';

type SearchStrategy = (
  text: string, 
  patterns: SearchPatterns, 
  contentLength: number
) => boolean;

/**
 * Strategy 1: First 40 characters (exact match)
 * Fastest, handles >80% of cases
 */
export const strategyFirst40: SearchStrategy = (text, patterns) => {
  return text.includes(patterns.first40);
};

/**
 * Strategy 2: Skip 10 chars, take next 40
 * Handles slight variations at the beginning (e.g. "Chapter 1" removed)
 */
export const strategySkip10: SearchStrategy = (text, patterns) => {
  return text.includes(patterns.skip10);
};

/**
 * Strategy 5: First 5 words match (fuzzy)
 * Handles cases where punctuation differs but words are same
 */
export const strategyFirstWords: SearchStrategy = (text, patterns) => {
  return text.includes(patterns.firstWords);
};

/**
 * Strategy 4: Full exact match (normalized)
 * Only feasible for short texts (<200 chars)
 */
export const strategyFullMatch: SearchStrategy = (text, patterns, contentLength) => {
  if (contentLength > 500) return false; // Skip for long texts
  return text.includes(patterns.normalized);
};

/**
 * Strategy 3: Skip 20, take next 60
 * Deeper check for problematic headers
 */
export const strategySkip20: SearchStrategy = (text, patterns) => {
  return text.includes(patterns.skip20);
};

/**
 * Strategy 7: Middle section match
 * Takes 50 chars from the middle of the description
 */
export const strategyMiddle: SearchStrategy = (text, patterns) => {
  return text.includes(patterns.middleSection);
};

/**
 * Strategy 9: First sentence match
 * Tries to match just the first sentence
 */
export const strategyFirstSentence: SearchStrategy = (text, patterns) => {
  return text.includes(patterns.firstSentence);
};

/**
 * Strategy 8: LCS (Longest Common Substring) Fuzzy Match
 * Slowest, used as last resort. Returns true if >70% overlap.
 */
export const strategyLCS: SearchStrategy = (text, patterns, contentLength) => {
  // Length check optimization: if difference > 50%, unlikely to match
  const patLen = patterns.normalized.length;
  if (Math.abs(contentLength - patLen) > Math.max(contentLength, patLen) * 0.5) {
    return false;
  }

  const common = findLCS(text, patterns.normalized);
  // Match if common substring covers significant portion of description
  return common.length > Math.min(50, patLen * 0.7);
};

// Export ordered list of strategies
export const strategies = [
  { name: 'S1_First40', fn: strategyFirst40 },
  { name: 'S2_Skip10', fn: strategySkip10 },
  { name: 'S5_FirstWords', fn: strategyFirstWords },
  { name: 'S4_FullMatch', fn: strategyFullMatch },
  { name: 'S3_Skip20', fn: strategySkip20 },
  { name: 'S7_Middle', fn: strategyMiddle },
  { name: 'S9_FirstSentence', fn: strategyFirstSentence },
  { name: 'S8_LCS', fn: strategyLCS },
];
