import { m } from 'motion/react';
import { Book, CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { AuthenticatedImage } from '@/components/UI/AuthenticatedImage';
import type { BookCoverProps } from './types';

export function BookCover({
  book,
  imageLoaded,
  onImageLoad,
  coverUrl,
  progressPercent,
  isAvailableOffline,
  isDownloading,
  downloadProgress,
}: BookCoverProps) {
  const { t } = useTranslation();

  return (
    <>
      {!imageLoaded && coverUrl && (
        <div className="absolute inset-0 bg-muted animate-pulse" />
      )}

      <AuthenticatedImage
        src={coverUrl}
        alt={`${book.title} cover`}
        className={cn(
          "w-full h-full object-cover transition-opacity duration-300",
          imageLoaded ? "opacity-100" : "opacity-0"
        )}
        onLoad={onImageLoad}
        loading="lazy"
        fallback={
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
            <Book className="w-12 h-12 text-muted-foreground/50" />
          </div>
        }
      />

      {progressPercent > 0 && !book.is_processing && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
          <div className="flex items-center justify-between text-white text-xs mb-1">
            <span className="font-medium">{Math.round(progressPercent)}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/30 overflow-hidden">
            <m.div
              className="h-full rounded-full bg-primary"
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(progressPercent, 100)}%` }}
              transition={{ duration: 0.5, delay: 0.2 }}
            />
          </div>
        </div>
      )}

      {book.is_parsed && !book.is_processing && (
        <div className="absolute top-2 left-2 pointer-events-none">
          {isDownloading ? (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary/90 text-primary-foreground text-xs font-medium backdrop-blur-sm shadow-xs">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{downloadProgress}%</span>
            </div>
          ) : isAvailableOffline ? (
            <div
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-green-500/90 text-white text-xs font-medium backdrop-blur-sm shadow-xs"
              title={t('bookCard.available_offline')}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
