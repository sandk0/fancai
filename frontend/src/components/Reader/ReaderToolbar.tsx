/**
 * ReaderToolbar - Minimalist floating toolbar for immersive reading
 *
 * Features:
 * - Auto-hide on scroll (immersive mode)
 * - Semi-transparent with backdrop-blur
 * - Sticky top with safe area support
 * - Touch-friendly buttons (min 44px)
 * - Smooth slide up/down animation
 *
 * @component
 */

import React, { useCallback } from 'react';
import { m, AnimatePresence } from 'motion/react';
import { ArrowLeft, List, Settings, Sun, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type AppTheme } from '@/hooks/useTheme';

interface ReaderToolbarProps {
  /** Whether toolbar is visible (for immersive mode) */
  isVisible: boolean;
  /** Book title to display (will be truncated) */
  bookTitle: string;
  /** Callback for back button */
  onBack: () => void;
  /** Callback for TOC toggle */
  onToggleToc: () => void;
  /** Callback for settings toggle */
  onToggleSettings: () => void;
  /** Optional additional className */
  className?: string;
}

/**
 * Touch-friendly icon button component
 */
const ToolbarButton: React.FC<{
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
  className?: string;
}> = ({ onClick, ariaLabel, children, className }) => (
  <button
    onClick={onClick}
    aria-label={ariaLabel}
    className={cn(
      // Touch-friendly size (44px minimum)
      'h-11 w-11 min-h-[44px] min-w-[44px]',
      // Centering and shape
      'flex items-center justify-center rounded-full',
      // Colors and transitions
      'text-foreground/80 hover:text-foreground',
      'hover:bg-foreground/10 active:bg-foreground/15',
      'transition-colors duration-200',
      // Focus states
      'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className
    )}
  >
    {children}
  </button>
);

export const ReaderToolbar: React.FC<ReaderToolbarProps> = React.memo(function ReaderToolbar({
  isVisible,
  bookTitle,
  onBack,
  onToggleToc,
  onToggleSettings,
  className,
}) {
  const { resolvedTheme, setTheme } = useTheme();

  const handleThemeToggle = useCallback(() => {
    // Cycle through themes: light -> dark -> sepia -> light
    const themeOrder: AppTheme[] = ['light', 'dark', 'sepia'];
    const currentIndex = themeOrder.indexOf(resolvedTheme);
    const nextIndex = (currentIndex + 1) % themeOrder.length;
    setTheme(themeOrder[nextIndex]);
  }, [resolvedTheme, setTheme]);

  const ThemeIcon = resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <AnimatePresence>
      {isVisible && (
        <m.header
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          transition={{
            type: 'spring' as const,
            stiffness: 300,
            damping: 30,
          }}
          className={cn(
            // Positioning
            'fixed top-0 left-0 right-0 z-[200]',
            // Safe area padding
            'pt-safe',
            // Background with blur
            'bg-background/80 backdrop-blur-md',
            // Border
            'border-b border-border/50',
            // Shadow for depth
            'shadow-xs',
            className
          )}
        >
          <div className="flex items-center justify-between px-2 sm:px-4 py-2">
            {/* Left section: Back button + Title */}
            <div className="flex items-center gap-1 sm:gap-2 min-w-0 flex-1">
              <ToolbarButton onClick={onBack} ariaLabel="Back to library">
                <ArrowLeft className="h-5 w-5" />
              </ToolbarButton>

              <h1
                className={cn(
                  'text-sm sm:text-base font-medium',
                  'text-foreground/90',
                  'truncate max-w-[150px] sm:max-w-[250px] md:max-w-[350px]'
                )}
                title={bookTitle}
              >
                {bookTitle}
              </h1>
            </div>

            {/* Right section: Controls */}
            <div className="flex items-center gap-0.5 sm:gap-1">
              <ToolbarButton onClick={onToggleToc} ariaLabel="Table of contents">
                <List className="h-5 w-5" />
              </ToolbarButton>

              <ToolbarButton onClick={onToggleSettings} ariaLabel="Reader settings">
                <Settings className="h-5 w-5" />
              </ToolbarButton>

              <ToolbarButton
                onClick={handleThemeToggle}
                ariaLabel={`Switch theme (current: ${resolvedTheme})`}
              >
                <ThemeIcon className="h-5 w-5" />
              </ToolbarButton>
            </div>
          </div>
        </m.header>
      )}
    </AnimatePresence>
  );
});

export default ReaderToolbar;
