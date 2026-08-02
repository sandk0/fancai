import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { m, AnimatePresence } from 'motion/react';

const FOOTER_SPRING = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 35,
  mass: 1,
};

interface ReaderFooterProps {
  /** Whether the footer is visible (synced with header auto-hide) */
  isVisible: boolean;
  /** Reading progress 0-100 */
  progress: number;
  /** Global page number (location-based) */
  currentPage?: number;
  /** Global total pages */
  totalPages?: number;
  /** Current page within chapter (displayed.page) */
  chapterPage?: number;
  /** Total pages within chapter (displayed.total) */
  chapterTotalPages?: number;
}

export const ReaderFooter = memo(function ReaderFooter({
  isVisible,
  progress,
  currentPage,
  totalPages,
  chapterPage,
  chapterTotalPages,
}: ReaderFooterProps) {
  const { t } = useTranslation();

  const clampedProgress = Math.min(100, Math.max(0, progress));
  const progressText = progress < 10 ? progress.toFixed(1) : String(Math.round(progress));

  const hasPageInfo = currentPage !== undefined && totalPages !== undefined;
  const pagesLeft =
    chapterPage !== undefined && chapterTotalPages !== undefined
      ? chapterTotalPages - chapterPage
      : null;

  return (
    <AnimatePresence>
      {isVisible && (
        <m.div
          key="reader-footer"
          initial={{ y: 60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 60, opacity: 0 }}
          transition={FOOTER_SPRING}
          className="fixed left-0 right-0 bottom-0 mb-safe z-10 backdrop-blur-md bg-card/95 border-t border-border"
        >
          {/* Progress row */}
          <div className="flex items-center gap-2 px-4 pt-3 pb-1">
            <div
              role="progressbar"
              aria-valuenow={clampedProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('reader.footer.progress_label', { percent: Math.round(progress) })}
              data-testid="reader-progress-bar"
              className="flex-1 h-1.5 rounded-full overflow-hidden bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                style={{ width: `${clampedProgress}%` }}
              />
            </div>
            <span className="text-xs font-bold tabular-nums text-foreground shrink-0">
              {progressText}%
            </span>
          </div>

          {/* Pages row */}
          {hasPageInfo && (
            <div className="flex items-center justify-between px-4 pb-3 pt-0">
              <span className="text-xs text-muted-foreground" data-testid="reader-page-indicator">
                {t('reader.footer.page_of', { current: currentPage, total: totalPages })}
              </span>
              {pagesLeft !== null && pagesLeft >= 0 && (
                <span className="text-xs text-muted-foreground">
                  {t('reader.footer.pages_left', { count: pagesLeft })}
                </span>
              )}
            </div>
          )}
        </m.div>
      )}
    </AnimatePresence>
  );
});
