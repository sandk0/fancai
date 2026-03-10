import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { m, AnimatePresence } from 'motion/react';
import { ArrowLeft, List, Settings, Library, Search, MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/UI/dropdown-menu';

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
  onSettingsOpen,
  onEntitiesOpen,
  onSearchToggle,
}: ReaderHeaderProps) {
  const { t } = useTranslation();

  const clampedProgress = Math.min(100, Math.max(0, progress));
  const progressText = progress < 10 ? progress.toFixed(1) : String(Math.round(progress));

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
          <div className="flex items-center justify-between px-2 xs:px-4 py-3 gap-2">
            {/* Left: Back + TOC (from xs) */}
            <div className="flex items-center gap-1 xs:gap-2 shrink-0">
              <button
                onClick={onBack}
                className="min-h-[44px] min-w-[44px] touch-target flex items-center gap-2 px-3 py-2 rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
                title={t('reader.header.back')}
                aria-label={t('reader.header.back')}
              >
                <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                <span className="hidden sm:inline font-medium">{t('reader.header.back')}</span>
              </button>
              {/* TOC button -- visible from xs (375px) */}
              <button
                onClick={onTocToggle}
                className="hidden xs:flex items-center justify-center w-11 h-11 touch-target rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
                title={t('reader.header.toc')}
                aria-label={t('reader.header.toc')}
              >
                <List className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {/* Center: Progress (adaptive) + Title on md */}
            <div className="flex-1 flex flex-col items-center min-w-0 gap-0.5">
              {/* Book title + author -- only md+ */}
              <h1 className="hidden md:block text-sm font-semibold truncate max-w-[240px] text-foreground">
                {title}
              </h1>
              <p className="hidden md:block text-xs truncate max-w-[200px] text-muted-foreground">
                {author}
              </p>

              {/* Progress row */}
              <div className="flex items-center gap-1.5">
                {/* Page/total -- only sm+ */}
                {currentPage !== undefined && totalPages !== undefined && (
                  <span className="hidden sm:inline font-medium text-xs text-muted-foreground">
                    {currentPage}/{totalPages}
                  </span>
                )}
                <span className="font-bold text-sm tabular-nums text-foreground">
                  {progressText}%
                </span>
              </div>

              {/* Progress bar -- only xs+ (375px) */}
              <div
                role="progressbar"
                aria-valuenow={clampedProgress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('reader.header.progress_label', { percent: Math.round(progress) })}
                className="hidden xs:block w-full max-w-[200px] h-1.5 rounded-full overflow-hidden bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                  style={{ width: `${clampedProgress}%` }}
                />
              </div>
            </div>

            {/* Right: action buttons + overflow */}
            <div className="flex items-center gap-1 xs:gap-2 shrink-0">
              {/* Entities -- visible from sm (640px) */}
              <button
                onClick={onEntitiesOpen}
                className="hidden sm:flex items-center justify-center w-11 h-11 touch-target rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
                title={t('reader.header.entities')}
                aria-label={t('reader.header.entities')}
              >
                <Library className="w-5 h-5" aria-hidden="true" />
              </button>
              {/* Search -- visible from sm (640px) */}
              <button
                onClick={onSearchToggle}
                className="hidden sm:flex items-center justify-center w-11 h-11 touch-target rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
                title={t('reader.header.search')}
                aria-label={t('reader.header.search')}
              >
                <Search className="w-5 h-5" aria-hidden="true" />
              </button>
              {/* Settings -- visible from md (768px) */}
              <button
                onClick={onSettingsOpen}
                className="hidden md:flex items-center justify-center w-11 h-11 touch-target rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
                title={t('reader.header.settings')}
                aria-label={t('reader.header.settings')}
              >
                <Settings className="w-5 h-5" aria-hidden="true" />
              </button>

              {/* Overflow menu -- hidden from md (768px) */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="md:hidden flex items-center justify-center w-11 h-11 touch-target rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
                    title={t('reader.header.more')}
                    aria-label={t('reader.header.more')}
                  >
                    <MoreVertical className="w-5 h-5" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {/* TOC -- show in overflow only below xs (375px) */}
                  <DropdownMenuItem onClick={onTocToggle} className="xs:hidden">
                    <List className="w-5 h-5" aria-hidden="true" />
                    <span>{t('reader.header.toc')}</span>
                  </DropdownMenuItem>
                  {/* Entities -- show in overflow below sm (640px) */}
                  <DropdownMenuItem onClick={onEntitiesOpen} className="sm:hidden">
                    <Library className="w-5 h-5" aria-hidden="true" />
                    <span>{t('reader.header.entities')}</span>
                  </DropdownMenuItem>
                  {/* Search -- show in overflow below sm (640px) */}
                  <DropdownMenuItem onClick={onSearchToggle} className="sm:hidden">
                    <Search className="w-5 h-5" aria-hidden="true" />
                    <span>{t('reader.header.search')}</span>
                  </DropdownMenuItem>
                  {/* Settings -- show in overflow below md (768px) */}
                  <DropdownMenuItem onClick={onSettingsOpen} className="md:hidden">
                    <Settings className="w-5 h-5" aria-hidden="true" />
                    <span>{t('reader.header.settings')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
});
