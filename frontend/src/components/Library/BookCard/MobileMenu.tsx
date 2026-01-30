import { m, AnimatePresence } from 'framer-motion';
import {
  MoreVertical,
  BookOpen,
  Trash2,
  X,
  Download,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { MobileMenuProps } from './types';

export function MobileMenu({
  isOpen,
  isClickable,
  isAvailableOffline,
  isDownloading,
  downloadProgress,
  showDelete,
  onToggle,
  onClose,
  onReadClick,
  onDeleteClick,
  onOfflineClick,
}: MobileMenuProps) {
  const { t } = useTranslation();

  return (
    <>
      <button
        className="absolute top-2 right-2 p-2 rounded-lg bg-black/50 text-white md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center backdrop-blur-sm"
        onClick={onToggle}
        aria-label={t('bookCard.menu')}
      >
        <MoreVertical className="w-5 h-5" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <m.div
              className="fixed inset-0 z-40 md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
            <m.div
              className="absolute top-12 right-2 z-[100] bg-card border border-border rounded-xl shadow-xl overflow-hidden w-52 sm:w-56 md:hidden"
              initial={{ opacity: 0, scale: 0.9, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -10 }}
              transition={{ duration: 0.15 }}
            >
              {isClickable && (
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-foreground hover:bg-muted transition-colors min-h-[44px] whitespace-nowrap"
                  onClick={onReadClick}
                >
                  <BookOpen className="w-5 h-5 flex-shrink-0 text-primary" />
                  <span className="font-medium">{t('bookCard.read')}</span>
                </button>
              )}
              {isClickable && (
                <button
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 transition-colors min-h-[44px] whitespace-nowrap',
                    isAvailableOffline
                      ? 'text-green-600 hover:bg-green-500/10'
                      : 'text-foreground hover:bg-muted'
                  )}
                  onClick={onOfflineClick}
                  disabled={isDownloading}
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="w-5 h-5 flex-shrink-0 animate-spin" />
                      <span className="font-medium">{t('bookCard.downloading', { progress: downloadProgress })}</span>
                    </>
                  ) : isAvailableOffline ? (
                    <>
                      <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                      <span className="font-medium">{t('bookCard.remove_offline')}</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-5 h-5 flex-shrink-0" />
                      <span className="font-medium">{t('bookCard.download_offline')}</span>
                    </>
                  )}
                </button>
              )}
              {showDelete && (
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-destructive hover:bg-destructive/10 transition-colors min-h-[44px] whitespace-nowrap"
                  onClick={onDeleteClick}
                >
                  <Trash2 className="w-5 h-5 flex-shrink-0" />
                  <span className="font-medium">{t('bookCard.delete')}</span>
                </button>
              )}
              <button
                className="w-full flex items-center gap-3 px-4 py-3 text-muted-foreground hover:bg-muted transition-colors min-h-[44px] border-t border-border whitespace-nowrap"
                onClick={onClose}
              >
                <X className="w-5 h-5 flex-shrink-0" />
                <span>{t('bookCard.close')}</span>
              </button>
            </m.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
