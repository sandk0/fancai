/**
 * Exponential Backoff Retry Utility
 *
 * Provides configurable retry logic with exponential backoff and jitter
 * for resilient API calls and async operations.
 *
 * Features:
 * - Configurable max retries, delays, and backoff factor
 * - Optional jitter to prevent thundering herd problem
 * - Type-safe with generics
 * - Integration helpers for TanStack Query
 *
 * @module utils/retryWithBackoff
 */

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay in milliseconds before first retry (default: 1000) */
  initialDelayMs: number;
  /** Maximum delay cap in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffFactor: number;
  /** Whether to add random jitter to prevent thundering herd (default: true) */
  jitter: boolean;
  /** Optional function to determine if an error is retryable */
  isRetryable?: (error: unknown) => boolean;
  /** Optional callback for retry events (logging, metrics) */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
  jitter: true,
};

/**
 * Preset configurations for common use cases
 */
export const RETRY_PRESETS = {
  /** For API calls - moderate retry with jitter */
  api: {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    backoffFactor: 2,
    jitter: true,
  } as RetryConfig,

  /** For image generation - longer delays, more retries */
  imageGeneration: {
    maxRetries: 4,
    initialDelayMs: 2000,
    maxDelayMs: 60000,
    backoffFactor: 2,
    jitter: true,
  } as RetryConfig,

  /** For description extraction - quick retries */
  descriptionExtraction: {
    maxRetries: 3,
    initialDelayMs: 500,
    maxDelayMs: 5000,
    backoffFactor: 2,
    jitter: true,
  } as RetryConfig,

  /** Aggressive retry for critical operations */
  critical: {
    maxRetries: 5,
    initialDelayMs: 500,
    maxDelayMs: 30000,
    backoffFactor: 2,
    jitter: true,
  } as RetryConfig,

  /** Fast fail for non-critical operations */
  fast: {
    maxRetries: 2,
    initialDelayMs: 300,
    maxDelayMs: 3000,
    backoffFactor: 1.5,
    jitter: true,
  } as RetryConfig,
} as const;

/**
 * Error types that are typically retryable
 */
const RETRYABLE_STATUS_CODES = new Set([
  408, // Request Timeout
  409, // Conflict (LLM extraction in progress - retry after delay)
  429, // Too Many Requests (Rate Limited)
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

/**
 * Network error messages that indicate retryable failures
 */
const RETRYABLE_ERROR_PATTERNS = [
  'network',
  'timeout',
  'econnreset',
  'econnrefused',
  'socket hang up',
  'fetch failed',
  'failed to fetch',
  'load failed',
];

/**
 * Default function to determine if an error is retryable
 *
 * @param error - The error to check
 * @returns true if the error should trigger a retry
 */
export function isRetryableError(error: unknown): boolean {
  // Handle fetch Response errors
  if (error instanceof Response) {
    return RETRYABLE_STATUS_CODES.has(error.status);
  }

  // Handle axios errors (error.response.status)
  if (error && typeof error === 'object' && 'response' in error) {
    const axiosError = error as { response?: { status?: number } };
    if (axiosError.response?.status) {
      return RETRYABLE_STATUS_CODES.has(axiosError.response.status);
    }
  }

  // Handle errors with direct status code
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: number }).status;
    return RETRYABLE_STATUS_CODES.has(status);
  }

  // Handle network errors by message
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return RETRYABLE_ERROR_PATTERNS.some((pattern) =>
      message.includes(pattern)
    );
  }

  // Handle string errors
  if (typeof error === 'string') {
    const message = error.toLowerCase();
    return RETRYABLE_ERROR_PATTERNS.some((pattern) =>
      message.includes(pattern)
    );
  }

  // Default: don't retry unknown errors
  return false;
}

/**
 * Calculate delay with exponential backoff
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig
): number {
  // Exponential delay: initialDelay * (factor ^ attempt)
  const exponentialDelay =
    config.initialDelayMs * Math.pow(config.backoffFactor, attempt);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter if enabled (0-50% random variation)
  if (config.jitter) {
    const jitterFactor = 0.5 * Math.random(); // 0 to 0.5
    const jitter = cappedDelay * jitterFactor;
    return Math.floor(cappedDelay + jitter);
  }

  return Math.floor(cappedDelay);
}

/**
 * Sleep for a specified duration
 *
 * @param ms - Duration in milliseconds
 * @returns Promise that resolves after the delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with exponential backoff retry logic
 *
 * @param fn - The async function to execute
 * @param config - Retry configuration (optional, uses defaults)
 * @returns Promise with the result of the function
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const result = await retryWithBackoff(
 *   () => fetch('/api/data').then(r => r.json())
 * );
 *
 * // With custom configuration
 * const result = await retryWithBackoff(
 *   () => generateImage(descriptionId),
 *   {
 *     maxRetries: 5,
 *     initialDelayMs: 2000,
 *     maxDelayMs: 60000,
 *     backoffFactor: 2,
 *     jitter: true,
 *     onRetry: (attempt, error, delay) => {
 *       logger.debug(`Retry ${attempt} after ${delay}ms: ${error}`);
 *     }
 *   }
 * );
 *
 * // Using presets
 * const result = await retryWithBackoff(
 *   () => fetchDescriptions(chapterId),
 *   RETRY_PRESETS.descriptionExtraction
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const { maxRetries, isRetryable = isRetryableError, onRetry } = fullConfig;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we've exhausted retries
      if (attempt >= maxRetries) {
        break;
      }

      // Check if the error is retryable
      if (!isRetryable(error)) {
        throw error;
      }

      // Calculate delay
      const delayMs = calculateBackoffDelay(attempt, fullConfig);

      // Notify retry callback
      if (onRetry) {
        onRetry(attempt + 1, error, delayMs);
      }

      // Wait before retry
      await sleep(delayMs);
    }
  }

  // All retries exhausted
  throw lastError;
}

/**
 * Create a TanStack Query retry function with exponential backoff
 *
 * This creates a retry function compatible with TanStack Query's retry option,
 * which expects (failureCount, error) => boolean | number
 *
 * @param config - Retry configuration (optional)
 * @returns A retry function for TanStack Query
 *
 * @example
 * ```typescript
 * // In TanStack Query options
 * const { data } = useQuery({
 *   queryKey: ['images', bookId],
 *   queryFn: () => fetchImages(bookId),
 *   retry: createTanStackRetry(RETRY_PRESETS.api),
 * });
 * ```
 */
