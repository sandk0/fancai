import { CheckCircle2, Circle, Loader2, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BookInfoProps } from './types';

export function BookInfo({ book, processingState }: BookInfoProps) {
  const { t } = useTranslation();

  return (
    <div className="mt-3 px-1">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3
            className="font-semibold text-sm leading-tight line-clamp-2 text-foreground mb-1"
            data-testid="book-title"
          >
            {book.title}
          </h3>
          <p className="text-xs text-muted-foreground line-clamp-1" data-testid="book-author">
            {book.author}
          </p>
        </div>

        <div className="flex-shrink-0 mt-0.5">
          {processingState === 'processed' && (
            <span title={t('bookCard.status.processed')}>
              <CheckCircle2 className="w-4 h-4 text-[var(--color-success)]" />
            </span>
          )}
          {processingState === 'not_processed' && (
            <span title={t('bookCard.status.not_processed')}>
              <Circle className="w-4 h-4 text-muted-foreground" />
            </span>
          )}
          {processingState === 'processing' && (
            <span title={t('bookCard.status.processing')}>
              <Loader2 className="w-4 h-4 text-primary animate-spin" />
            </span>
          )}
          {processingState === 'error' && (
            <span title={t('bookCard.status.error')}>
              <AlertCircle className="w-4 h-4 text-destructive" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
