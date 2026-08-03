import { useState, useEffect, useCallback, useRef } from 'react';
import type { Rendition, EpubLocations } from '@/types/epub';
import { booksAPI } from '@/api/books';
import { logger } from '@/lib/logger';

interface PositionConflict {
  serverPosition: {
    cfi: string;
    progress: number;
    lastReadAt: Date;
  };
  localPosition: {
    cfi: string;
    progress: number;
    savedAt: Date;
  };
}

interface UseReaderPositionProps {
  rendition: Rendition | null;
  renditionReady: boolean;
  bookId: string;
  locations: EpubLocations | null;
  goToCFI: (cfi: string, offset?: number) => Promise<void>;
  skipNextRelocated: () => void;
  setInitialProgress: (cfi: string, progress: number) => void;
}

export const useReaderPosition = ({
  rendition,
  renditionReady,
  bookId,
  locations,
  goToCFI,
  skipNextRelocated,
  setInitialProgress,
}: UseReaderPositionProps) => {
  const [positionConflict, setPositionConflict] = useState<PositionConflict | null>(null);

  // Книга, для которой позиция уже восстановлена. Флаг восстановления выводится
  // при рендере, поэтому синхронный setState в теле эффекта не нужен, а смена
  // книги сама возвращает состояние в «восстанавливаем» без отдельного эффекта.
  const [restoredBookId, setRestoredBookId] = useState<string | null>(null);
  const isRestoringPosition = restoredBookId !== bookId;

  // Колбэки читалки держатся в ref'ах, а не в зависимостях эффекта.
  // `skipNextRelocated` менял идентичность после каждого события relocated,
  // то есть после каждого шага самого восстановления: эффект пересоздавался
  // посреди собственной работы, старый прогон уходил в `isMounted === false`,
  // а новый начинал всё заново. Флаг не снимался никогда — «вечное
  // восстановление позиции» инцидента 2026-08-05.
  const goToCFIRef = useRef(goToCFI);
  const skipNextRelocatedRef = useRef(skipNextRelocated);
  const setInitialProgressRef = useRef(setInitialProgress);

  // Синхронизация в эффекте: ref'ы читаются только внутри асинхронного
  // восстановления, то есть заведомо после коммита.
  useEffect(() => {
    goToCFIRef.current = goToCFI;
    skipNextRelocatedRef.current = skipNextRelocated;
    setInitialProgressRef.current = setInitialProgress;
  }, [goToCFI, skipNextRelocated, setInitialProgress]);

  // Mark position as restored
  const markPositionRestored = useCallback(() => {
    setRestoredBookId(bookId);
  }, [bookId]);

  // Main restoration effect
  useEffect(() => {
    if (!rendition || !renditionReady) return;

    if (restoredBookId === bookId) {
      logger.debug('[useReaderPosition] ⏭️ Skipping restoration - already restored for book:', bookId);
      return;
    }

    let isMounted = true;
    logger.debug('[useReaderPosition] 🚀 Starting position restoration for book:', bookId);

    const initializePosition = async () => {
      try {
        const { progress: savedProgress } = await booksAPI.getReadingProgress(bookId);

        if (!isMounted) return;

        // Check conflicts
        const localBackupKey = `book_${bookId}_progress_backup`;
        const localBackupRaw = localStorage.getItem(localBackupKey);

        if (localBackupRaw && savedProgress) {
          try {
            const localBackup = JSON.parse(localBackupRaw);
            const serverPercent = savedProgress.current_position || 0;
            const localPercent = localBackup.current_position || 0;
            const diff = Math.abs(serverPercent - localPercent);

            if (diff > 5) {
              logger.debug('[useReaderPosition] ⚠️ CONFLICT DETECTED');
              if (isMounted) {
                setPositionConflict({
                  serverPosition: {
                    cfi: savedProgress.reading_location_cfi || '',
                    progress: serverPercent,
                    lastReadAt: new Date(savedProgress.last_read_at),
                  },
                  localPosition: {
                    cfi: localBackup.reading_location_cfi || '',
                    progress: localPercent,
                    savedAt: new Date(localBackup.savedAt || Date.now()),
                  },
                });
                await rendition.display();
              }
              return;
            }
          } catch {
            // Ignore parse errors
          }
        }

        // Restore server position
        if (savedProgress?.reading_location_cfi) {
          logger.debug('[useReaderPosition] 📖 Attempting CFI restoration:', savedProgress.reading_location_cfi.substring(0, 80));
          try {
            skipNextRelocatedRef.current();
            await goToCFIRef.current(savedProgress.reading_location_cfi, savedProgress.scroll_offset_percent || 0);

            if (!isMounted) return;
            setInitialProgressRef.current(savedProgress.reading_location_cfi, savedProgress.current_position);
            logger.debug('[useReaderPosition] ✅ CFI restoration SUCCESS');
          } catch (cfiError) {
            logger.debug('[useReaderPosition] ❌ CFI restoration FAILED:', cfiError);
            if (isMounted) await rendition.display();
          }
        } else {
          logger.debug('[useReaderPosition] 🆕 No saved progress, displaying first page');
          await rendition.display();
        }

      } catch (error) {
        logger.error('❌ [useReaderPosition] Failed to restore:', error);
        if (isMounted) await rendition.display().catch((err: unknown) => logger.error(err));
      } finally {
        // Флаг снимается БЕЗУСЛОВНО. Прежняя проверка `isMounted` оставляла
        // читалку в состоянии «восстанавливаем позицию» навсегда, стоило
        // эффекту пересоздаться до конца собственной работы. Установка
        // состояния размонтированного компонента в React 18 — безвредный
        // no-op, а смена книги всё равно вернёт флаг: он выводится сравнением
        // `restoredBookId !== bookId`.
        markPositionRestored();
        logger.debug('[useReaderPosition] 🏁 Position restoration complete');
      }
    };

    initializePosition();

    return () => {
      isMounted = false;
    };
    // Только настоящие условия перезапуска: другая книга или новый rendition.
    // Колбэки читалки живут в ref'ах — см. комментарий у их объявления.
  }, [rendition, renditionReady, bookId, restoredBookId, markPositionRestored]);

  // Conflict resolution handlers
  const resolveConflict = useCallback(async (choice: 'server' | 'local') => {
    if (!rendition || !positionConflict) return;

    try {
      skipNextRelocated();
      const target = choice === 'server' ? positionConflict.serverPosition : positionConflict.localPosition;

      if (target.cfi) {
        await goToCFI(target.cfi);
        setInitialProgress(target.cfi, target.progress);
      } else if (locations && target.progress > 0) {
        const fallbackCfi = locations.cfiFromPercentage(target.progress / 100);
        if (fallbackCfi) {
          await rendition.display(fallbackCfi);
          setInitialProgress(fallbackCfi, target.progress);
        }
      }

      // Sync choice to the other storage to prevent future conflicts
      if (choice === 'server') {
        const localBackupKey = `book_${bookId}_progress_backup`;
        localStorage.setItem(localBackupKey, JSON.stringify({
          reading_location_cfi: target.cfi,
          current_position: target.progress,
          savedAt: Date.now(),
        }));
        if (import.meta.env.DEV) {
          logger.debug('[useReaderPosition] Synced server position to localStorage');
        }
      } else {
        // Sync local position to server immediately
        await booksAPI.updateReadingProgress(bookId, {
          reading_location_cfi: target.cfi,
          current_position_percent: target.progress,
          current_chapter: 0, // Backend should infer chapter if 0 or update later
        });
        if (import.meta.env.DEV) {
          logger.debug('[useReaderPosition] Synced local position to server');
        }
      }

      markPositionRestored();
      setPositionConflict(null);
    } catch (err) {
      logger.error('[useReaderPosition] Error resolving conflict:', err);
      setPositionConflict(null);
      markPositionRestored();
    }
  }, [rendition, positionConflict, goToCFI, skipNextRelocated, setInitialProgress, locations, bookId, markPositionRestored]);

  return {
    isRestoringPosition,
    positionConflict,
    resolveConflict,
  };
};
