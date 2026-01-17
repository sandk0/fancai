/**
 * EpubReader - Professional EPUB reading component with advanced features
 *
 * Reduced from 841 lines to modular hooks architecture.
 *
 * Core Features:
 * - EPUB.js integration for professional book rendering
 * - CFI-based position tracking with pixel-perfect restoration
 * - IndexedDB caching for instant location generation (5-10s → <100ms)
 * - Debounced progress sync (60 req/s → 0.2 req/s)
 * - Description highlighting with image modal
 * - Memory leak prevention via proper cleanup
 *
 * User Customization:
 * - Theme switcher (☀️ Light / 🌙 Dark / 📜 Sepia) with localStorage
 * - Font size controls (75%-200%, A-/A+ buttons) with localStorage
 * - Visual progress indicator (percentage, chapter, page)
 *
 * Navigation:
 * - Keyboard: ← ↑ (prev) / → ↓ Space (next)
 * - Touch/Swipe: Swipe left (next) / Swipe right (prev)
 * - Buttons: Click navigation arrows
 *
 * Advanced epub.js Features:
 * - Content hooks for custom CSS injection
 * - Theme-aware styling
 * - Image optimization and error handling
 * - Improved typography (justified text, hyphenation, spacing)
 *
 * @component
 */

import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { booksAPI } from '@/api/books';
import { STORAGE_KEYS } from '@/types/state';
import type { BookDetail } from '@/types/api';
import { ImageModal } from '@/components/Images/ImageModal';

// Import custom hooks
import {
  useEpubLoader,
  useLocationGeneration,
  useCFITracking,
  useProgressSync,
  useEpubNavigation,
  useKeyboardNavigation,
  useChapterManagement,
  useChapterMapping,
  useDescriptionHighlighting,
  useImageModal,
  useEpubThemes,
  useContentHooks,
  useResizeHandler,
  useBookMetadata,
  useTextSelection,
  useToc,
  useTouchNavigation,
} from '@/hooks/epub';
import { useSwipeNavigation } from '@/hooks/epub/useSwipeNavigation';
import { useRenditionHealthGuard } from '@/hooks/epub/useRenditionHealthGuard';
import { isIOS, isAndroid } from '@/hooks/epub/useEpubNavigation';
import { useReaderStore } from '@/stores/reader';

// Import reading session hook
import { useReadingSession } from '@/hooks/useReadingSession';

// Import components
import { BookInfo } from './BookInfo';
import { SelectionMenu } from './SelectionMenu';
import { TocSidebar } from './TocSidebar';
import { ReaderControls } from './ReaderControls';
import { ReaderHeader } from './ReaderHeader';
import { ImageGenerationStatus } from './ImageGenerationStatus';
import { ExtractionIndicator } from './ExtractionIndicator';
import { ProgressSaveIndicator } from './ProgressSaveIndicator';
import { PositionConflictDialog } from './PositionConflictDialog';
import { IOSTapZones } from './IOSTapZones';
import { SwipeOverlay } from './SwipeOverlay';
// import { IOSDebugOverlay } from './IOSDebugOverlay'; // DISABLED FOR PRODUCTION
import { notify } from '@/stores/ui';

// Wake Lock hook
import { useWakeLock } from '@/hooks/useWakeLock';
import { useNavigate } from 'react-router-dom';
import { getCurrentUserId } from '@/hooks/api/queryKeys';

// Types for position conflict
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

// Wake Lock storage key - outside component to avoid recreation
const WAKE_LOCK_STORAGE_KEY = `${STORAGE_KEYS.READER_SETTINGS}_wake_lock`;

interface EpubReaderProps {
  book: BookDetail;
}

/**
 * Convert technical error messages to user-friendly Russian text
 */
function getHumanReadableError(error: string): string {
  const lowerError = error.toLowerCase();

  if (lowerError.includes('network') || lowerError.includes('failed to fetch') || lowerError.includes('net::')) {
    return 'Проверьте подключение к интернету и попробуйте снова.';
  }
  if (lowerError.includes('404') || lowerError.includes('not found')) {
    return 'Файл книги не найден. Возможно, книга была удалена.';
  }
  if (lowerError.includes('401') || lowerError.includes('unauthorized')) {
    return 'Сессия истекла. Пожалуйста, войдите в систему снова.';
  }
  if (lowerError.includes('403') || lowerError.includes('forbidden')) {
    return 'У вас нет доступа к этой книге.';
  }
  if (lowerError.includes('500') || lowerError.includes('internal server')) {
    return 'Ошибка сервера. Попробуйте позже.';
  }
  if (lowerError.includes('timeout') || lowerError.includes('timed out')) {
    return 'Превышено время ожидания. Проверьте соединение и попробуйте снова.';
  }
  if (lowerError.includes('epub') || lowerError.includes('parse')) {
    return 'Не удалось открыть файл книги. Формат может быть поврежден.';
  }
  if (lowerError.includes('viewer') || lowerError.includes('container')) {
    return 'Ошибка отображения. Обновите страницу и попробуйте снова.';
  }

  return 'Произошла ошибка при загрузке книги. Попробуйте позже.';
}

