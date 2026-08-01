import { Component, ErrorInfo, ReactNode } from 'react';
import { logger } from '@/lib/logger';
import { getHawk } from '@/config/hawk';
import i18n from '@/lib/i18n';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  level?: 'app' | 'page' | 'component';
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * ErrorBoundary - компонент для отлова и обработки ошибок в React дереве
 *
 * Поддерживает:
 * - Graceful error handling без краша всего приложения
 * - Красивый UI для error state
 * - Кнопка "Попробовать снова" для reset state
 * - Логирование ошибок в консоль/сервис
 * - Error details (stacktrace) в dev mode
 * - Разные уровни границ (app, page, component)
 *
 * @example
 * // App level - ловит все ошибки приложения
 * <ErrorBoundary level="app">
 *   <App />
 * </ErrorBoundary>
 *
 * @example
 * // Component level - локальная защита критичной секции
 * <ErrorBoundary
 *   level="component"
 *   fallback={<p>Не удалось загрузить книгу</p>}
 * >
 *   <EpubReader />
 * </ErrorBoundary>
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  /**
   * Обновляет state при возникновении ошибки
   */
  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  /**
   * Вызывается после того как ошибка была поймана
   * Используется для логирования и отправки в сервисы мониторинга
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { level = 'app', onError } = this.props;

    const errorDetails = {
      error: error.toString(),
      message: error.message,
      name: error.name,
      stack: error.stack?.substring(0, 2000), // Truncate stack to avoid localStorage overflow
      componentStack: errorInfo.componentStack?.substring(0, 2000),
      timestamp: new Date().toISOString(),
      level,
      url: window.location.href,
      userAgent: navigator.userAgent,
    };

    // Логируем с информацией об уровне границы
    logger.error(`[ErrorBoundary:${level}] Caught error:`, errorDetails);

    // Сохраняем ошибку в localStorage для PWA отладки
    // Это позволяет получить детали ошибки даже после перезагрузки
    try {
      const errorHistory = JSON.parse(localStorage.getItem('error_boundary_history') || '[]');
      errorHistory.unshift(errorDetails);
      // Храним только последние 5 ошибок
      localStorage.setItem('error_boundary_history', JSON.stringify(errorHistory.slice(0, 5)));
      localStorage.setItem('last_error_boundary_error', JSON.stringify(errorDetails));
    } catch {
      // Ignore localStorage errors
    }

    this.setState({
      error,
      errorInfo,
    });

    // Вызываем callback если передан
    if (onError) {
      onError(error, errorInfo);
    }

    // Отправка ошибки в Hawk Tracker
    const hawkInstance = getHawk();
    if (hawkInstance) {
      hawkInstance.send(error, {
        // @hawk.so/javascript 3.3.5 сузил тип контекста до
        // JsonNode = string | number | boolean | Json — ни null, ни undefined.
        componentStack: errorInfo.componentStack ?? '',
        level,
        url: window.location.href,
      });
    }
  }

  /**
   * Сброс error state и попытка повторного рендера
   */
  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    // Reload page для app-level границы (более надежный reset)
    if (this.props.level === 'app') {
      window.location.reload();
    }
  };

  /**
   * Возврат на главную страницу (для app-level)
   */
  handleGoHome = () => {
    window.location.href = '/';
  };

  render() {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback, level = 'app' } = this.props;

    if (hasError) {
      // Кастомный fallback UI если передан
      if (fallback) {
        return fallback;
      }

      // Разные UI для разных уровней
      const isAppLevel = level === 'app';
      const isPageLevel = level === 'page';

      return (
        <div
          className={`error-boundary-container bg-background text-foreground flex items-center justify-center p-8 ${
            isAppLevel ? 'min-h-screen' : ''
          }`}
        >
          <div
            className={`error-boundary-content w-full text-center ${
              isAppLevel ? 'max-w-[600px]' : 'max-w-full'
            }`}
          >
            {/* Error Icon */}
            <div className={`mb-6 ${isAppLevel ? 'text-6xl' : 'text-5xl'}`}>
              {isAppLevel ? '!' : '!'}
            </div>

            {/* Error Title */}
            <h1
              className={`font-bold mb-4 text-foreground ${isAppLevel ? 'text-3xl' : 'text-2xl'}`}
            >
              {isAppLevel && i18n.t('errorBoundary.app_title')}
              {isPageLevel && i18n.t('errorBoundary.page_title')}
              {!isAppLevel && !isPageLevel && i18n.t('errorBoundary.component_title')}
            </h1>

            {/* Error Message */}
            <p className="text-base mb-8 text-muted-foreground leading-relaxed">
              {isAppLevel && i18n.t('errorBoundary.app_message')}
              {isPageLevel && i18n.t('errorBoundary.page_message')}
              {!isAppLevel && !isPageLevel && i18n.t('errorBoundary.component_message')}
            </p>

            {/* Error Details - только в dev mode */}
            {import.meta.env.DEV && error && (
              <details className="mb-8 text-left bg-card border border-border rounded-lg p-4 overflow-auto">
                <summary className="cursor-pointer font-semibold mb-2 text-destructive">
                  Error details
                </summary>

                <div className="mt-4">
                  <p className="font-semibold mb-2 text-sm">Error:</p>
                  <pre className="bg-background p-3 rounded-sm text-xs overflow-auto border border-border mb-4">
                    {error.toString()}
                  </pre>

                  {error.message && error.message !== error.toString() && (
                    <>
                      <p className="font-semibold mb-2 text-sm">Message:</p>
                      <pre className="bg-background p-3 rounded-sm text-xs overflow-auto border border-border mb-4">
                        {error.message}
                      </pre>
                    </>
                  )}

                  {errorInfo?.componentStack && (
                    <>
                      <p className="font-semibold mb-2 text-sm">Component Stack:</p>
                      <pre className="bg-background p-3 rounded-sm text-xs overflow-auto border border-border max-h-[200px]">
                        {errorInfo.componentStack}
                      </pre>
                    </>
                  )}

                  <button
                    onClick={() => {
                      const errorData = {
                        error: error.toString(),
                        message: error.message,
                        stack: error.stack,
                        componentStack: errorInfo?.componentStack,
                        timestamp: new Date().toISOString(),
                        url: window.location.href,
                      };
                      navigator.clipboard.writeText(JSON.stringify(errorData, null, 2));
                      alert('Error details copied to clipboard');
                    }}
                    className="mt-4 px-4 py-2 bg-secondary text-foreground rounded-sm text-sm hover:bg-muted transition-colors"
                  >
                    Copy error details
                  </button>
                </div>
              </details>
            )}

            {/* Action Buttons */}
            <div className="flex gap-4 justify-center flex-wrap">
              <button
                onClick={this.handleReset}
                className="bg-primary text-primary-foreground px-6 py-3 rounded-lg text-base font-semibold cursor-pointer transition-all duration-200 hover:opacity-90 hover:-translate-y-0.5 border-none"
              >
                {isAppLevel ? i18n.t('errorBoundary.reload') : i18n.t('errorBoundary.try_again')}
              </button>

              {isAppLevel && (
                <button
                  onClick={this.handleGoHome}
                  className="bg-secondary text-foreground px-6 py-3 rounded-lg text-base font-semibold cursor-pointer transition-all duration-200 border border-border hover:bg-muted hover:-translate-y-0.5"
                >
                  {i18n.t('errorBoundary.home')}
                </button>
              )}
            </div>

            {/* Help Text */}
            {isAppLevel && (
              <p className="mt-8 text-sm text-muted-foreground">{i18n.t('errorBoundary.help')}</p>
            )}
          </div>
        </div>
      );
    }

    return children;
  }
}

export default ErrorBoundary;