export function createTanStackRetry(
  config: Partial<RetryConfig> = {}
): (failureCount: number, error: unknown) => boolean {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const { maxRetries, isRetryable = isRetryableError } = fullConfig;

  return (failureCount: number, error: unknown): boolean => {
    // Check if we've exceeded max retries
    if (failureCount >= maxRetries) {
      return false;
    }

    // Check if error is retryable
    return isRetryable(error);
  };
}

/**
 * Create a TanStack Query retryDelay function with exponential backoff
 *
 * @param config - Retry configuration (optional)
 * @returns A retryDelay function for TanStack Query
 *
 * @example
 * ```typescript
 * // In TanStack Query options
 * const { data } = useQuery({
 *   queryKey: ['images', bookId],
 *   queryFn: () => fetchImages(bookId),
 *   retry: createTanStackRetry(RETRY_PRESETS.api),
 *   retryDelay: createTanStackRetryDelay(RETRY_PRESETS.api),
 * });
 * ```
 */
export function createTanStackRetryDelay(
  config: Partial<RetryConfig> = {}
): (attemptIndex: number, error: unknown) => number {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };

  return (attemptIndex: number, _error: unknown): number => {
    return calculateBackoffDelay(attemptIndex, fullConfig);
  };
}

/**
 * Pre-configured TanStack Query retry options
 *
 * Use these with spread operator in query options:
 *
 * @example
 * ```typescript
 * const { data } = useQuery({
 *   queryKey: ['images', bookId],
 *   queryFn: () => fetchImages(bookId),
 *   ...TANSTACK_RETRY_OPTIONS.api,
 * });
 * ```
 */
export const TANSTACK_RETRY_OPTIONS = {
  api: {
    retry: createTanStackRetry(RETRY_PRESETS.api),
    retryDelay: createTanStackRetryDelay(RETRY_PRESETS.api),
  },
  imageGeneration: {
    retry: createTanStackRetry(RETRY_PRESETS.imageGeneration),
    retryDelay: createTanStackRetryDelay(RETRY_PRESETS.imageGeneration),
  },
  descriptionExtraction: {
    retry: createTanStackRetry(RETRY_PRESETS.descriptionExtraction),
    retryDelay: createTanStackRetryDelay(RETRY_PRESETS.descriptionExtraction),
  },
  critical: {
    retry: createTanStackRetry(RETRY_PRESETS.critical),
    retryDelay: createTanStackRetryDelay(RETRY_PRESETS.critical),
  },
  fast: {
    retry: createTanStackRetry(RETRY_PRESETS.fast),
    retryDelay: createTanStackRetryDelay(RETRY_PRESETS.fast),
  },
} as const;

/**
 * Wrap an async function with retry logic
 *
 * Creates a new function that automatically retries on failure.
 *
 * @param fn - The async function to wrap
 * @param config - Retry configuration (optional)
 * @returns A new function with retry logic built in
 *
 * @example
 * ```typescript
 * const fetchWithRetry = withRetry(
 *   async (url: string) => {
 *     const response = await fetch(url);
 *     if (!response.ok) throw response;
 *     return response.json();
 *   },
 *   RETRY_PRESETS.api
 * );
 *
 * // Now automatically retries on failure
 * const data = await fetchWithRetry('/api/data');
 * ```
 */
export function withRetry<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  config: Partial<RetryConfig> = {}
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => retryWithBackoff(() => fn(...args), config);
}

/**
 * Execute multiple async operations with individual retry logic
 *
 * Unlike Promise.all, this continues even if some operations fail.
 * Each operation gets its own retry attempts.
 *
 * @param operations - Array of async functions to execute
 * @param config - Retry configuration (optional)
 * @returns Array of results (PromiseSettledResult format)
 *
 * @example
 * ```typescript
 * const results = await retryAllSettled(
 *   [
 *     () => fetchImage(id1),
 *     () => fetchImage(id2),
 *     () => fetchImage(id3),
 *   ],
 *   RETRY_PRESETS.imageGeneration
 * );
 *
 * const successful = results
 *   .filter((r) => r.status === 'fulfilled')
 *   .map((r) => r.value);
 * ```
 */
export async function retryAllSettled<T>(
  operations: Array<() => Promise<T>>,
  config: Partial<RetryConfig> = {}
): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(
    operations.map((op) => retryWithBackoff(op, config))
  );
}
