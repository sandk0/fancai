/**
 * ExtractionIndicator - Prominent UI indicator for LLM description extraction
 *
 * Shows a visible indicator when AI is analyzing the chapter.
 * Includes animated spinner, explanatory text, and cancel button.
 * When extraction fails, shows error state with retry button (up to maxRetries).
 * Uses semantic CSS tokens for automatic theme support.
 *
 * FIXED (2025-12-25): Created as part of position restoration optimization
 * to provide clear feedback during 5-15 second LLM extraction.
 * UPDATED (2026-03-05): Added error state, retry button, retry limit (UX-05).
 *
 * @component
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { X, Sparkles, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExtractionIndicatorProps {
  isExtracting: boolean;
  extractionError?: string | null;
  retryCount?: number;
  maxRetries?: number;
  onRetry?: () => void;
  onCancel?: () => void;
}

export const ExtractionIndicator: React.FC<ExtractionIndicatorProps> = ({
  isExtracting,
  extractionError = null,
  retryCount,
  maxRetries = 3,
  onRetry,
  onCancel,
}) => {
  const { t } = useTranslation();

  // Show if extracting OR if there's an error to display
  if (!isExtracting && !extractionError) return null;

  const canRetry = onRetry && retryCount !== undefined && retryCount < maxRetries;
  const retriesExhausted = retryCount !== undefined && retryCount >= maxRetries;

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
      {extractionError ? (
        <>
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-destructive" />
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm sm:text-base text-popover-foreground">
              {extractionError}
            </p>
            {canRetry && (
              <p className="text-xs sm:text-sm text-muted-foreground">
                {t('reader.extraction.retry_hint')}
              </p>
            )}
            {retriesExhausted && (
              <p className="text-xs sm:text-sm text-muted-foreground">
                {t('reader.extraction.retries_exhausted')}
              </p>
            )}
          </div>

          {canRetry && (
            <button
              onClick={onRetry}
              className="flex-shrink-0 p-2 rounded-lg transition-colors bg-primary/10 hover:bg-primary/20 text-primary"
              title={t('errors.retry')}
              aria-label={t('errors.retry')}
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          )}
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
};