export const EpubReader: React.FC<EpubReaderProps> = ({ book }) => {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [renditionReady, setRenditionReady] = useState(false);
  const [isRestoringPosition, setIsRestoringPosition] = useState(true); // Start as true - wait for restoration
  // Track restoration state per book - prevents skipping restoration when reopening same book
  const restorationState = useRef<{ bookId: string; restored: boolean } | null>(null);
  const navigate = useNavigate();

  // State for settings dropdown
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Navigation mode from store (swipe or tap)
  const { navigationMode, updateNavigationMode } = useReaderStore();

  // Determine effective navigation mode (iOS always uses swipe)
  const effectiveNavigationMode = isIOS() ? 'swipe' : navigationMode;
  const isMobileDevice = isIOS() || isAndroid();

  // State for position conflict dialog (sync between devices)
  const [positionConflict, setPositionConflict] = useState<PositionConflict | null>(null);

  // Wake Lock - prevents screen from turning off while reading
  // Stored in localStorage, enabled by default
  const [wakeLockEnabled, setWakeLockEnabled] = useState(() => {
    const saved = localStorage.getItem(WAKE_LOCK_STORAGE_KEY);
    // Default to true (enabled) if no saved preference
    return saved !== null ? saved === 'true' : true;
  });
  const { request: requestWakeLock, release: releaseWakeLock, isActive: isWakeLockActive, isSupported: isWakeLockSupported } = useWakeLock();

  // Get auth token and user ID
  const authToken = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
  const userId = getCurrentUserId();

  // Hook 1: Load EPUB file and create rendition
  // Checks IndexedDB cache first for offline reading support
  const { book: epubBook, rendition, isLoading, error, reload } = useEpubLoader({
    bookUrl: booksAPI.getBookFileUrl(book.id),
    viewerRef,
    authToken,
    bookId: book.id,
    userId: userId || undefined,
    onReady: () => {
      // Use requestAnimationFrame for immediate but safe state update
      requestAnimationFrame(() => {
        setRenditionReady(true);
      });
    },
  });

  // Hook 2: Generate or load cached locations
  const { locations, isGenerating } = useLocationGeneration(epubBook, book.id);

  // Hook 3: Track CFI position and progress (including page numbers)
  const { currentCFI, progress, scrollOffsetPercent, currentPage, totalPages, goToCFI, skipNextRelocated, setInitialProgress } = useCFITracking({
    rendition,
    locations,
    book: epubBook,
  });

  // Hook 16: Table of Contents (needed early for chapter mapping)
  const { toc, currentHref, setCurrentHref } = useToc(epubBook);

  // Hook 17: Chapter Mapping (maps spine hrefs to backend chapter numbers)
  // FIXED: Solves mismatch between spine index and logical chapter numbers
  const { getChapterNumberByLocation } = useChapterMapping(
    toc,
    book.chapters || []
  );

  // Hook 4: Manage chapter tracking and load descriptions/images
  // FIXED (2025-12-25): Pass isRestoringPosition to prevent race condition
  const { currentChapter, descriptions, images, isExtractingDescriptions, cancelExtraction } = useChapterManagement({
    book: epubBook,
    rendition,
    bookId: book.id,
    getChapterNumberByLocation,
    isRestoringPosition, // Prevent loading during position restoration
  });

  // Hook 5: Debounced progress sync to backend
  const { isSaving, lastSaved } = useProgressSync({
    bookId: book.id,
    currentCFI,
    progress,
    scrollOffset: scrollOffsetPercent,
    currentChapter,
    onSave: async (cfi, prog, scroll, chapter) => {
      await booksAPI.updateReadingProgress(book.id, {
        current_chapter: chapter,
        current_position_percent: prog,
        reading_location_cfi: cfi,
        scroll_offset_percent: scroll,
      });
    },
    // CRITICAL FIX: Allow saving even during location generation
    // Previously: renditionReady && !isGenerating
    // Problem: If user exits before locations finish (5-10s), progress was lost
    // Solution: Save always when rendition is ready. CFI is always precise,
    // progress uses spine-based fallback (less accurate but still useful)
    enabled: renditionReady,
  });

  // Hook 6: Page navigation
  const { nextPage, prevPage } = useEpubNavigation(rendition);

  // Hook 7: Image modal management with IndexedDB caching
  const {
    selectedImage,
    isOpen: isModalOpen,
    openModal,
    closeModal,
    updateImage,
    isGenerating: _isGeneratingImage, // Available for future use
    generationStatus,
    generationError,
    descriptionPreview,
    cancelGeneration,
    isCached: _isCached, // For future UI indicator
  } = useImageModal({ bookId: book.id });

  // Hook 7.5: PWA Resume Guard - smart page reload on resume from background
  // Placed after hooks that define active operations (isGenerating, isExtractingDescriptions, _isGeneratingImage)
  // Uses smart reload strategy that balances crash prevention with UX:
  // - Always reloads during initial loading (prevents crashes)
  // - Skips reload for short suspends (< 30s)
  // - Extends threshold to 2 min when operations are active (image gen, parsing)
  // - Reloads for long suspends (ensures fresh state)
  const hasActiveOperations = isGenerating || isExtractingDescriptions || _isGeneratingImage;
  const {
    isHealthy: isRenditionHealthy,
    isChecking: isCheckingHealth,
    markHealthy,
  } = useRenditionHealthGuard({
    rendition,
    bookId: book.id,
    enabled: renditionReady && !!rendition,
    // Rendition is stable when fully loaded and position restored
    isStable: renditionReady && !isLoading && !isRestoringPosition,
    // Track active background operations to extend reload threshold
    hasActiveOperations,
  });

  // Mark rendition as healthy after successful render
  useEffect(() => {
    if (renditionReady && isRenditionHealthy && !isCheckingHealth) {
      markHealthy();
    }
  }, [renditionReady, isRenditionHealthy, isCheckingHealth, markHealthy]);

  // Hook 7b: Swipe navigation for mobile (iOS always uses swipe)
  const { swipeState, touchHandlers: swipeTouchHandlers } = useSwipeNavigation({
    rendition,
    enabled: renditionReady && effectiveNavigationMode === 'swipe' && !isModalOpen,
    onNavigate: async (direction) => {
      if (direction === 'next') {
        await nextPage();
      } else {
        await prevPage();
      }
    },
    onSwipeStart: () => {
      // Can add haptic feedback here in the future
    },
    onSwipeEnd: (_navigated) => {
      // Can track swipe analytics here
    },
  });

  // Hook 8: Keyboard navigation (disabled when modal is open)
  // Pass rendition to also listen on iframe document for keyboard events
  useKeyboardNavigation(nextPage, prevPage, renditionReady && !isModalOpen, rendition);

  // Hook 9: Touch/tap navigation for mobile (TAP mode only)
  // Disabled when: modal is open, or swipe mode is active
  // In swipe mode, useSwipeNavigation handles navigation instead
  useTouchNavigation({
    rendition,
    viewerRef,
    nextPage,
    prevPage,
    enabled: renditionReady && !isModalOpen && effectiveNavigationMode === 'tap',
  });

  // Hook 10: Theme management
  const { theme, fontSize, setTheme, increaseFontSize, decreaseFontSize } = useEpubThemes(rendition);

  // Hook 11: Content hooks for style injection
  useContentHooks(rendition, theme);

  // Hook 12: Description highlighting
  // FIX: Don't gate 'enabled' on descriptions.length > 0
  // This creates a chicken-and-egg problem:
  // 1. descriptions = [] → enabled = false → no listeners set up
  // 2. descriptions load → enabled = true → listeners set up
  // 3. But page is already rendered, and initial handleRendered() might miss it
  // The hook itself handles empty descriptions gracefully (early return in highlightDescriptions)
  useDescriptionHighlighting({
    rendition,
    descriptions,
    images,
    onDescriptionClick: async (desc, img) => {
      await openModal(desc, img);
    },
    enabled: renditionReady, // Always enabled when rendition is ready
  });

  // DEBUG: Log descriptions and highlighting state (dev only)
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[EpubReader] Descriptions state updated:', {
        descriptionsCount: descriptions.length,
        imagesCount: images.length,
        renditionReady,
        highlightingEnabled: renditionReady,
        willHighlight: renditionReady && descriptions.length > 0,
      });
    }
  }, [descriptions, images, renditionReady]);

  // Hook 13: Resize handler for position preservation
  useResizeHandler({
    rendition,
    enabled: renditionReady,
    onResized: (_dimensions) => {
      // Position is automatically preserved by the hook
    },
  });

  // Hook 14: Book metadata
  const { metadata } = useBookMetadata(epubBook);

  // Hook 15: Text selection (disabled when modal is open)
  const { selection, clearSelection } = useTextSelection(
    rendition,
    renditionReady && !isModalOpen
  );

  // Hook 18: Reading session tracking
  // FIXED: Infinite loop bug caused by useEffect dependencies
  useReadingSession({
    bookId: book.id,
    currentPosition: progress,
    enabled: renditionReady && !isGenerating,
    onSessionStart: (_session) => {
      // Session started - no user notification needed
    },
    onSessionEnd: (session) => {
      notify.success(
        'Сессия завершена',
        `Вы читали ${session.duration_minutes} мин и прочитали ${session.pages_read} стр.`
      );
    },
    onError: (error) => {
      console.error('[EpubReader] Reading session error:', error);
      // Don't show error notification - sessions are non-critical
    },
  });

  // State for BookInfo modal
  const [isBookInfoOpen, setIsBookInfoOpen] = useState(false);

  // State for TOC sidebar
  const [isTocOpen, setIsTocOpen] = useState(() => {
    // Load TOC state from localStorage
    const saved = localStorage.getItem(`${STORAGE_KEYS.READER_SETTINGS}_toc_open`);
    return saved === 'true';
  });

  // Helper function to check if we've restored position for current book
  const hasRestoredForCurrentBook = useCallback(() => {
    return restorationState.current?.bookId === book.id && restorationState.current?.restored;
  }, [book.id]);

  // Helper function to mark position as restored for current book
  const markPositionRestored = useCallback(() => {
    restorationState.current = { bookId: book.id, restored: true };
  }, [book.id]);

  // Reset restoration state when book changes
  useEffect(() => {
    // If book.id changed, reset restoration state to force new restoration
    if (restorationState.current && restorationState.current.bookId !== book.id) {
      restorationState.current = null;
      setIsRestoringPosition(true);
    }
  }, [book.id]);

  // Save TOC state to localStorage when it changes
  useEffect(() => {
    localStorage.setItem(`${STORAGE_KEYS.READER_SETTINGS}_toc_open`, String(isTocOpen));
  }, [isTocOpen]);

  // Wake Lock management - request/release based on setting and rendition state
  useEffect(() => {
    if (!isWakeLockSupported) return;

    if (wakeLockEnabled && renditionReady && !isRestoringPosition) {
      // Request wake lock when reader is ready and setting is enabled
      requestWakeLock();
    } else {
      // Release wake lock when disabled or reader not ready
      releaseWakeLock();
    }

    // Cleanup: release wake lock on unmount
    return () => {
      releaseWakeLock();
    };
  }, [wakeLockEnabled, renditionReady, isRestoringPosition, isWakeLockSupported, requestWakeLock, releaseWakeLock]);

  // Save wake lock preference to localStorage
  const handleWakeLockToggle = useCallback((enabled: boolean) => {
    setWakeLockEnabled(enabled);
    localStorage.setItem(WAKE_LOCK_STORAGE_KEY, String(enabled));
  }, []);

  // Clear selection menu when page changes
  useEffect(() => {
    if (currentCFI && selection) {
      clearSelection();
    }
  }, [currentCFI]); // Only depend on currentCFI, not selection/clearSelection to avoid loops // eslint-disable-line react-hooks/exhaustive-deps

  // Handle TOC chapter navigation
  const handleTocChapterClick = useCallback(async (href: string) => {
    if (!rendition) return;

    try {
      await rendition.display(href);
      setCurrentHref(href);
    } catch (err) {
      console.error('[EpubReader] Error navigating to chapter:', err);
    }
  }, [rendition, setCurrentHref]);

  /**
   * Handle copy to clipboard
   */
  const handleCopy = useCallback(async () => {
    if (!selection?.text) return;

    try {
      await navigator.clipboard.writeText(selection.text);
      notify.success('Скопировано', 'Текст скопирован в буфер обмена');

      // Close selection menu after copy
      clearSelection();
    } catch (err) {
      console.error('[EpubReader] Failed to copy text:', err);
      notify.error('Ошибка', 'Не удалось скопировать текст');
    }
  }, [selection, clearSelection]);

  /**
   * Unified position initialization - either restore saved position or show first page
   * FIXES:
   * - Race condition between displayInitial and restorePosition
   * - Shows loading overlay until position is ready
   * - Proper fallback when CFI is invalid
   * - Sync on Open: Checks localStorage backup vs server position for multi-device sync
   */
  useEffect(() => {
    if (!rendition || !renditionReady) return;

    // Skip if already restored position for this specific book
    // This is book-aware: reopening same book will trigger restoration again
    if (hasRestoredForCurrentBook()) {
      console.log('[EpubReader] ⏭️ Skipping restoration - already restored for book:', book.id);
      setIsRestoringPosition(false);
      return;
    }

    // CRITICAL FIX: Mark as restored BEFORE starting async operation
    // This prevents race condition where effect re-runs before async completes
    markPositionRestored();
    console.log('[EpubReader] 🚀 Starting position restoration for book:', book.id);

    let isMounted = true;

    const initializePosition = async () => {
      setIsRestoringPosition(true);

      try {
        // Fetch saved progress from server
        const { progress: savedProgress } = await booksAPI.getReadingProgress(book.id);

        // DEBUG: Log what we received from server
        console.log('[EpubReader] 📖 Position restoration - API response:', {
          hasProgress: !!savedProgress,
          reading_location_cfi: savedProgress?.reading_location_cfi?.substring(0, 60) || 'NONE',
          current_position: savedProgress?.current_position,
          scroll_offset_percent: savedProgress?.scroll_offset_percent,
          last_read_at: savedProgress?.last_read_at,
        });

        if (!isMounted) {
          console.log('[EpubReader] ⚠️ Component unmounted during fetch, aborting');
          return;
        }

        // Check localStorage backup for position conflict (multi-device sync)
        const localBackupKey = `book_${book.id}_progress_backup`;
        const localBackupRaw = localStorage.getItem(localBackupKey);

        console.log('[EpubReader] 📋 Conflict check:', {
          hasLocalBackup: !!localBackupRaw,
          localBackupKey,
        });

        if (localBackupRaw && savedProgress) {
          try {
            const localBackup = JSON.parse(localBackupRaw);
            const serverPercent = savedProgress.current_position || 0;
            const localPercent = localBackup.current_position || 0;
            const diff = Math.abs(serverPercent - localPercent);

            console.log('[EpubReader] 📋 Position comparison:', {
              serverPercent,
              localPercent,
              diff,
              willShowConflict: diff > 5,
            });

            // If difference > 5% - show conflict dialog
            if (diff > 5) {
              console.log('[EpubReader] ⚠️ CONFLICT DETECTED - showing dialog, NOT restoring');
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

              // Show first page while waiting for user decision
              // Don't set isRestoringPosition to false yet - user must choose
              await rendition.display();
              return; // Wait for user to choose position
            }
          } catch (_parseError) {
            // Continue with server position
          }
        }

        // No conflict or no local backup - use server position
        if (savedProgress?.reading_location_cfi) {
          // Try to restore saved position
          console.log('[EpubReader] 📖 Attempting CFI restoration:', savedProgress.reading_location_cfi.substring(0, 80));
          try {
            skipNextRelocated(); // Skip auto-save on restored position
            await goToCFI(savedProgress.reading_location_cfi, savedProgress.scroll_offset_percent || 0);

            // Set initial progress immediately so header shows correct value
            setInitialProgress(savedProgress.reading_location_cfi, savedProgress.current_position);
            console.log('[EpubReader] ✅ CFI restoration SUCCESS');
          } catch (cfiError) {
            // CFI is invalid - fallback to percentage or first page
            console.log('[EpubReader] ❌ CFI restoration FAILED:', cfiError);
            if (savedProgress.current_position > 0 && locations) {
              // Try to restore by percentage
              try {
                const fallbackCfi = locations.cfiFromPercentage(savedProgress.current_position / 100);
                if (fallbackCfi) {
                  await rendition.display(fallbackCfi);
                  setInitialProgress(fallbackCfi, savedProgress.current_position);
                } else {
                  throw new Error('Could not generate CFI from percentage');
                }
              } catch (_fallbackError) {
                await rendition.display();
              }
            } else {
              // No percentage or locations - show first page
              await rendition.display();
            }
          }
        } else {
          // No saved progress or no CFI - show first page
          console.log('[EpubReader] ⚠️ No CFI found, showing first page. savedProgress:', savedProgress ? 'exists but no CFI' : 'null');
          await rendition.display();
        }

        // Note: markPositionRestored() was called before async started to prevent race condition
      } catch (err) {
        console.error('[EpubReader] Error initializing position:', err);
        // On any error, try to show first page
        try {
          await rendition.display();
        } catch (displayErr) {
          console.error('[EpubReader] Could not even display first page:', displayErr);
        }
      } finally {
        if (isMounted && !positionConflict) {
          setIsRestoringPosition(false);
        }
      }
    };

    initializePosition();

    return () => {
      isMounted = false;
    };
  }, [rendition, renditionReady, book.id, locations, goToCFI, skipNextRelocated, setInitialProgress, positionConflict, hasRestoredForCurrentBook, markPositionRestored]);

  /**
   * Handle image regeneration
   */
  const handleImageRegenerated = useCallback((newImageUrl: string) => {
    updateImage(newImageUrl);
  }, [updateImage]);

  /**
   * Handle position conflict resolution - use server position
   */
  const handleUseServerPosition = useCallback(async () => {
    if (!rendition || !positionConflict) return;

    try {
      skipNextRelocated(); // Skip auto-save on restored position

      if (positionConflict.serverPosition.cfi) {
        await goToCFI(positionConflict.serverPosition.cfi);
        setInitialProgress(positionConflict.serverPosition.cfi, positionConflict.serverPosition.progress);
      } else if (locations && positionConflict.serverPosition.progress > 0) {
        // Fallback to percentage if no CFI
        const fallbackCfi = locations.cfiFromPercentage(positionConflict.serverPosition.progress / 100);
        if (fallbackCfi) {
          await rendition.display(fallbackCfi);
          setInitialProgress(fallbackCfi, positionConflict.serverPosition.progress);
        }
      }

      // Update local backup to match server
      const localBackupKey = `book_${book.id}_progress_backup`;
      localStorage.setItem(localBackupKey, JSON.stringify({
        reading_location_cfi: positionConflict.serverPosition.cfi,
        current_position: positionConflict.serverPosition.progress,
        savedAt: Date.now(),
      }));

      markPositionRestored();
      setPositionConflict(null);
      setIsRestoringPosition(false);

      notify.success('Позиция восстановлена', `Продолжаем с ${Math.round(positionConflict.serverPosition.progress)}%`);
    } catch (err) {
      console.error('[EpubReader] Error navigating to server position:', err);
      notify.error('Ошибка', 'Не удалось перейти к сохраненной позиции');
      setPositionConflict(null);
      setIsRestoringPosition(false);
    }
  }, [rendition, positionConflict, goToCFI, skipNextRelocated, setInitialProgress, locations, book.id, markPositionRestored]);

  /**
   * Handle position conflict resolution - use local position
   */
  const handleUseLocalPosition = useCallback(async () => {
    if (!rendition || !positionConflict) return;

    try {
      skipNextRelocated(); // Skip auto-save on restored position

      if (positionConflict.localPosition.cfi) {
        await goToCFI(positionConflict.localPosition.cfi);
        setInitialProgress(positionConflict.localPosition.cfi, positionConflict.localPosition.progress);
      } else if (locations && positionConflict.localPosition.progress > 0) {
        // Fallback to percentage if no CFI
        const fallbackCfi = locations.cfiFromPercentage(positionConflict.localPosition.progress / 100);
        if (fallbackCfi) {
          await rendition.display(fallbackCfi);
          setInitialProgress(fallbackCfi, positionConflict.localPosition.progress);
        }
      }

      markPositionRestored();
      setPositionConflict(null);
      setIsRestoringPosition(false);

      notify.success('Позиция восстановлена', `Продолжаем с ${Math.round(positionConflict.localPosition.progress)}%`);
    } catch (err) {
      console.error('[EpubReader] Error navigating to local position:', err);
      notify.error('Ошибка', 'Не удалось перейти к локальной позиции');
      setPositionConflict(null);
      setIsRestoringPosition(false);
    }
  }, [rendition, positionConflict, goToCFI, skipNextRelocated, setInitialProgress, locations, markPositionRestored]);

  // Hook 19: (LEGACY - replaced by useRenditionHealthGuard in Hook 1.5)
  // The new hook handles visibility change, pagehide, and pageshow events
  // with faster detection (100ms vs 500ms) and proactive state management.
  // This hook is kept as a safety net for edge cases where Hook 1.5 might miss.
  // It only runs a secondary check if the new guard passed but rendition is still invalid.
  useEffect(() => {
    // Secondary safety check - runs 1 second after resume if health guard passed
    // but component still seems broken (edge case protection)
    const handleVisibility = async () => {
      if (document.visibilityState === 'visible' && rendition && isRenditionHealthy) {
        setTimeout(async () => {
          try {
            // Quick validation - if this fails, the health guard should have caught it
            const loc = rendition.currentLocation();
            if (!loc || !loc.start || !loc.end) {
              throw new Error('Secondary check: Rendition still corrupted');
            }
          } catch (e) {
            // Health guard should have caught this - log for debugging
            console.warn('[EpubReader] Secondary health check failed (edge case):', e);
            // Don't trigger reload here - trust the health guard
          }
        }, 1000); // 1 second delay - well after health guard has run
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [rendition, isRenditionHealthy]);

  // Get background color based on theme - memoized to prevent recalculation
  // Use explicit colors instead of CSS variables to prevent flash during initial render
  const backgroundColor = useMemo(() => {
    switch (theme) {
      case 'light':
        return 'bg-white';
      case 'sepia':
        return 'bg-[#FBF0D9]';
      case 'dark':
        return 'bg-[#121212]';
      case 'night':
        return 'bg-black';
      default:
        return 'bg-[#121212]';
    }
  }, [theme]);

  // Theme color mapping for meta tag and body background
  const themeColors: Record<string, string> = useMemo(() => ({
    light: '#ffffff',
    dark: '#121212',
    sepia: '#FBF0D9',
    night: '#000000',
    outdoor: '#FFFEF5',
  }), []);

  // Sync theme-color meta tag and body background with reader theme
  // This ensures iOS Safari's address bar and Home Indicator area match the reader
  useEffect(() => {
    const themeColor = themeColors[theme] || themeColors.light;

    // Update body background color to extend behind safe areas
    document.body.style.backgroundColor = themeColor;

    // Update the reader-specific theme-color meta tag
    const readerThemeColorMeta = document.getElementById('reader-theme-color') as HTMLMetaElement | null;
    if (readerThemeColorMeta) {
      readerThemeColorMeta.setAttribute('content', themeColor);
    }

    // Also update the general theme-color meta tags for better PWA support
    const lightThemeMeta = document.querySelector('meta[name="theme-color"][media="(prefers-color-scheme: light)"]');
    const darkThemeMeta = document.querySelector('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]');

    if (lightThemeMeta) {
      lightThemeMeta.setAttribute('content', themeColor);
    }
    if (darkThemeMeta) {
      darkThemeMeta.setAttribute('content', themeColor);
    }

    // Cleanup: restore original colors when leaving reader
    return () => {
      document.body.style.backgroundColor = '';

      // Restore original theme colors based on system preference
      if (readerThemeColorMeta) {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        readerThemeColorMeta.setAttribute('content', prefersDark ? '#121212' : '#ffffff');
      }

      if (lightThemeMeta) {
        lightThemeMeta.setAttribute('content', '#ffffff');
      }
      if (darkThemeMeta) {
        darkThemeMeta.setAttribute('content', '#121212');
      }
    };
  }, [theme, themeColors]);



  // Main render - viewerRef MUST stay in same DOM location to prevent rendition destruction
  return (
    <div className={`relative h-full w-full transition-colors ${backgroundColor}`}>
      {/* EPUB Viewer - Maximum reading space, with safe-area support */}
      {/* Header always visible - padding accounts for 70px header height */}
      {/* Swipe touch handlers attached for swipe navigation mode */}
      <div
        ref={viewerRef}
        id="epub-viewer"
        tabIndex={-1}
        className={`h-full w-full ${backgroundColor} outline-none`}
        style={{
          paddingTop: 'calc(70px + env(safe-area-inset-top))',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          // pan-x pan-y: allows panning (harmless on fixed container), explicitly EXCLUDES pinch-zoom
          // Note: 'manipulation' = 'pan-x pan-y pinch-zoom' which ALLOWS zoom - don't use it!
          // Vertical bounce prevented by overscroll-behavior: none on container
          // Safari pinch-zoom additionally blocked by gesture event prevention in BookReaderPage
          touchAction: 'pan-x pan-y',
        }}
        {...(effectiveNavigationMode === 'swipe' ? swipeTouchHandlers : {})}
      />

      {/* Swipe Navigation Overlay - Shows visual feedback during swipe gestures */}
      {effectiveNavigationMode === 'swipe' && isMobileDevice && (
        <SwipeOverlay
          swipeState={swipeState}
          viewportWidth={typeof window !== 'undefined' ? window.innerWidth : 375}
          headerHeight={70}
        />
      )}

      {/* Tap navigation zones - only shown on iOS when NOT using swipe, or for center zone description clicks */}
      {/* On iOS with swipe mode, IOSTapZones only handles center zone for description clicks */}
      {/* On Android/Desktop with tap mode, useTouchNavigation handles navigation */}
      {isIOS() && (
        <IOSTapZones
          onPrevPage={prevPage}
          onNextPage={nextPage}
          onDescriptionClick={async (descriptionId: string) => {
            // Find description by ID
            const desc = descriptions.find(d => d.id === descriptionId);
            if (desc) {
              // Find associated image
              const img = images.find(i => i.description?.id === descriptionId);
              await openModal(desc, img);
            }
          }}
          onCenterTap={async (x: number, y: number) => {
            // NEW (January 2026): Find description at coordinates via rendition.getContents()
            // This replaces the broken BroadcastChannel/postMessage approach
            // which doesn't work with blob: URL iframes on iOS Safari
            if (!rendition) return;

            try {
              const contents = rendition.getContents();
              if (!contents || contents.length === 0) return;

              const iframe = contents[0];
              const doc = iframe.document;
              if (!doc) return;

              // Find element at the tap coordinates
              const elementAtPoint = doc.elementFromPoint(x, y);
              if (!elementAtPoint) return;

              // Walk up the DOM tree to find description-highlight
              let target: HTMLElement | null = elementAtPoint as HTMLElement;
              let descriptionId: string | null = null;

              while (target && target !== doc.body) {
                if (target.classList?.contains('description-highlight')) {
                  descriptionId = target.getAttribute('data-description-id');
                  break;
                }
                target = target.parentElement;
              }

              if (descriptionId) {
                // Found description - open modal
                const desc = descriptions.find(d => d.id === descriptionId);
                if (desc) {
                  const img = images.find(i => i.description?.id === descriptionId);
                  await openModal(desc, img);
                }
              }
            } catch (err) {
              console.error('[EpubReader] Error finding description at coordinates:', err);
            }
          }}
          enabled={!isLoading && !isGenerating && !error}
          headerHeight={70}
          navigationEnabled={effectiveNavigationMode === 'tap'}
        />
      )}

      {/* Loading Overlay - includes health check state for PWA resume */}
      {(isLoading || isGenerating || isRestoringPosition || isCheckingHealth || (!isRenditionHealthy && renditionReady)) && (
        <div
          className={`absolute inset-0 flex items-center justify-center ${backgroundColor} z-10`}
          data-testid="loading-overlay"
          aria-busy="true"
          aria-live="assertive"
          role="status"
        >
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4" aria-hidden="true"></div>
            <p className={theme === 'light' ? 'text-foreground' : theme === 'sepia' ? 'text-amber-800' : 'text-foreground'} data-testid="loading-text">
              {isCheckingHealth || (!isRenditionHealthy && renditionReady)
                ? 'Восстановление сессии...'
                : isRestoringPosition
                  ? 'Восстановление позиции...'
                  : isGenerating
                    ? 'Подготовка книги...'
                    : 'Загрузка книги...'}
            </p>
          </div>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div className={`absolute inset-0 flex items-center justify-center ${backgroundColor} z-10`}>
          <div className="text-center max-w-md mx-4">
            {/* Error Icon */}
            <div className="mb-6">
              <svg
                className="w-16 h-16 mx-auto text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>

            {/* Error Title */}
            <h3 className={`text-xl font-semibold mb-3 ${theme === 'light' ? 'text-foreground' : theme === 'sepia' ? 'text-amber-900' : 'text-foreground'}`}>
              Не удалось загрузить книгу
            </h3>

            {/* Human-readable Error Message */}
            <p className={`mb-6 ${theme === 'light' ? 'text-muted-foreground' : theme === 'sepia' ? 'text-amber-700' : 'text-muted-foreground'}`}>
              {getHumanReadableError(error)}
            </p>

            {/* Technical Error (collapsed by default, for debugging) */}
            <details className={`mb-6 text-left ${theme === 'light' ? 'text-muted-foreground' : theme === 'sepia' ? 'text-amber-600' : 'text-muted-foreground'}`}>
              <summary className="cursor-pointer text-sm hover:text-blue-500 transition-colors">
                Техническая информация
              </summary>
              <pre className={`mt-2 p-3 rounded text-xs overflow-x-auto ${theme === 'light' ? 'bg-muted' : theme === 'sepia' ? 'bg-amber-100' : 'bg-muted'}`}>
                {error}
              </pre>
            </details>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={reload}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Попробовать снова
              </button>
              <button
                onClick={() => navigate('/library')}
                className={`px-6 py-2.5 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2
                  ${theme === 'light'
                    ? 'bg-secondary hover:bg-secondary/80 text-foreground focus:ring-border'
                    : theme === 'sepia'
                      ? 'bg-amber-200 hover:bg-amber-300 text-amber-900 focus:ring-amber-400'
                      : 'bg-secondary hover:bg-secondary/80 text-foreground focus:ring-border'
                  }`}
              >
                В библиотеку
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modern Reader Header - Theme-aware with all controls and progress */}
      {/* Always visible - tap zones removed */}
      {renditionReady && !isLoading && !isGenerating && !isRestoringPosition && metadata && (
        <ReaderHeader
          title={metadata.title}
          author={metadata.creator}
          progress={progress}
          currentPage={currentPage ?? undefined}
          totalPages={totalPages ?? undefined}
          onBack={() => navigate(-1)}
          onTocToggle={() => setIsTocOpen(!isTocOpen)}
          onInfoOpen={() => setIsBookInfoOpen(true)}
          onSettingsOpen={() => setIsSettingsOpen(true)}
        />
      )}

      {/* Settings Dropdown (hidden, triggered by header button) */}
      {renditionReady && !isLoading && !isGenerating && !isRestoringPosition && (
        <div className="fixed top-16 right-4 z-[100]">
          <ReaderControls
            theme={theme}
            fontSize={fontSize}
            onThemeChange={setTheme}
            onFontSizeIncrease={increaseFontSize}
            onFontSizeDecrease={decreaseFontSize}
            isOpen={isSettingsOpen}
            onOpenChange={setIsSettingsOpen}
            wakeLockEnabled={wakeLockEnabled}
            wakeLockSupported={isWakeLockSupported}
            wakeLockActive={isWakeLockActive}
            onWakeLockChange={handleWakeLockToggle}
            navigationMode={navigationMode}
            onNavigationModeChange={updateNavigationMode}
          />
        </div>
      )}

      {/* Description Extraction Indicator - Prominent floating card */}
      <ExtractionIndicator
        isExtracting={isExtractingDescriptions}
        onCancel={cancelExtraction}
      />

      {/* Image Generation Status */}
      <ImageGenerationStatus
        status={generationStatus}
        descriptionPreview={descriptionPreview}
        error={generationError}
        onCancel={cancelGeneration}
      />

      {/* Progress Save Indicator */}
      <ProgressSaveIndicator
        lastSaved={lastSaved}
        isSaving={isSaving}
      />

      {/* Position Conflict Dialog - Multi-device sync */}
      {positionConflict && (
        <PositionConflictDialog
          isOpen={!!positionConflict}
          serverPosition={positionConflict.serverPosition}
          localPosition={positionConflict.localPosition}
          onUseServer={handleUseServerPosition}
          onUseLocal={handleUseLocalPosition}
        />
      )}

      {/* Image Modal */}
      {isModalOpen && selectedImage && (
        <ImageModal
          imageUrl={selectedImage.image_url}
          title={selectedImage.description?.type || 'Generated Image'}
          description={selectedImage.description?.text || selectedImage.description?.content || ''}
          imageId={selectedImage.id}
          descriptionData={selectedImage.description ? {
            id: selectedImage.description.id,
            type: selectedImage.description.type,
            content: selectedImage.description.text || selectedImage.description.content,
            confidence_score: 0,
            priority_score: selectedImage.description.priority_score,
            entities_mentioned: []
          } : undefined}
          isOpen={isModalOpen}
          onClose={closeModal}
          onImageRegenerated={handleImageRegenerated}
        />
      )}


      {/* Book Info Modal */}
      {isBookInfoOpen && metadata && (
        <BookInfo
          metadata={metadata}
          isOpen={isBookInfoOpen}
          onClose={() => setIsBookInfoOpen(false)}
        />
      )}

      {/* Selection Menu */}
      <SelectionMenu
        selection={selection}
        onCopy={handleCopy}
        onClose={clearSelection}
      />

      {/* TOC Sidebar */}
      <TocSidebar
        toc={toc}
        currentHref={currentHref}
        onChapterClick={handleTocChapterClick}
        isOpen={isTocOpen}
        onClose={() => setIsTocOpen(false)}
      />

      {/* iOS Debug Overlay - DISABLED FOR PRODUCTION
      <IOSDebugOverlay />
      */}

    </div>
  );
};
