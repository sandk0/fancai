import { useState, useEffect, useCallback, useRef } from 'react';
import type { Rendition, EpubLocations } from '@/types/epub';
import { booksAPI } from '@/api/books';

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
  const [isRestoringPosition, setIsRestoringPosition] = useState(true);
  const [positionConflict, setPositionConflict] = useState<PositionConflict | null>(null);
  
  // Track restoration state per book
  const restorationState = useRef<{ bookId: string; restored: boolean } | null>(null);

  // Helper to check restoration status
  const hasRestoredForCurrentBook = useCallback(() => {
    return restorationState.current?.bookId === bookId && restorationState.current?.restored;
  }, [bookId]);

  // Mark position as restored
  const markPositionRestored = useCallback(() => {
    restorationState.current = { bookId: bookId, restored: true };
  }, [bookId]);

  // Reset restoration state when book changes
  useEffect(() => {
    if (restorationState.current && restorationState.current.bookId !== bookId) {
      restorationState.current = null;
      setIsRestoringPosition(true);
    }
  }, [bookId]);

  // Main restoration effect
  useEffect(() => {
    if (!rendition || !renditionReady) return;

    if (hasRestoredForCurrentBook()) {
      console.log('[useReaderPosition] ⏭️ Skipping restoration - already restored for book:', bookId);
      setIsRestoringPosition(false);
      return;
    }

    let isMounted = true;
    console.log('[useReaderPosition] 🚀 Starting position restoration for book:', bookId);

    const initializePosition = async () => {
      if (isMounted) setIsRestoringPosition(true);

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
              console.log('[useReaderPosition] ⚠️ CONFLICT DETECTED');
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
          console.log('[useReaderPosition] 📖 Attempting CFI restoration:', savedProgress.reading_location_cfi.substring(0, 80));
          try {
            skipNextRelocated();
            await goToCFI(savedProgress.reading_location_cfi, savedProgress.scroll_offset_percent || 0);

            if (!isMounted) return;
            setInitialProgress(savedProgress.reading_location_cfi, savedProgress.current_position);
            console.log('[useReaderPosition] ✅ CFI restoration SUCCESS');
          } catch (cfiError) {
            console.log('[useReaderPosition] ❌ CFI restoration FAILED:', cfiError);
            if (isMounted) await rendition.display();
          }
        } else {
          console.log('[useReaderPosition] 🆕 No saved progress, displaying first page');
          await rendition.display();
        }

      } catch (error) {
        console.error('❌ [useReaderPosition] Failed to restore:', error);
        if (isMounted) await rendition.display().catch(console.error);
      } finally {
        if (isMounted) {
          markPositionRestored();
          setIsRestoringPosition(false);
          console.log('[useReaderPosition] 🏁 Position restoration complete');
        }
      }
    };

    initializePosition();

    return () => {
      isMounted = false;
    };
  }, [rendition, renditionReady, bookId, hasRestoredForCurrentBook, markPositionRestored, goToCFI, skipNextRelocated, setInitialProgress]);

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
          console.log('[useReaderPosition] Synced server position to localStorage');
        }
      } else {
        // Sync local position to server immediately
        await booksAPI.updateReadingProgress(bookId, {
          reading_location_cfi: target.cfi,
          current_position_percent: target.progress,
          current_chapter: 0, // Backend should infer chapter if 0 or update later
        });
        if (import.meta.env.DEV) {
          console.log('[useReaderPosition] Synced local position to server');
        }
      }

      markPositionRestored();
      setPositionConflict(null);
      setIsRestoringPosition(false);
    } catch (err) {
      console.error('[useReaderPosition] Error resolving conflict:', err);
      setPositionConflict(null);
      setIsRestoringPosition(false);
    }
  }, [rendition, positionConflict, goToCFI, skipNextRelocated, setInitialProgress, locations, bookId, markPositionRestored]);

  return {
    isRestoringPosition,
    positionConflict,
    resolveConflict,
  };
};
