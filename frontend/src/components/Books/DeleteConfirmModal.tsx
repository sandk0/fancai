import React, { useRef } from 'react';
import { X, AlertTriangle, Trash2 } from 'lucide-react';
import { m, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import LoadingSpinner from '@/components/UI/LoadingSpinner';
import { Button } from '@/components/UI/button';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface DeleteConfirmModalProps {
  book: { id: string; title: string; author?: string };
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  book,
  isOpen,
  onClose,
  onConfirm,
  isDeleting,
}) => {
  const { t } = useTranslation();
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus trap for accessibility
  useFocusTrap(isOpen, modalRef);

  // Close on escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose, isDeleting]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <m.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[500] flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={isDeleting ? undefined : onClose}
      >
        <m.div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          aria-describedby="delete-modal-description"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="relative bg-card rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" aria-hidden="true" />
              </div>
              <h2 id="delete-modal-title" className="text-xl font-semibold text-card-foreground">
                {t('deleteModal.title')}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-muted-foreground hover:text-card-foreground rounded-lg transition-colors"
              disabled={isDeleting}
              aria-label={t('common.close')}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {/* Content */}
          <div id="delete-modal-description" className="p-6">
            <div className="mb-4">
              <p className="text-card-foreground/80 mb-2">
                {t('deleteModal.confirmText')}
              </p>
              <div className="p-3 bg-muted rounded-lg">
                <p className="font-semibold text-card-foreground truncate">
                  {book.title}
                </p>
                {book.author && (
                  <p className="text-sm text-muted-foreground truncate">
                    {book.author}
                  </p>
                )}
              </div>
            </div>

            {/* Warning */}
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              <div className="flex items-start space-x-3">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div className="text-sm">
                  <p className="text-red-800 dark:text-red-200 font-medium mb-1">
                    {t('deleteModal.warningTitle')}
                  </p>
                  <ul className="text-red-700 dark:text-red-300 space-y-1">
                    <li>{t('deleteModal.warningChapters')}</li>
                    <li>{t('deleteModal.warningImages')}</li>
                    <li>{t('deleteModal.warningProgress')}</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 p-6 border-t border-border bg-muted/50">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isDeleting}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  {t('deleteModal.deleting')}
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
                  {t('common.delete')}
                </>
              )}
            </Button>
          </div>
        </m.div>
      </m.div>
    </AnimatePresence>
  );
};

export default DeleteConfirmModal;
