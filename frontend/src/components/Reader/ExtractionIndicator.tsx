/**
 * ExtractionIndicator - Prominent UI indicator for LLM description extraction
 *
 * Shows a visible indicator when AI is analyzing the chapter.
 * Includes animated spinner, explanatory text, and cancel button.
 * Uses semantic CSS tokens for automatic theme support.
 *
 * FIXED (2025-12-25): Created as part of position restoration optimization
 * to provide clear feedback during 5-15 second LLM extraction.
 *
 * @component
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { X, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExtractionIndicatorProps {
  isExtracting: boolean;
  onCancel?: () => void;
}

export const ExtractionIndicator: React.FC<ExtractionIndicatorProps> = ({
  isExtracting,
  onCancel,
}) => {
  const { t } = useTranslation();

  if (!isExtracting) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        'fixed inset-x-4 z-[800]',
        'top-20 mt-safe',
        'w-[calc(100%-2rem)]',
        'px-5 py-4 rounded-xl shadow-xl backdrop-blur-md',
        'flex items-center gap-4',
        'border border-border',
        'bg-popover/95',
        'animate-in fade-in slide-in-from-top-4 duration-300'
      )}
    >
      <div className="relative flex-shrink-0">
        <div className="w-10 h-10 rounded-full border-[3px] border-primary/30" />
        <div className="absolute inset-0 w-10 h-10 rounded-full border-[3px] border-t-transparent border-primary animate-spin" />
        <Sparkles className="absolute inset-0 m-auto w-4 h-4 text-muted-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm sm:text-base text-popover-foreground">
          {t('reader.extraction.analyzing')}
        </p>
        <p className="text-xs sm:text-sm text-muted-foreground">
          {t('reader.extraction.usually_takes')}
        </p>
      </div>

      {onCancel && (
        <button
          onClick={onCancel}
          className="flex-shrink-0 p-2 rounded-lg transition-colors bg-muted hover:bg-muted/80 text-muted-foreground"
          title={t('reader.extraction.cancel')}
          aria-label={t('reader.extraction.cancel_analysis')}
        >
          <X className="w-5 h-5" />
        </button>
      )}
    </div>
  );
};
