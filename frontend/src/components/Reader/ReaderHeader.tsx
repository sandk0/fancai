/**
 * ReaderHeader - Theme-aware header with navigation, progress, and controls
 *
 * Features:
 * - Back button with navigation
 * - Book title and author
 * - TOC button (icon only)
 * - Book Info button (icon only)
 * - Compact progress bar with page counter
 * - Settings button
 * - Fully theme-aware (Light/Dark/Sepia)
 *
 * @component
 */

import { memo } from 'react';
import { ArrowLeft, List, Info, Settings, Users } from 'lucide-react';

interface ReaderHeaderProps {
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
}

/**
 * ReaderHeader - Memoized header with navigation and progress
 *
 * Optimization rationale:
 * - Rendered on every progress update (frequent) - memo prevents full re-renders
 * - Callbacks come from parent (EpubReader) which already uses useCallback
 */
export const ReaderHeader = memo(function ReaderHeader({
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
}: ReaderHeaderProps) {
  return (
    <div className="absolute left-0 right-0 z-10 backdrop-blur-md border-b bg-card/95 border-border top-0 mt-safe">
      <div className="flex items-center justify-between px-4 py-3 gap-3">
        {/* Left: Back button + TOC + Book Info */}
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="min-h-[44px] min-w-[44px] flex items-center gap-2 px-3 py-2 rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
            title="Назад"
            aria-label="Назад"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="hidden sm:inline font-medium">Назад</span>
          </button>

          <button
            onClick={onTocToggle}
            className="flex items-center justify-center w-11 h-11 rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
            title="Содержание"
          >
            <List className="w-5 h-5" />
          </button>

          <button
            onClick={onInfoOpen}
            className="flex items-center justify-center w-11 h-11 rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
            title="О книге"
          >
            <Info className="w-5 h-5" />
          </button>
        </div>

        {/* Center: Book title and author - hidden on mobile */}
        <div className="hidden md:block flex-1 px-2 text-center min-w-0">
          <h1 className="text-lg font-semibold truncate text-foreground">
            {title}
          </h1>
          <p className="text-sm truncate text-muted-foreground">
            {author}
          </p>
        </div>

        {/* Right: Compact Progress + Settings */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Compact Progress Bar */}
          <div className="flex flex-col items-end gap-1 min-w-[100px] sm:min-w-[140px]">
            {/* Progress Info - Above the bar */}
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

            {/* Progress Bar */}
            <div
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Reading progress: ${progress}%`}
              className="w-full h-2 sm:h-1.5 rounded-full overflow-hidden bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
          </div>

          {/* Entities Button */}
          <button
            onClick={onEntitiesOpen}
            className="flex items-center justify-center w-11 h-11 rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
            title="Персонажи"
          >
            <Users className="w-5 h-5" />
          </button>

          {/* Settings Button */}
          <button
            onClick={onSettingsOpen}
            className="flex items-center justify-center w-11 h-11 rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
            title="Настройки"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
});
