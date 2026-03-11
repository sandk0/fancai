/**
 * useCFITracking - Custom hook for tracking EPUB CFI positions and progress
 *
 * CFI (Canonical Fragment Identifier) is an EPUB standard for precise location tracking.
 * This hook manages:
 * - Current reading position (CFI)
 * - Progress percentage (0-100)
 * - Current page number and total pages (from epub.js locations)
 * - Position restoration from saved CFI
 * - Hybrid CFI + scroll offset for pixel-perfect restoration
 *
 * Fixes the CFI jump issue where epub.js rounds to nearest paragraph.
 *
 * Page Numbers:
 * - Uses epub.js locations.locationFromCfi() to convert CFI → page number
 * - Page numbers are 1-based (first page = 1, not 0)
 * - Total pages comes from locations.total
 * - Both return null until locations are generated
 *
 * @param rendition - epub.js Rendition instance
 * @param locations - Generated locations for progress calculation
 * @param book - epub.js Book instance
 * @returns Current CFI, progress, page numbers, and navigation functions
 *
 * @example
 * const {
 *   currentCFI,
 *   progress,
 *   currentPage,
 *   totalPages,
 *   goToCFI,
 *   skipNextRelocated
 * } = useCFITracking(rendition, locations, book);
 *
 * // Display: "Стр. 42/500 (8%)"
 * logger.debug(`Стр. ${currentPage}/${totalPages} (${progress}%)`);
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Rendition, Book, EpubLocationEvent, EpubLocations } from '@/types/epub';
import { logger } from '@/lib/logger';

const devLog = (...args: unknown[]) => {
  logger.debug('[useCFITracking]', ...args);
};

/**
 * Validate CFI format
 * CFI must start with "epubcfi(" and end with ")"
 * Basic validation to catch corrupted or malformed CFIs
 */
const isValidCFI = (cfi: string): boolean => {
  if (!cfi || typeof cfi !== 'string') return false;

  // Basic CFI format: epubcfi(/6/4!/4/2/...)
  const cfiPattern = /^epubcfi\([^)]+\)$/;

  if (!cfiPattern.test(cfi)) {
    devLog('CFI Validation warning: Invalid CFI format:', cfi.substring(0, 50));
    return false;
  }

  // Check for minimum length (shortest valid CFI is ~15 chars)
  if (cfi.length < 15) {
    devLog('CFI Validation warning: CFI too short:', cfi);
    return false;
  }

  return true;
};

interface UseCFITrackingOptions {
  rendition: Rendition | null;
  locations: EpubLocations | null;
  book: Book | null;
  onLocationChange?: (cfi: string, progress: number, scrollOffset: number) => void;
}

interface UseCFITrackingReturn {
  currentCFI: string;
  progress: number;
  scrollOffsetPercent: number;
  currentPage: number | null;
  totalPages: number | null;
  chapterPage: number | null;
  chapterTotalPages: number | null;
  goToCFI: (cfi: string, scrollOffset?: number) => Promise<void>;
  skipNextRelocated: () => void;
  setInitialProgress: (cfi: string, progressPercent: number) => void;
}

