import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { booksAPI } from '@/api/books';
import { EpubReader } from '@/components/Reader/EpubReader';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useParsingStatus } from '@/hooks/api';
import { usePWAResumeGuard } from '@/hooks/pwa';
import { useAuthStore } from '@/stores/auth';
import { resetBookData } from '@/utils/bookDataReset';

/**
 * Hook to lock body scroll when reader is active
 * Prevents iOS Safari vertical bounce and body scroll
 */
const useReaderBodyLock = () => {
  useEffect(() => {
    // Add class to body to enable scroll lock styles
    document.body.classList.add('reader-active');

    // Prevent iOS Safari gesture events (pinch-zoom)
    const preventGesture = (e: Event) => {
      e.preventDefault();
    };

    // Safari-specific gesture events
    document.addEventListener('gesturestart', preventGesture, { passive: false });
    document.addEventListener('gesturechange', preventGesture, { passive: false });
    document.addEventListener('gestureend', preventGesture, { passive: false });

    return () => {
      // Remove class when leaving reader
      document.body.classList.remove('reader-active');

      // Remove gesture listeners
      document.removeEventListener('gesturestart', preventGesture);
      document.removeEventListener('gesturechange', preventGesture);
      document.removeEventListener('gestureend', preventGesture);
    };
  }, []);
};

/**
 * Error fallback component for the reader
 * Displayed when EpubReader crashes
 */
interface ReaderErrorFallbackProps {
  bookId: string | undefined;
}

const ReaderErrorFallback = ({ bookId }: ReaderErrorFallbackProps) => {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [isResetting, setIsResetting] = useState(false);

  const handleResetCache = async () => {
    if (!user?.id || !bookId) {
      alert('Не удалось определить данные книги. Попробуйте очистить данные приложения в настройках браузера.');
      return;
    }

    setIsResetting(true);
    try {
      await resetBookData(user.id, bookId);
      window.location.reload();
    } catch (error) {
      console.error('Failed to reset book cache:', error);
      alert('Не удалось сбросить кэш. Попробуйте очистить данные приложения в настройках браузера.');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="flex items-center justify-center bg-background reader-container" style={{ height: '100dvh', minHeight: '100vh' }}>
      <div className="text-center max-w-md px-4">
        <div className="text-6xl mb-4">📖</div>
        <h2 className="text-2xl font-bold text-foreground mb-2">
          Ошибка загрузки читалки
        </h2>
        <p className="text-muted-foreground mb-6">
          Не удалось открыть книгу. Попробуйте вернуться в библиотеку и открыть книгу снова,
          или сбросить кэш книги.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => navigate('/library')}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            Вернуться в библиотеку
          </button>
          <button
            onClick={handleResetCache}
            disabled={isResetting}
            className="px-6 py-3 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isResetting ? 'Сброс...' : 'Сбросить кэш книги'}
          </button>
        </div>
      </div>
    </div>
  );
};

const BookReaderPage = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  // Lock body scroll and prevent gestures when reader is active
  useReaderBodyLock();

  // PWA Resume Guard: handles race condition between Zustand rehydration
  // and TanStack Query refetch when app resumes from background
  const { isResuming, isReady } = usePWAResumeGuard();

  const { data: bookData, isLoading, error } = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => booksAPI.getBook(bookId!),
    // Only enable query when not resuming from background and bookId is available
    enabled: !!bookId && !isResuming,
    // Disable auto-refetch on window focus to prevent race conditions
    // with Zustand auth store initialization (100ms delay)
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Track parsing status and invalidate caches when parsing completes
  // This ensures descriptions are immediately available after background parsing
  const { isParsing, progress } = useParsingStatus({
    bookId: bookId || '',
    enabled: !!bookId && !!bookData && !isResuming,
  });

  if (isLoading || !isReady) {
    return (
      <div className="flex items-center justify-center bg-background reader-container" style={{ height: '100dvh', minHeight: '100vh' }}>
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
          <p className="text-muted-foreground">Загрузка книги...</p>
        </div>
      </div>
    );
  }

  if (error || !bookData) {
    return (
      <div className="flex items-center justify-center bg-background reader-container" style={{ height: '100dvh', minHeight: '100vh' }}>
        <div className="text-center">
          <p className="text-destructive mb-4">Ошибка загрузки книги</p>
          <button
            onClick={() => navigate('/library')}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            Вернуться в библиотеку
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-background reader-container reader-scroll-lock"
      style={{
        /* Use 100dvh for proper iOS Home Indicator support */
        height: '100dvh',
        /* Fallback for browsers that don't support dvh */
        minHeight: '100vh',
        /* Safe area padding handled by child components for better theme color coverage */
      }}
    >
      {/* Parsing Status Indicator - shown while Celery is processing */}
      {isParsing && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[800] px-4 py-2 rounded-full bg-primary/90 backdrop-blur-sm text-primary-foreground text-sm flex items-center gap-2 shadow-lg"
          style={{ bottom: 'calc(20px + env(safe-area-inset-bottom))' }}
        >
          <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
          <span>Подготовка книги... {progress}%</span>
        </div>
      )}

      {/* Reader with integrated header and error protection */}
      <ErrorBoundary
        level="page"
        fallback={<ReaderErrorFallback bookId={bookId} />}
      >
        <EpubReader book={bookData} />
      </ErrorBoundary>

      {/* PWA Resume Overlay - shown on top without unmounting reader */}
      {isResuming && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
            <p className="text-muted-foreground">Восстановление сессии...</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookReaderPage;
