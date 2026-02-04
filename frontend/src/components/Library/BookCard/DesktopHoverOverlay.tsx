import { m } from 'motion/react';
import {
  BookOpen,
  Trash2,
  Download,
  CloudOff,
  Sparkles,
  RefreshCw,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { DesktopHoverOverlayProps } from './types';

export function DesktopHoverOverlay({
  isClickable,
  isProcessing,
  processingState,
  isAvailableOffline,
  isDownloading,
  downloadProgress,
  onReadClick,
  onDeleteClick,
  onOfflineClick,
  onProcessClick,
  showDelete,
}: DesktopHoverOverlayProps) {
  const { t } = useTranslation();

  if (!isClickable || isProcessing) return null;

  return (
    <m.div
      className="absolute inset-0 bg-black/60 hidden md:flex flex-col items-center justify-center gap-2 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <m.button
        className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg min-h-[44px] min-w-[120px] justify-center"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onReadClick}
      >
        <BookOpen className="w-5 h-5" />
        <span>{t('bookCard.read')}</span>
      </m.button>

      {!isProcessing && (
        <m.button
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-xl font-medium shadow-lg min-h-[44px] min-w-[120px] justify-center',
            processingState === 'error'
              ? 'bg-destructive/90 text-white'
              : 'bg-white/20 text-white hover:bg-white/30'
          )}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onProcessClick}
        >
          {processingState === 'not_processed' && (
            <>
              <Sparkles className="w-4 h-4" />
              <span>{t('bookCard.process')}</span>
            </>
          )}
          {processingState === 'processed' && (
            <>
              <RefreshCw className="w-4 h-4" />
              <span>{t('bookCard.reprocess')}</span>
            </>
          )}
          {processingState === 'error' && (
            <>
              <AlertTriangle className="w-4 h-4" />
              <span>{t('bookCard.retry')}</span>
            </>
          )}
        </m.button>
      )}

      <m.button
        className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-xl font-medium shadow-lg min-h-[44px] min-w-[120px] justify-center',
          isAvailableOffline
            ? 'bg-green-600/90 text-white'
            : 'bg-white/20 text-white hover:bg-white/30'
        )}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onOfflineClick}
        disabled={isDownloading}
      >
        {isDownloading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{downloadProgress}%</span>
          </>
        ) : isAvailableOffline ? (
          <>
            <CloudOff className="w-4 h-4" />
            <span>{t('bookCard.delete')}</span>
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            <span>{t('bookCard.offline')}</span>
          </>
        )}
      </m.button>

      {showDelete && (
        <m.button
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-destructive/90 text-white font-medium shadow-lg min-h-[44px] min-w-[100px] justify-center"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onDeleteClick}
        >
          <Trash2 className="w-4 h-4" />
          <span>{t('bookCard.delete')}</span>
        </m.button>
      )}
    </m.div>
  );
}
