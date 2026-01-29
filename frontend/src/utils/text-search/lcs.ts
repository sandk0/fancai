/**
 * Find longest common substring between two texts (OPTIMIZED)
 * Uses dynamic programming with 1D array to reduce memory usage from O(N*M) to O(M)
 * Early exit optimization for performance
 */
export const findLCS = (str1: string, str2: string): string => {
  if (!str1 || !str2) return '';

  // Optimization: Ensure str1 is the shorter string to minimize array size
  if (str1.length > str2.length) {
    [str1, str2] = [str2, str1];
  }

  const minLength = str1.length;
  const maxLength = str2.length;

  // Pre-check: If lengths differ too much, full match is impossible
  // But for partial matching we proceed
  if (minLength === 0) return '';

  // Use 1D array for DP table (current row)
  // We only need previous row values, but 1D array with careful iteration works too
  // Actually, standard LCS needs O(N*M) time. We want Longest Common Substring (continuous).
  
  // Standard DP approach for Longest Common Substring:
  // dp[i][j] = dp[i-1][j-1] + 1 if chars match
  // We can optimize space to O(M) using two rows or one row
  
  let maxLen = 0;
  let endPos = 0; // End position in str1
  
  // Previous row of DP table
  let prevRow = new Int32Array(maxLength + 1);
  // Current row of DP table
  let currRow = new Int32Array(maxLength + 1);

  for (let i = 1; i <= minLength; i++) {
    for (let j = 1; j <= maxLength; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        currRow[j] = prevRow[j - 1] + 1;
        if (currRow[j] > maxLen) {
          maxLen = currRow[j];
          endPos = i;
        }
      } else {
        currRow[j] = 0;
      }
    }
    // Swap rows for next iteration (curr becomes prev, prev is reused)
    [prevRow, currRow] = [currRow, prevRow];
  }

  if (maxLen === 0) return '';
  return str1.substring(endPos - maxLen, endPos);
};
