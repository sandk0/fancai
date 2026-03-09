import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { m, AnimatePresence } from 'motion/react';
import { ArrowLeft, List, Info, Settings, Library, Search } from 'lucide-react';

const HEADER_SPRING = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 35,
  mass: 1,
};

interface ReaderHeaderProps {
  /** Whether the header is visible (controlled by auto-hide) */
  isVisible: boolean;
  title: string;
  author: string;
  progress: number;
  currentPage?: number;
  totalPages?: number;
  onBack: () => void;
  onTocToggle: () => void;
  onInfoOpen: () => void;
  onSettingsOpen: () => void;
  onEntitiesOpen: () => void;
  onSearchToggle: () => void;
}

export const ReaderHeader = memo(function ReaderHeader({
  isVisible,
  title,
  author,
  progress,
  currentPage,
  totalPages,
  onBack,
  onTocToggle,
  onInfoOpen,
  onSettingsOpen,
  onEntitiesOpen,
  onSearchToggle,
}: ReaderHeaderProps) {
  const { t } = useTranslation();

  return (
    <AnimatePresence>
      {isVisible && (
        <m.div
          key="reader-header"
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={HEADER_SPRING}
          className="fixed left-0 right-0 z-10 backdrop-blur-md border-b bg-card/95 border-border top-0 mt-safe"
        >
          <div className="flex items-center justify-between px-4 py-3 gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={onBack}
                className="min-h-[44px] min-w-[44px] flex items-center gap-2 px-3 py-2 rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
                title={t('reader.header.back')}
                aria-label={t('reader.header.back')}
              >
                <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                <span className="hidden sm:inline font-medium">{t('reader.header.back')}</span>
              </button>
              <button
                onClick={onTocToggle}
                className="flex items-center justify-center w-11 h-11 rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
                title={t('reader.header.toc')}
                aria-label={t('reader.header.toc')}
              >
                <List className="w-5 h-5" aria-hidden="true" />
              </button>
              <button
                onClick={onInfoOpen}
                className="flex items-center justify-center w-11 h-11 rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
                title={t('reader.header.info')}
                aria-label={t('reader.header.info')}
              >
                <Info className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <div className="hidden md:block flex-1 px-2 text-center min-w-0">
              <h1 className="text-lg font-semibold truncate text-foreground">{title}</h1>
              <p className="text-sm truncate text-muted-foreground">{author}</p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex flex-col items-end gap-1 min-w-[100px] sm:min-w-[140px]">
                <div className="flex items-center gap-1.5 sm:gap-2 text-xs text-muted-foreground">
                  {currentPage !== undefined && totalPages !== undefined && (
                    <span className="font-medium text-xs sm:text-sm">
                      {currentPage}/{totalPages}
                    </span>
                  )}
                  <span className="font-bold text-sm sm:text-base tabular-nums text-foreground">
                    {progress < 10 ? progress.toFixed(1) : Math.round(progress)}%
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={t('reader.header.progress_label', { percent: Math.round(progress) })}
                  className="w-full h-2 sm:h-1.5 rounded-full overflow-hidden bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                    style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                  />
                </div>
              </div>
              <button
                onClick={onEntitiesOpen}
                className="flex items-center justify-center w-11 h-11 rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
                title={t('reader.header.entities')}
                aria-label={t('reader.header.entities')}
              >
                <Library className="w-5 h-5" aria-hidden="true" />
              </button>
              <button
                onClick={onSearchToggle}
                className="flex items-center justify-center w-11 h-11 rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
                title={t('reader.header.search')}
                aria-label={t('reader.header.search')}
              >
                <Search className="w-5 h-5" aria-hidden="true" />
              </button>
              <button
                onClick={onSettingsOpen}
                className="flex items-center justify-center w-11 h-11 rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
                title={t('reader.header.settings')}
                aria-label={t('reader.header.settings')}
              >
                <Settings className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
});
