/**
 * ChunkLoadErrorBoundary - Handles lazy-loaded chunk loading failures
 *
 * When a new deployment happens, old JS chunks are replaced with new ones.
 * If the browser has cached the old main bundle, it may try to load
 * chunks that no longer exist, causing "Importing a module script failed" errors.
 *
 * This ErrorBoundary catches such errors and automatically reloads the page
 * to fetch the new bundle with correct chunk references.
 *
 * @component
 */

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  isChunkError: boolean;
}

/**
 * Check if an error is a chunk loading error
 */
function isChunkLoadError(error: Error): boolean {
  const message = error.message?.toLowerCase() || '';
  const name = error.name?.toLowerCase() || '';

  // Common chunk loading error patterns
  return (
    message.includes('loading chunk') ||
    message.includes('loading css chunk') ||
    message.includes('importing a module script failed') ||
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    name.includes('chunkloaderror') ||
    // Vite-specific error
    message.includes('failed to load module script')
  );
}

export class ChunkLoadErrorBoundary extends Component<Props, State> {
  private reloadAttempted = false;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, isChunkError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    const isChunkError = isChunkLoadError(error);
    return { hasError: true, isChunkError };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ChunkLoadErrorBoundary] Error caught:', error);
    console.error('[ChunkLoadErrorBoundary] Error info:', errorInfo);

    // If it's a chunk loading error and we haven't tried reloading yet
    if (isChunkLoadError(error) && !this.reloadAttempted) {
      this.reloadAttempted = true;

      // Store a flag to show a message after reload
      sessionStorage.setItem('chunk_reload_attempted', 'true');

      console.log('[ChunkLoadErrorBoundary] Chunk loading error detected, reloading page...');

      // Clear service worker cache to ensure fresh chunks
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' });
      }

      // Force reload (bypass cache)
      window.location.reload();
    }
  }

  handleRetry = () => {
    // Clear the flag and reload
    sessionStorage.removeItem('chunk_reload_attempted');
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // Check if we already tried reloading
      const alreadyReloaded = sessionStorage.getItem('chunk_reload_attempted') === 'true';

      if (this.state.isChunkError && alreadyReloaded) {
        // Clear the flag so next time we can try again
        sessionStorage.removeItem('chunk_reload_attempted');

        return (
          <div className="flex items-center justify-center min-h-screen bg-background text-foreground p-4">
            <div className="text-center max-w-md">
              <div className="mb-6">
                <svg
                  className="w-16 h-16 mx-auto text-yellow-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold mb-3">Обновление приложения</h2>
              <p className="text-muted-foreground mb-6">
                Вышла новая версия приложения. Пожалуйста, обновите страницу для продолжения работы.
              </p>
              <button
                onClick={this.handleRetry}
                className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg transition-colors"
              >
                Обновить страницу
              </button>
            </div>
          </div>
        );
      }

      // For non-chunk errors, show generic error or custom fallback
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex items-center justify-center min-h-screen bg-background text-foreground p-4">
          <div className="text-center max-w-md">
            <div className="mb-6">
              <svg
                className="w-16 h-16 mx-auto text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold mb-3">Произошла ошибка</h2>
            <p className="text-muted-foreground mb-6">
              Что-то пошло не так. Попробуйте обновить страницу.
            </p>
            <button
              onClick={this.handleRetry}
              className="px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-lg transition-colors"
            >
              Обновить страницу
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ChunkLoadErrorBoundary;
