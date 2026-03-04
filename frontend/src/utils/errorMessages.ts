import i18n from '@/lib/i18n';

/**
 * Centralized API error mapping utility.
 *
 * Converts unknown errors (Axios responses, Error objects, strings)
 * into user-friendly Russian messages via i18n keys.
 */

export interface ErrorMapping {
  /** User-facing localized error message */
  message: string;
  /** Optional action hint (e.g. "retry", "login") */
  action?: string;
  /** Whether the user should be offered a retry button */
  isRetryable: boolean;
}

interface AxiosLikeError {
  response?: {
    status?: number;
    data?: {
      detail?: string;
      message?: string;
    };
  };
  message?: string;
}

function isAxiosLikeError(error: unknown): error is AxiosLikeError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as AxiosLikeError).response === 'object'
  );
}

/**
 * Extract a lowercase string representation from any error type
 * for pattern matching (backward compat with getReadableError).
 */
function extractErrorString(error: unknown): string {
  if (typeof error === 'string') return error.toLowerCase();
  if (error instanceof Error) return error.message.toLowerCase();
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message.toLowerCase();
  }
  return '';
}

/**
 * Map an Axios-style response status to an ErrorMapping.
 */
function mapByStatus(status: number, detail?: string): ErrorMapping {
  // CircuitBreaker: 503 + detail contains "circuit"
  if (status === 503 && detail && detail.toLowerCase().includes('circuit')) {
    return {
      message: i18n.t('errors.ai_overloaded'),
      isRetryable: false,
    };
  }

  // 503 without circuit breaker
  if (status === 503) {
    return {
      message: i18n.t('errors.service_unavailable'),
      isRetryable: true,
    };
  }

  // Rate limit
  if (status === 429) {
    return {
      message: i18n.t('errors.rate_limit'),
      isRetryable: true,
    };
  }

  // Not found
  if (status === 404) {
    return {
      message: i18n.t('errors.not_found'),
      isRetryable: false,
    };
  }

  // Unauthorized
  if (status === 401) {
    return {
      message: i18n.t('errors.unauthorized'),
      isRetryable: false,
    };
  }

  // Forbidden
  if (status === 403) {
    return {
      message: i18n.t('errors.forbidden'),
      isRetryable: false,
    };
  }

  // Server errors (500, 502, 504, etc.)
  if (status >= 500) {
    return {
      message: i18n.t('errors.server_unavailable'),
      isRetryable: true,
    };
  }

  // Fallback for other status codes
  return {
    message: i18n.t('errors.unknown'),
    isRetryable: true,
  };
}

/**
 * Map an error string (from Error.message or raw string) to an ErrorMapping.
 * Backward compatible with the old getReadableError logic.
 */
function mapByString(errorStr: string): ErrorMapping | null {
  if (errorStr.includes('network') || errorStr.includes('failed to fetch')) {
    return { message: i18n.t('errors.network'), isRetryable: true };
  }
  if (errorStr.includes('timeout')) {
    return { message: i18n.t('errors.timeout'), isRetryable: true };
  }
  if (errorStr.includes('epub') || errorStr.includes('parse')) {
    return { message: i18n.t('errors.format_error'), isRetryable: false };
  }
  if (errorStr.includes('404')) {
    return { message: i18n.t('errors.not_found'), isRetryable: false };
  }
  if (errorStr.includes('401')) {
    return { message: i18n.t('errors.unauthorized'), isRetryable: false };
  }
  if (errorStr.includes('403')) {
    return { message: i18n.t('errors.forbidden'), isRetryable: false };
  }
  if (errorStr.includes('500') || errorStr.includes('502') || errorStr.includes('503')) {
    return { message: i18n.t('errors.server_unavailable'), isRetryable: true };
  }
  if (errorStr.includes('429')) {
    return { message: i18n.t('errors.rate_limit'), isRetryable: true };
  }
  return null;
}

/**
 * Map any error type to a user-friendly ErrorMapping.
 *
 * Handles:
 * - Axios-style errors (error.response.status + data.detail)
 * - Error objects (error.message)
 * - Raw strings (backward compat with getReadableError)
 * - Unknown types (fallback)
 */
export function mapApiError(error: unknown): ErrorMapping {
  // 1. Axios-style errors with response object
  if (isAxiosLikeError(error) && error.response?.status) {
    const detail = error.response.data?.detail || error.response.data?.message;
    return mapByStatus(error.response.status, detail);
  }

  // 2. Try to extract a string and pattern-match
  const errorStr = extractErrorString(error);
  if (errorStr) {
    const mapped = mapByString(errorStr);
    if (mapped) return mapped;
  }

  // 3. Fallback
  return {
    message: i18n.t('errors.unknown'),
    isRetryable: true,
  };
}
