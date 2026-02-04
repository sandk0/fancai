import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { m } from 'motion/react';
import { X, Book as BookIcon, User, Calendar, Globe, Copyright } from 'lucide-react';
import { Z_INDEX } from '@/lib/zIndex';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import type { BookDetail, BookMetadata as ApiBookMetadata } from '@/types/api';

type MetadataUnion = BookDetail | ApiBookMetadata;

interface BookInfoProps {
  metadata: MetadataUnion;
  isOpen: boolean;
  onClose: () => void;
}

export const BookInfo: React.FC<BookInfoProps> = React.memo(function BookInfo({
  metadata,
  isOpen,
  onClose,
}) {
  const { t, i18n } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(isOpen, modalRef);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const author = metadata.author || '';
  const pubdate = 'pubdate' in metadata ? metadata.pubdate : ('publish_date' in metadata ? metadata.publish_date : undefined);

  const formatDate = (dateString?: string) => {
    if (!dateString) return null;
    try {
      return new Date(dateString).toLocaleDateString(i18n.language, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch { return dateString; }
  };

  const formattedDate = formatDate(pubdate);

  return (
    <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 flex items-center justify-center px-4 pointer-events-none" style={{ zIndex: Z_INDEX.modal }} onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto" style={{ zIndex: Z_INDEX.modalOverlay }} />
      <m.div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="book-info-title" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative max-w-2xl w-full max-h-[85vh] overflow-y-auto rounded-lg bg-popover shadow-2xl pointer-events-auto" style={{ zIndex: Z_INDEX.modal }} onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-popover border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <h2 id="book-info-title" className="text-xl font-bold text-popover-foreground flex items-center gap-2"><BookIcon className="h-5 w-5" aria-hidden="true" />{t('reader.info.title')}</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground" aria-label={t('reader.info.close')}><X className="h-5 w-5" /></button>
        </div>
        <div className="px-6 py-6 space-y-6">
          <div className="space-y-3">
            <h3 className="text-2xl font-bold text-popover-foreground mb-1">{metadata.title}</h3>
            <div className="flex items-center gap-2 text-muted-foreground"><User className="h-4 w-4" /><span className="text-lg">{author}</span></div>
          </div>
          {metadata.description && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold uppercase text-muted-foreground">{t('reader.info.description')}</h4>
              <p className="text-popover-foreground text-base leading-relaxed">{metadata.description}</p>
            </div>
          )}
          <div className="space-y-3">
            {metadata.publisher && (
              <div className="flex items-start gap-3">
                <BookIcon className="h-5 w-5 mt-0.5 text-muted-foreground" />
                <div className="flex-1"><div className="text-xs font-semibold uppercase text-muted-foreground mb-1">{t('reader.info.publisher')}</div><div className="text-popover-foreground">{metadata.publisher}</div></div>
              </div>
            )}
            {formattedDate && (
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 mt-0.5 text-muted-foreground" />
                <div className="flex-1"><div className="text-xs font-semibold uppercase text-muted-foreground mb-1">{t('reader.info.pubdate')}</div><div className="text-popover-foreground">{formattedDate}</div></div>
              </div>
            )}
            {metadata.language && (
              <div className="flex items-start gap-3">
                <Globe className="h-5 w-5 mt-0.5 text-muted-foreground" />
                <div className="flex-1"><div className="text-xs font-semibold uppercase text-muted-foreground mb-1">{t('reader.info.language')}</div><div className="text-popover-foreground">{metadata.language.toUpperCase()}</div></div>
              </div>
            )}
            {'rights' in metadata && metadata.rights && (
              <div className="flex items-start gap-3">
                <Copyright className="h-5 w-5 mt-0.5 text-muted-foreground" />
                <div className="flex-1"><div className="text-xs font-semibold uppercase text-muted-foreground mb-1">{t('reader.info.rights')}</div><div className="text-popover-foreground text-sm">{metadata.rights}</div></div>
              </div>
            )}
          </div>
        </div>
        <div className="sticky bottom-0 bg-popover border-t border-border px-6 py-4">
          <button onClick={onClose} className="w-full px-4 py-2 rounded-lg hover:bg-muted text-popover-foreground font-medium transition-colors">{t('reader.info.close')}</button>
        </div>
      </m.div>
    </m.div>
  );
});
