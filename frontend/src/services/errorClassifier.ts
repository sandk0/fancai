/**
 * Error Classification Service (January 2026)
 *
 * Centralizes error handling logic to provide consistent user feedback and observability.
 * Maps raw errors (Axios/Fetch/JS) to structured categories with actionable metadata.
 *
 * Categories:
 * - NETWORK: Connection issues (retryable)
 * - AUTH: 401/403 (requires login)
 * - VALIDATION: 400 (user input issue)
 * - CONFLICT: 409 (data race)
 * - SERVER: 500+ (backend issue)
 * - CLIENT: JS exceptions (bug)
 *
 * @module services/errorClassifier
 */

export enum ErrorCategory {
  NETWORK = 'network',
  AUTH = 'auth',
  VALIDATION = 'validation',
  CONFLICT = 'conflict',
  SERVER = 'server',
  CLIENT = 'client',
  UNKNOWN = 'unknown',
}

export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  originalError: any;
  isRecoverable: boolean;
  shouldRetry: boolean;
  shouldNotifyUser: boolean;
  userMessage?: string;
  statusCode?: number;
}

/**
 * Classify any error into a structured format
 */
export function classifyError(error: any): ClassifiedError {
  // Network errors (Axios or Fetch)
  if (error.code === 'ERR_NETWORK' || error.message?.includes('Network') || error.name === 'TypeError' && error.message.includes('fetch')) {
    return {
      category: ErrorCategory.NETWORK,
      message: 'Network error',
      originalError: error,
      isRecoverable: true,
      shouldRetry: true,
      shouldNotifyUser: true,
      userMessage: 'Ошибка сети. Повторная попытка...',
    };
  }

  // Axios HTTP errors
  const status = error?.response?.status;
  const detail = error?.response?.data?.detail;
  
  if (status) {
    // Auth errors
    if (status === 401 || status === 403) {
      return {
        category: ErrorCategory.AUTH,
        message: 'Authentication failed',
        originalError: error,
        isRecoverable: false,
        shouldRetry: false,
        shouldNotifyUser: true,
        userMessage: 'Сессия истекла. Пожалуйста, войдите снова.',
        statusCode: status,
      };
    }

    // Validation errors
    if (status === 400) {
      // Check for specific session errors
      const isSessionError = typeof detail === 'string' && (detail.includes('inactive') || detail.includes('ended'));
      
      return {
        category: ErrorCategory.VALIDATION,
        message: typeof detail === 'string' ? detail : 'Validation error',
        originalError: error,
        isRecoverable: isSessionError, // Session errors are recoverable via restart
        shouldRetry: false,
        shouldNotifyUser: true,
        userMessage: typeof detail === 'string' ? detail : 'Ошибка валидации данных.',
        statusCode: status,
      };
    }

    // Conflict errors
    if (status === 409) {
      return {
        category: ErrorCategory.CONFLICT,
        message: 'Conflict detected',
        originalError: error,
        isRecoverable: true,
        shouldRetry: false,
        shouldNotifyUser: true,
        userMessage: typeof detail === 'object' ? detail.message : 'Обнаружен конфликт данных.',
        statusCode: status,
      };
    }

    // Server errors
    if (status >= 500) {
      return {
        category: ErrorCategory.SERVER,
        message: 'Server error',
        originalError: error,
        isRecoverable: true,
        shouldRetry: true,
        shouldNotifyUser: true,
        userMessage: 'Ошибка сервера. Мы уже работаем над этим.',
        statusCode: status,
      };
    }
  }

  // Client-side JS errors
  if (error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError) {
    return {
      category: ErrorCategory.CLIENT,
      message: error.message,
      originalError: error,
      isRecoverable: false,
      shouldRetry: false,
      shouldNotifyUser: true,
      userMessage: 'Произошла ошибка в приложении.',
    };
  }

  // Unknown errors
  return {
    category: ErrorCategory.UNKNOWN,
    message: String(error.message || error),
    originalError: error,
    isRecoverable: false,
    shouldRetry: false,
    shouldNotifyUser: true,
    userMessage: 'Произошла непредвиденная ошибка.',
  };
}
