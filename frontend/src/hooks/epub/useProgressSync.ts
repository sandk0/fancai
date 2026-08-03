/**
 * useProgressSync - Custom hook for debounced reading progress synchronization
 *
 * Prevents excessive API requests by debouncing progress updates.
 * Performance improvement: 60 req/s → 0.2 req/s (5-second debounce)
 *
 * Features:
 * - Debounced updates (configurable delay)
 * - Automatic save on page close/unmount
 * - Error handling with retry logic
 * - Invalidates React Query cache on unmount (FIX #3)
 *
 * @param bookId - Book identifier
 * @param currentCFI - Current CFI position
 * @param progress - Current progress percentage
 * @param scrollOffset - Current scroll offset percentage
 * @param onSave - Callback function to save progress
 * @param debounceMs - Debounce delay in milliseconds (default: 5000)
 *
 * @example
 * useProgressSync(
 *   bookId,
 *   currentCFI,
 *   progress,
 *   scrollOffsetPercent,
 *   (cfi, prog, scroll) => booksAPI.updateReadingProgress(bookId, {...})
 * );
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '@/lib/logger';
import { useVisibilityManager } from '@/hooks/shared/useVisibilityManager';
import { bookKeys } from '@/hooks/api/queryKeys';
import { useAuthStore } from '@/stores/auth';

interface UseProgressSyncOptions {
  bookId: string;
  currentCFI: string;
  progress: number;
  scrollOffset: number;
  currentChapter: number;
  onSave: (cfi: string, progress: number, scrollOffset: number, chapter: number) => Promise<void>;
  debounceMs?: number;
  enabled?: boolean;
  isRestoringPosition?: boolean;
}

interface UseProgressSyncReturn {
  isSaving: boolean;
  lastSaved: number | null;
}

export const useProgressSync = ({
  bookId,
  currentCFI,
  progress,
  scrollOffset,
  currentChapter,
  onSave,
  debounceMs = 5000,
  enabled = true,
  isRestoringPosition = false,
}: UseProgressSyncOptions): UseProgressSyncReturn => {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSavedRef = useRef<{
    cfi: string;
    progress: number;
    scrollOffset: number;
    chapter: number;
  }>({
    cfi: '',
    progress: 0,
    scrollOffset: 0,
    chapter: 0,
  });

  // Ref to store latest position values - fixes stale closure in beforeunload handler
  const latestPositionRef = useRef<{
    cfi: string;
    progress: number;
    scrollOffset: number;
    chapter: number;
  }>({
    cfi: '',
    progress: 0,
    scrollOffset: 0,
    chapter: 0,
  });

  // Keep ref updated with latest position values for beforeunload handler
  useEffect(() => {
    latestPositionRef.current = {
      cfi: currentCFI || '',
      progress: progress || 0,
      scrollOffset: scrollOffset || 0,
      chapter: currentChapter || 0,
    };
  }, [currentCFI, progress, scrollOffset, currentChapter]);

  /**
   * Save progress immediately (no debounce)
   */
  const saveImmediate = useCallback(async () => {
    if (!enabled || !currentCFI || !bookId) return;

    // Skip save during restoration to prevent overwriting correct position
    if (isRestoringPosition) {
      if (import.meta.env.DEV) {
        logger.debug('[useProgressSync] Skipping save during restoration');
      }
      return;
    }

    // Skip if no changes
    if (
      lastSavedRef.current.cfi === currentCFI &&
      lastSavedRef.current.progress === progress &&
      lastSavedRef.current.scrollOffset === scrollOffset &&
      lastSavedRef.current.chapter === currentChapter
    ) {
      return;
    }

    try {
      setIsSaving(true);

      await onSave(currentCFI, progress, scrollOffset, currentChapter);

      lastSavedRef.current = {
        cfi: currentCFI,
        progress,
        scrollOffset,
        chapter: currentChapter,
      };

      setLastSaved(Date.now());
    } catch (err) {
      logger.error('[useProgressSync] Error saving progress:', err);
    } finally {
      setIsSaving(false);
    }
  }, [enabled, currentCFI, progress, scrollOffset, currentChapter, bookId, onSave, isRestoringPosition]);

  const pendingSaveOnBackgroundRef = useRef(false);
  // Последний `saveImmediate` и последнее `enabled` держатся в ref'ах, чтобы
  // эффект выгрузки НЕ пересоздавался на каждый рендер. `saveImmediate`
  // зависит от позиции и от `onSave`, а `onSave` в `EpubReader` — стрелка,
  // создаваемая заново каждым рендером. Держать их в зависимостях означало
  // выполнять «уборку при выгрузке» десятки раз за одно открытие книги:
  // каждая уборка инвалидировала детали книги, инвалидация вызывала refetch,
  // refetch — новый рендер, и цикл сам себя подкармливал (инцидент 2026-08-05).
  const saveImmediateRef = useRef(saveImmediate);
  const enabledRef = useRef(enabled);
  // userId нужен только уборке, зато обязателен для ключа деталей книги.
  const userId = useAuthStore((state) => state.user?.id) ?? '';
  const userIdRef = useRef(userId);

  // Синхронизация в эффекте, а не в теле — как у `latestPositionRef` выше.
  // Все три ref'а читаются только после коммита: в обработчике `beforeunload`
  // и в уборке эффекта, поэтому первый рендер их свежесть не требует.
  useEffect(() => {
    saveImmediateRef.current = saveImmediate;
    enabledRef.current = enabled;
    userIdRef.current = userId;
  }, [saveImmediate, enabled, userId]);

  useEffect(() => {
    if (!enabled || !currentCFI || !bookId) return;

    clearTimeout(timeoutRef.current);

    if (
      lastSavedRef.current.cfi === currentCFI &&
      lastSavedRef.current.progress === progress &&
      lastSavedRef.current.scrollOffset === scrollOffset &&
      lastSavedRef.current.chapter === currentChapter
    ) {
      return;
    }

    timeoutRef.current = setTimeout(async () => {
      await saveImmediate();
    }, debounceMs);

    return () => {
      clearTimeout(timeoutRef.current);
    };
  }, [currentCFI, progress, scrollOffset, currentChapter, enabled, bookId, debounceMs, saveImmediate]);

  useVisibilityManager({
    id: 'progress-sync',
    priority: 10,
    delay: 0,
    enabled,
    onHidden: () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = undefined;
        pendingSaveOnBackgroundRef.current = true;
        if (import.meta.env.DEV) {
          logger.debug('[useProgressSync] Timeout paused (background)');
        }
      }
    },
    onVisible: () => {
      if (pendingSaveOnBackgroundRef.current && enabled && currentCFI && bookId) {
        setTimeout(() => {
          if (
            lastSavedRef.current.cfi !== currentCFI ||
            lastSavedRef.current.progress !== progress ||
            lastSavedRef.current.scrollOffset !== scrollOffset ||
            lastSavedRef.current.chapter !== currentChapter
          ) {
            timeoutRef.current = setTimeout(async () => {
              await saveImmediate();
            }, debounceMs);
            if (import.meta.env.DEV) {
              logger.debug('[useProgressSync] Timeout resumed');
            }
          }
        }, 300);
      }
      pendingSaveOnBackgroundRef.current = false;
    },
    shouldRun: () => enabled && !!currentCFI && !!bookId,
  });

  /**
   * Save on unmount or page close
   * Uses fetch with keepalive for authenticated requests (sendBeacon doesn't support headers)
   * FIX: Uses latestPositionRef to avoid stale closure capturing old position values
   */
  useEffect(() => {
    if (!bookId) return;

    const handleBeforeUnload = () => {
      clearTimeout(timeoutRef.current);

      // Read latest position from ref to avoid stale closure
      const { cfi, progress: currentProgress, scrollOffset: currentScrollOffset, chapter } = latestPositionRef.current;

      // Skip if no CFI position
      if (!cfi) {
        return;
      }

      // Skip if no changes since last save
      if (
        lastSavedRef.current.cfi === cfi &&
        lastSavedRef.current.progress === currentProgress &&
        lastSavedRef.current.scrollOffset === currentScrollOffset &&
        lastSavedRef.current.chapter === chapter
      ) {
        return;
      }

      if (enabledRef.current) {
        const data = JSON.stringify({
          current_chapter: chapter,
          current_position_percent: currentProgress,
          reading_location_cfi: cfi,
          scroll_offset_percent: currentScrollOffset,
        });

        const url = `${window.location.origin}/api/v1/books/${bookId}/progress`;
        
        // FIX (TD-FRONT-101): Use credentials: 'include' to send HttpOnly cookies
        // Backend now uses HttpOnly cookies instead of localStorage tokens
        // keepalive allows the request to continue after the page unloads
        try {
          fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: data,
            keepalive: true,
            credentials: 'include', // Critical: sends HttpOnly cookies for authentication
          }).catch(() => {
            // Ignore errors on page close - request may have been sent
          });
        } catch {
          // Fallback to sync endpoint which accepts token in body for sendBeacon
          if ('sendBeacon' in navigator) {
            const syncUrl = `${window.location.origin}/api/v1/sync/batch`;
            const syncPayload = JSON.stringify({
              operations: [{
                type: 'progress',
                book_id: bookId,
                data: {
                  current_chapter: chapter,
                  current_position_percent: currentProgress,
                  reading_location_cfi: cfi,
                  scroll_offset_percent: currentScrollOffset,
                },
                timestamp: Date.now(),
              }],
            });
            const blob = new Blob([syncPayload], { type: 'text/plain' });
            navigator.sendBeacon(syncUrl, blob);
          }
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);

      // Save on unmount
      clearTimeout(timeoutRef.current);

      // FIX: Save progress asynchronously and invalidate cache AFTER save completes
      // This prevents race condition where BookPage fetches old data before save completes
      const invalidateBookDetail = () => {
        const userId = userIdRef.current;
        if (!userId) return;
        // Small delay to ensure backend has processed the save
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: bookKeys.detail(userId, bookId) });
        }, 200);
      };
      saveImmediateRef
        .current()
        .then(invalidateBookDetail)
        // Still invalidate to prevent stale data
        .catch(invalidateBookDetail);
    };
    // Позиция, `enabled` и `saveImmediate` читаются из ref'ов, а не из
    // замыкания: эффект обязан прожить всё время чтения книги и отработать
    // уборку РОВНО один раз — при выгрузке или смене книги.
  }, [bookId, queryClient]);

  return { isSaving, lastSaved };
};
