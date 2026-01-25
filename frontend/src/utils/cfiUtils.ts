/**
 * CFI (Canonical Fragment Identifier) utilities for EPUB position comparison.
 * 
 * CFI Format: epubcfi(/6/4[chap01]!/4/2/1:0)
 * - /6/4 = spine position
 * - ! = separator between spine and content
 * - /4/2/1 = DOM path
 * - :0 = character offset
 * - [chap01] = optional ID assertion
 */

interface ParsedCFI {
  spinePath: number[];
  contentPath: number[];
  charOffset: number;
  valid: boolean;
}

const parseCFI = (cfi: string): ParsedCFI => {
  const invalid: ParsedCFI = { spinePath: [], contentPath: [], charOffset: 0, valid: false };
  
  if (!cfi || typeof cfi !== 'string') return invalid;
  
  const match = cfi.match(/^epubcfi\((.+)\)$/);
  if (!match) return invalid;
  
  const inner = match[1];
  const parts = inner.split('!');
  
  const extractNumbers = (path: string): number[] => {
    const nums: number[] = [];
    const segments = path.split('/').filter(Boolean);
    
    for (const seg of segments) {
      const numMatch = seg.match(/^(\d+)/);
      if (numMatch) {
        nums.push(parseInt(numMatch[1], 10));
      }
    }
    return nums;
  };
  
  const extractCharOffset = (path: string): number => {
    const offsetMatch = path.match(/:(\d+)(?:\)|$)/);
    return offsetMatch ? parseInt(offsetMatch[1], 10) : 0;
  };
  
  const spinePath = extractNumbers(parts[0] || '');
  const contentPart = parts[1] || '';
  const contentPath = extractNumbers(contentPart);
  const charOffset = extractCharOffset(contentPart);
  
  return {
    spinePath,
    contentPath,
    charOffset,
    valid: spinePath.length > 0
  };
};

const compareArrays = (a: number[], b: number[]): number => {
  const maxLen = Math.max(a.length, b.length);
  
  for (let i = 0; i < maxLen; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    
    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
  }
  
  return 0;
};

export const compareCFI = (a: string, b: string): number => {
  const parsedA = parseCFI(a);
  const parsedB = parseCFI(b);
  
  if (!parsedA.valid && !parsedB.valid) return 0;
  if (!parsedA.valid) return 1;
  if (!parsedB.valid) return -1;
  
  const spineCompare = compareArrays(parsedA.spinePath, parsedB.spinePath);
  if (spineCompare !== 0) return spineCompare;
  
  const contentCompare = compareArrays(parsedA.contentPath, parsedB.contentPath);
  if (contentCompare !== 0) return contentCompare;
  
  if (parsedA.charOffset < parsedB.charOffset) return -1;
  if (parsedA.charOffset > parsedB.charOffset) return 1;
  
  return 0;
};

export const isValidCFI = (cfi: string | null | undefined): cfi is string => {
  if (!cfi || typeof cfi !== 'string') return false;
  return /^epubcfi\([^)]+\)$/.test(cfi) && cfi.length >= 15;
};

export const isCFIBefore = (cfi: string, currentCFI: string): boolean => {
  return compareCFI(cfi, currentCFI) <= 0;
};

export const isCFIAfter = (cfi: string, currentCFI: string): boolean => {
  return compareCFI(cfi, currentCFI) > 0;
};
