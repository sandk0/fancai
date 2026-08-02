/**
 * DeleteConfirmModal - Modal for confirming book deletion
 *
 * Displays a confirmation dialog before deleting a book.
 * Shows book title and warns about irreversible action.
 *
 * @param isOpen - Whether the modal is visible
 * @param bookTitle - Title of the book being deleted
 * @param isDeleting - Whether deletion is in progress
 * @param onConfirm - Callback when user confirms deletion
 * @param onCancel - Callback when user cancels
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { X, AlertTriangle, Trash2 } from 'lucide-react';
import { m, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Z_INDEX } from '@/lib/zIndex';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  bookTitle: string;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  bookTitle,
  isDeleting,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(isOpen, modalRef);

  // Handle Escape key press
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) {
        onCancel();
      }
    },
    [isDeleting, onCancel]
  );

  // Add/remove escape key listener and focus management
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // Focus cancel button on open for accessibility
      setTimeout(() => cancelButtonRef.current?.focus(), 100);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <m.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto"
        style={{ zIndex: Z_INDEX.modalOverlay }}
        onClick={onCancel}
        role="presentation"
      />
      {/* Modal Container */}
      <div
        className="fixed inset-0 flex items-center justify-center pointer-events-none"
        style={{ zIndex: Z_INDEX.modal }}
      >
        <m.div
          ref={modalRef}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="relative rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden bg-background pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          aria-describedby="delete-modal-description"
        >
          {/* Header */}
          <div
            className="flex items-center justify-between p-6 border-b border-border"
          >
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-full bg-destructive/10">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <h2
                id="delete-modal-title"
                className="text-xl font-semibold text-foreground"
              >
                {t('library.deleteModal.title')}
              </h2>
            </div>
            <button
              onClick={onCancel}
              className="p-2 rounded-lg transition-colors hover:bg-muted text-muted-foreground/70"
              disabled={isDeleting}
              aria-label={t('library.deleteModal.cancel')}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {/* Content */}
          <div id="delete-modal-description" className="p-6">
            <p className="text-muted-foreground">
              {t('library.deleteModal.confirm_text')}{' '}
              <span className="font-semibold text-foreground">
                "{bookTitle}"
              </span>
              ?
            </p>
            <p className="mt-3 text-sm text-muted-foreground/70">
              {t('library.deleteModal.warning')}
            </p>
          </div>

          {/* Actions */}
          <div
            className="flex justify-end gap-3 p-6 border-t border-border"
          >
            <button
              ref={cancelButtonRef}
              onClick={onCancel}
              disabled={isDeleting}
              data-testid="cancel-delete"
              className="px-4 py-2 rounded-lg font-medium transition-colors hover:bg-muted disabled:opacity-50 text-muted-foreground"
            >
              {t('library.deleteModal.cancel')}
            </button>
            <button
              onClick={onConfirm}
              disabled={isDeleting}
              data-testid="confirm-delete"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDeleting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t('library.deleteModal.deleting')}
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  {t('library.deleteModal.delete')}
                </>
              )}
            </button>
          </div>
        </m.div>
      </div>
    </AnimatePresence>
  );
};
