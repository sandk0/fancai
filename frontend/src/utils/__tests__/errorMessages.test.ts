import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock i18n before importing the module
vi.mock('@/lib/i18n', () => ({
  default: {
    t: (key: string) => {
      const translations: Record<string, string> = {
        'errors.ai_overloaded': 'AI-сервис временно перегружен. Попробуйте через несколько минут.',
        'errors.server_unavailable': 'Сервер временно недоступен. Попробуйте позже.',
        'errors.rate_limit': 'Слишком много запросов. Подождите немного.',
        'errors.network': 'Проверьте подключение к интернету и попробуйте снова.',
        'errors.timeout': 'Время ожидания истекло. Попробуйте повторить.',
        'errors.not_found': 'Запрашиваемый ресурс не найден.',
        'errors.unauthorized': 'Сессия истекла. Войдите снова.',
        'errors.forbidden': 'Доступ запрещён.',
        'errors.format_error': 'Ошибка формата книги. Попробуйте загрузить другой файл.',
        'errors.unknown': 'Произошла непредвиденная ошибка. Попробуйте обновить страницу.',
        'errors.service_unavailable': 'Сервис временно недоступен. Попробуйте позже.',
      };
      return translations[key] || key;
    },
  },
}));

import { mapApiError } from '../errorMessages';
import type { ErrorMapping } from '../errorMessages';

describe('mapApiError', () => {
  describe('Axios-style errors with response', () => {
    it('should map CircuitBreaker 503 to AI overloaded message with isRetryable=false', () => {
      const error = {
        response: {
          status: 503,
          data: { detail: 'circuit breaker open for gemini_extractor' },
        },
      };

      const result: ErrorMapping = mapApiError(error);

      expect(result.message).toContain('AI-сервис временно перегружен');
      expect(result.isRetryable).toBe(false);
    });

    it('should map regular 503 to service unavailable with isRetryable=true', () => {
      const error = {
        response: {
          status: 503,
          data: { detail: 'service temporarily unavailable' },
        },
      };

      const result = mapApiError(error);

      expect(result.message).toContain('Сервис временно недоступен');
      expect(result.isRetryable).toBe(true);
    });

    it('should map 429 rate limit with isRetryable=true', () => {
      const error = {
        response: {
          status: 429,
          data: {},
        },
      };

      const result = mapApiError(error);

      expect(result.message).toContain('Слишком много запросов');
      expect(result.isRetryable).toBe(true);
    });

    it('should map 500 server error with isRetryable=true', () => {
      const error = {
        response: {
          status: 500,
          data: {},
        },
      };

      const result = mapApiError(error);

      expect(result.message).toContain('Сервер временно недоступен');
      expect(result.isRetryable).toBe(true);
    });

    it('should map 502 as server unavailable with isRetryable=true', () => {
      const error = {
        response: {
          status: 502,
          data: {},
        },
      };

      const result = mapApiError(error);

      expect(result.message).toContain('Сервер временно недоступен');
      expect(result.isRetryable).toBe(true);
    });

    it('should map 404 not found with isRetryable=false', () => {
      const error = {
        response: {
          status: 404,
          data: {},
        },
      };

      const result = mapApiError(error);

      expect(result.message).toContain('не найден');
      expect(result.isRetryable).toBe(false);
    });

    it('should map 401 unauthorized with isRetryable=false', () => {
      const error = {
        response: {
          status: 401,
          data: {},
        },
      };

      const result = mapApiError(error);

      expect(result.message).toContain('Сессия истекла');
      expect(result.isRetryable).toBe(false);
    });

    it('should map 403 forbidden with isRetryable=false', () => {
      const error = {
        response: {
          status: 403,
          data: {},
        },
      };

      const result = mapApiError(error);

      expect(result.message).toContain('Доступ запрещён');
      expect(result.isRetryable).toBe(false);
    });
  });

  describe('Error objects', () => {
    it('should map network error with isRetryable=true', () => {
      const error = new Error('network error');

      const result = mapApiError(error);

      expect(result.message).toContain('подключение к интернету');
      expect(result.isRetryable).toBe(true);
    });

    it('should map "Failed to fetch" as network error', () => {
      const error = new Error('Failed to fetch');

      const result = mapApiError(error);

      expect(result.message).toContain('подключение к интернету');
      expect(result.isRetryable).toBe(true);
    });

    it('should map timeout error with isRetryable=true', () => {
      const error = new Error('timeout of 30000ms exceeded');

      const result = mapApiError(error);

      expect(result.message).toContain('Время ожидания истекло');
      expect(result.isRetryable).toBe(true);
    });

    it('should map epub/parse error to format error', () => {
      const error = new Error('epub parse failure');

      const result = mapApiError(error);

      expect(result.message).toContain('формата книги');
      expect(result.isRetryable).toBe(false);
    });
  });

  describe('String errors (backward compat with getReadableError)', () => {
    it('should map "404 not found" string', () => {
      const result = mapApiError('404 not found');

      expect(result.message).toContain('не найден');
      expect(result.isRetryable).toBe(false);
    });

    it('should map "network" string', () => {
      const result = mapApiError('network error occurred');

      expect(result.message).toContain('подключение к интернету');
      expect(result.isRetryable).toBe(true);
    });

    it('should map "500" string as server error', () => {
      const result = mapApiError('500 internal server error');

      expect(result.message).toContain('Сервер временно недоступен');
      expect(result.isRetryable).toBe(true);
    });

    it('should map "401" string as unauthorized', () => {
      const result = mapApiError('401 unauthorized');

      expect(result.message).toContain('Сессия истекла');
      expect(result.isRetryable).toBe(false);
    });

    it('should map "403" string as forbidden', () => {
      const result = mapApiError('403 forbidden');

      expect(result.message).toContain('Доступ запрещён');
      expect(result.isRetryable).toBe(false);
    });

    it('should map "timeout" string', () => {
      const result = mapApiError('request timeout');

      expect(result.message).toContain('Время ожидания истекло');
      expect(result.isRetryable).toBe(true);
    });

    it('should map "epub" string to format error', () => {
      const result = mapApiError('epub format error');

      expect(result.message).toContain('формата книги');
      expect(result.isRetryable).toBe(false);
    });
  });

  describe('Unknown/fallback errors', () => {
    it('should handle unknown error type with fallback', () => {
      const result = mapApiError(42);

      expect(result.message).toContain('непредвиденная ошибка');
      expect(result.isRetryable).toBe(true);
    });

    it('should handle null with fallback', () => {
      const result = mapApiError(null);

      expect(result.message).toContain('непредвиденная ошибка');
      expect(result.isRetryable).toBe(true);
    });

    it('should handle undefined with fallback', () => {
      const result = mapApiError(undefined);

      expect(result.message).toContain('непредвиденная ошибка');
      expect(result.isRetryable).toBe(true);
    });
  });
});