export const useCFITracking = ({
  rendition,
  locations,
  book, // Used for fallback progress calculation before locations are ready
  onLocationChange,
}: UseCFITrackingOptions): UseCFITrackingReturn => {
  const [currentCFI, setCurrentCFI] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [scrollOffsetPercent, setScrollOffsetPercent] = useState<number>(0);
  const [chapterPage, setChapterPage] = useState<number | null>(null);
  const [chapterTotalPages, setChapterTotalPages] = useState<number | null>(null);

  const restoredCfiRef = useRef<string | null>(null);

  /**
   * Set initial progress manually (used during position restoration)
   */
  const setInitialProgress = useCallback((cfi: string, progressPercent: number) => {
    devLog('Navigation: Setting initial progress:', {
      cfi: cfi.substring(0, 50) + '...',
      progress: progressPercent + '%',
    });
    setCurrentCFI(cfi);
    setProgress(progressPercent);
  }, []);

  /**
   * Skip the next relocated event (used during restoration)
   */
  const skipNextRelocated = useCallback(() => {
    restoredCfiRef.current = currentCFI;
    devLog('Skip flag: Next relocated event will be skipped');
  }, [currentCFI]);

  /**
   * Navigate to a specific CFI with optional scroll offset
   * Validates CFI format before navigation and throws error if invalid
   */
  const goToCFI = useCallback(
    async (cfi: string, scrollOffset?: number) => {
      if (!rendition || !cfi) return;

      // Validate CFI format before attempting navigation
      if (!isValidCFI(cfi)) {
        throw new Error(`Invalid CFI format: ${cfi.substring(0, 50)}...`);
      }

      try {
        devLog('Navigation: Navigating to CFI:', cfi.substring(0, 80) + '...');

        // Mark this CFI as restored to skip auto-save
        restoredCfiRef.current = cfi;

        // Display the CFI
        await rendition.display(cfi);

        // Wait for rendering to complete
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Apply scroll offset if provided (hybrid approach)
        if (scrollOffset !== undefined && scrollOffset > 0) {
          devLog('Scroll offset: Applying scroll offset:', scrollOffset.toFixed(2) + '%');

          await new Promise((resolve) => setTimeout(resolve, 200));

          const contents = rendition.getContents();
          if (contents && contents.length > 0) {
            const iframe = contents[0];
            const doc = iframe.document;

            if (doc && doc.documentElement) {
              const scrollHeight = doc.documentElement.scrollHeight || doc.body?.scrollHeight || 0;
              const clientHeight = doc.documentElement.clientHeight || doc.body?.clientHeight || 0;
              const maxScroll = scrollHeight - clientHeight;

              if (maxScroll > 0) {
                const targetScrollTop = (scrollOffset / 100) * maxScroll;
                doc.documentElement.scrollTop = targetScrollTop;
                if (doc.body) {
                  doc.body.scrollTop = targetScrollTop;
                }

                devLog('Success: Scroll offset applied:', {
                  targetScrollTop,
                  maxScroll,
                  requestedOffset: scrollOffset.toFixed(2) + '%',
                });
              }
            }
          }
        }
      } catch (err) {
        logger.error('[useCFITracking] Error navigating to CFI:', err);
      }
    },
    [rendition]
  );

  /**
   * Calculate scroll offset percentage within current page
   */
  const calculateScrollOffset = useCallback((): number => {
    if (!rendition) return 0;

    try {
      const contents = rendition.getContents();
      if (!contents || contents.length === 0) return 0;

      const iframe = contents[0];
      const doc = iframe.document;

      if (!doc || !doc.documentElement) return 0;

      const scrollTop = doc.documentElement.scrollTop || doc.body?.scrollTop || 0;
      const scrollHeight = doc.documentElement.scrollHeight || doc.body?.scrollHeight || 0;
      const clientHeight = doc.documentElement.clientHeight || doc.body?.clientHeight || 0;
      const maxScroll = scrollHeight - clientHeight;

      if (maxScroll <= 0) return 0;

      return (scrollTop / maxScroll) * 100;
    } catch (err) {
      devLog('Warning: Error calculating scroll offset:', err);
      return 0;
    }
  }, [rendition]);

  /**
   * UNIFIED Relocated Handler - Single source of truth for progress tracking
   *
   * CRITICAL FIX: Previously there were TWO separate effects registering handlers,
   * causing race conditions where the second handler would overwrite progress with 0.
   *
   * This unified handler:
   * 1. Works immediately when rendition is ready (spine-based fallback)
   * 2. Upgrades to location-based precision when locations become available
   * 3. Properly validates percentageFromCfi return values
   * 4. Handles position restoration skip logic
   */
  useEffect(() => {
    if (!rendition) return;

    devLog('Setting up UNIFIED relocated listener', {
      hasLocations: !!locations,
      locationsTotal: locations?.total,
      hasBook: !!book,
      spineItemsCount: book?.spine?.items?.length || book?.spine?.length || 0,
    });

    const handleRelocated = (location: EpubLocationEvent) => {
      const cfi = location.start.cfi;

      devLog('📍 RELOCATED event fired:', {
        cfi: cfi?.substring(0, 50),
        percentage: location?.start?.percentage,
        spineIndex: location?.start?.index,
        displayedPage: location?.start?.displayed?.page,
        displayedTotal: location?.start?.displayed?.total,
        hasLocations: !!locations,
        locationsTotal: locations?.total,
        hasRestoredCfi: !!restoredCfiRef.current,
      });

      // Track if this is a restoration event - we still update state but skip save callback
      // CRITICAL FIX: Previously we returned early and skipped ALL updates, which left
      // progress at 0 if server returned 0 (old data before fix)
      let isRestorationEvent = false;
      if (restoredCfiRef.current) {
        if (cfi === restoredCfiRef.current) {
          devLog('🔄 Restoration event detected - will update state but skip save');
          isRestorationEvent = true;
        }
        restoredCfiRef.current = null; // Clear in both cases
      }

      // Always update CFI
      setCurrentCFI(cfi);

      // Calculate progress - try multiple methods in order of precision
      let progressPercent: number | null = null;

      // ALWAYS calculate spine-based progress first (for cross-validation)
      // This is more reliable on mobile where percentageFromCfi() can return 0 incorrectly
      const spineIndex = location.start.index;
      const displayedPage = location.start.displayed?.page || 1;
      const displayedTotal = location.start.displayed?.total || 1;
      setChapterPage(displayedPage);
      setChapterTotalPages(displayedTotal);
      const totalSpineItems = book?.spine?.items?.length || book?.spine?.length || 0;
      let spineBasedProgress: number | null = null;

      if (totalSpineItems > 0 && spineIndex !== undefined && spineIndex >= 0) {
        const withinSectionProgress = displayedPage / displayedTotal;
        const spineProgress = ((spineIndex + withinSectionProgress) / totalSpineItems) * 100;
        spineBasedProgress = Math.min(100, Math.max(0, Math.round(spineProgress * 10) / 10));
        devLog('Spine-based progress (for validation):', spineBasedProgress + '%');
      }

      // Method 1: Use locations.percentageFromCfi (most precise, only after locations ready)
      if (locations && locations.total > 0) {
        try {
          const locationPercentage = locations.percentageFromCfi(cfi);
          devLog('Locations percentageFromCfi result:', locationPercentage);

          // Validate the result - must be a valid number between 0 and 1
          if (
            typeof locationPercentage === 'number' &&
            !Number.isNaN(locationPercentage) &&
            locationPercentage >= 0 &&
            locationPercentage <= 1
          ) {
            const locationsProgress = Math.round(locationPercentage * 1000) / 10;

            // CROSS-VALIDATION FIX (2026-01-06): epub.js Issue #278
            // On mobile, percentageFromCfi() often returns 0 incorrectly
            // If locations says 0% but spine says we're NOT at start (>3%), trust spine
            if (locationsProgress === 0 && spineBasedProgress !== null && spineBasedProgress > 3) {
              devLog(
                '⚠️ Cross-validation: locations=0% but spine=' +
                  spineBasedProgress +
                  '%, using spine'
              );
              progressPercent = spineBasedProgress;
            } else {
              progressPercent = locationsProgress;
              devLog('Progress from locations:', progressPercent + '%');
            }
          } else {
            devLog('⚠️ Invalid locationPercentage:', locationPercentage);
          }
        } catch (err) {
          devLog('⚠️ Error calling percentageFromCfi:', err);
        }
      }

      // Method 2: Use epub.js built-in percentage (available after locations)
      if (progressPercent === null && location.start.percentage !== undefined) {
        const builtInPercentage = location.start.percentage;
        if (
          typeof builtInPercentage === 'number' &&
          !Number.isNaN(builtInPercentage) &&
          builtInPercentage >= 0 &&
          builtInPercentage <= 1
        ) {
          const builtInProgress = Math.round(builtInPercentage * 100);

          // CROSS-VALIDATION: Same check for built-in percentage
          if (builtInProgress === 0 && spineBasedProgress !== null && spineBasedProgress > 3) {
            devLog(
              '⚠️ Cross-validation: built-in=0% but spine=' + spineBasedProgress + '%, using spine'
            );
            progressPercent = spineBasedProgress;
          } else {
            progressPercent = builtInProgress;
            devLog('Progress from built-in percentage:', progressPercent + '%');
          }
        }
      }

      // Method 3: Use spine-based progress as final fallback
      if (progressPercent === null && spineBasedProgress !== null) {
        progressPercent = spineBasedProgress;
        devLog('Progress from spine (fallback):', progressPercent + '%');
      }

      // Final validation and state update
      // CRITICAL FIX (2026-01-06): Skip setProgress during restoration events on mobile
      // On mobile, epub.js percentageFromCfi() returns 0 incorrectly (GitHub Issue #278)
      // During restoration, setInitialProgress() already set the correct server value
      // If we overwrite with calculated 0%, the progress display breaks
      if (progressPercent !== null && !Number.isNaN(progressPercent)) {
        progressPercent = Math.min(100, Math.max(0, progressPercent));

        // Only update progress if NOT a restoration event
        // Restoration events should keep the value from setInitialProgress()
        if (!isRestorationEvent) {
          setProgress(progressPercent);
        } else {
          devLog('📌 Skipped setProgress during restoration - keeping server value');
        }
      } else {
        devLog('⚠️ Could not calculate progress - keeping previous value');
      }

      // Calculate scroll offset
      const scrollOffset = calculateScrollOffset();
      setScrollOffsetPercent(scrollOffset);

      devLog('Final state update:', {
        cfi: cfi.substring(0, 50) + '...',
        progress: progressPercent !== null ? progressPercent + '%' : 'unchanged',
        scrollOffset: scrollOffset.toFixed(2) + '%',
        isRestorationEvent,
      });

      // Callback for external handling (e.g., save to backend)
      // SKIP on restoration to prevent re-saving the same position we just loaded
      if (onLocationChange && progressPercent !== null && !isRestorationEvent) {
        onLocationChange(cfi, progressPercent, scrollOffset);
      } else if (isRestorationEvent) {
        devLog('📌 Skipped save callback - restoration event');
      }
    };

    rendition.on('relocated', handleRelocated as (...args: unknown[]) => void);

    return () => {
      rendition.off('relocated', handleRelocated as (...args: unknown[]) => void);
    };
  }, [rendition, locations, book, onLocationChange, calculateScrollOffset]);

  /**
   * Get total "pages" from locations
   * Note: These are character-based markers (every ~1600 chars), not actual rendered pages
   * Returns null if locations aren't generated yet
   */
  const totalPages = useMemo(() => {
    if (!locations || !locations.total) {
      devLog('Total pages: locations not available');
      return null;
    }
    devLog('Total pages from locations:', locations.total);
    return locations.total;
  }, [locations]);

  /**
   * Get current "page" (location index)
   * Uses locationFromCfi when available, falls back to progress-based calculation
   */
  const currentPage = useMemo(() => {
    if (!locations || !locations.total) {
      devLog('Current page: locations not available');
      return null;
    }

    // Method 1: Use locationFromCfi (direct mapping)
    if (currentCFI) {
      try {
        const pageNumber = locations.locationFromCfi(currentCFI);
        devLog('locationFromCfi result:', pageNumber);
        if (pageNumber !== -1 && pageNumber >= 0) {
          // locationFromCfi returns 0-based index, add 1 for display
          const displayPage = pageNumber + 1;
          devLog('Page: Current page from CFI:', displayPage, '/', locations.total);
          return displayPage;
        }
      } catch (err) {
        devLog('Warning: Could not get page from CFI:', err);
      }
    }

    // Method 2: Calculate from progress percentage
    // Handles mobile browsers where locationFromCfi may return -1
    if (progress > 0 && locations.total > 0) {
      const approximatePage = Math.max(1, Math.round((progress / 100) * locations.total));
      devLog('Page: Approximate page from progress:', approximatePage, '/', locations.total);
      return approximatePage;
    }

    // At the beginning of the book
    return 1;
  }, [locations, currentCFI, progress]);

  return {
    currentCFI,
    progress,
    scrollOffsetPercent,
    currentPage,
    totalPages,
    chapterPage,
    chapterTotalPages,
    goToCFI,
    skipNextRelocated,
    setInitialProgress,
  };
};
