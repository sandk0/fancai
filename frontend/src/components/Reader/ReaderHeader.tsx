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
  onBack,
  onTocToggle,
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

            {/* Center: Title + Author (md+ only), flex-1 spacer */}
            <div className="flex-1 flex flex-col items-center min-w-0">
              <h1 className="hidden md:block text-sm font-semibold truncate max-w-[240px] text-foreground">
                {title}
              </h1>
              <p className="hidden md:block text-xs truncate max-w-[200px] text-muted-foreground">
                {author}
              </p>
            </div>

            {/* Right: action buttons + overflow */}
            <div className="flex items-center gap-1 xs:gap-2 shrink-0">
              {/* Entities -- ALWAYS visible (AI core feature, priority) */}
              <button
                onClick={onEntitiesOpen}
                className="flex items-center justify-center w-11 h-11 touch-target rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
                title={t('reader.header.entities')}
                aria-label={t('reader.header.entities')}
              >
                <Library className="w-5 h-5" aria-hidden="true" />
              </button>
              {/* Search -- visible from xs (375px) */}
              <button
                onClick={onSearchToggle}
                className="hidden xs:flex items-center justify-center w-11 h-11 touch-target rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
                title={t('reader.header.search')}
                aria-label={t('reader.header.search')}
              >
                <Search className="w-5 h-5" aria-hidden="true" />
              </button>
              {/* Settings -- ALWAYS visible */}
              <button
                onClick={onSettingsOpen}
                className="flex items-center justify-center w-11 h-11 touch-target rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
                title={t('reader.header.settings')}
                aria-label={t('reader.header.settings')}
              >
                <Settings className="w-5 h-5" aria-hidden="true" />
              </button>

              {/* Overflow menu -- hidden from xs (375px), contains TOC + Search for < 375px */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="xs:hidden flex items-center justify-center w-11 h-11 touch-target rounded-lg transition-colors bg-muted hover:bg-muted/80 text-foreground"
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
                  {/* Search -- show in overflow only below xs (375px) */}
                  <DropdownMenuItem onClick={onSearchToggle} className="xs:hidden">
                    <Search className="w-5 h-5" aria-hidden="true" />
                    <span>{t('reader.header.search')}</span>
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
