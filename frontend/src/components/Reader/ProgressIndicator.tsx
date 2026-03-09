/**
 * ProgressIndicator - Visual reading progress indicator for EPUB reader
 *
 * Displays current progress, chapter, and page information.
 * Uses semantic Tailwind classes for consistent theming.
 *
 * @component
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

interface ProgressIndicatorProps {
  progress: number; // 0-100
  currentChapter: number;
  totalChapters?: number;
  currentPage?: number;
  totalPages?: number;
  isVisible?: boolean;
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = React.memo(
  function ProgressIndicator({
    progress,
    currentChapter,
    totalChapters,
    currentPage,
    totalPages,
    isVisible = true,
  }) {
    const { t } = useTranslation();

    if (!isVisible) return null;

    return (
      <div
        className="absolute left-1/2 -translate-x-1/2 z-10 bg-popover/90 backdrop-blur-sm rounded-lg px-4 py-2 shadow-lg border border-border"
        style={{
          bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px) + var(--keyboard-height, 0px))',
          transition: 'bottom 0.15s ease-out',
        }}
      >
        <div className="flex items-center gap-2 sm:gap-4 min-w-[140px] sm:min-w-[200px]">
          {/* Progress percentage */}
          <div className="text-sm font-medium tabular-nums text-popover-foreground">
            {progress < 10 ? progress.toFixed(1) : Math.round(progress)}%
          </div>

          {/* Progress bar */}
          <div className="flex-1">
            <div
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('reader.progress.aria_label', 'Reading progress')}
              className="h-2 bg-muted rounded-full overflow-hidden"
            >
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="text-xs text-muted-foreground flex items-center gap-2">
            {totalChapters && (
              <span>
                {t('reader.progress.chapter_short', {
                  current: currentChapter,
                  total: totalChapters,
                })}
              </span>
            )}
            {!totalChapters && (
              <span>{t('reader.progress.chapter_only', { current: currentChapter })}</span>
            )}
            {totalPages && currentPage && (
              <>
                <span>•</span>
                <span>
                  {t('reader.progress.page_short', { current: currentPage, total: totalPages })}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }
);
