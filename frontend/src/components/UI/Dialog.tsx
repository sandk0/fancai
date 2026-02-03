/**
 * Dialog Component - Simple confirmation dialogs
 *
 * Built on top of Modal component for confirmation/alert dialogs.
 * Provides pre-built variants for common use cases:
 * - Confirm: Yes/No decisions
 * - Alert: Single button acknowledgment
 * - Destructive: Dangerous actions with red styling
 *
 * @component
 */

import { useCallback, type ReactNode } from 'react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from './Modal';
import { Button } from './button';
import { cn } from '@/lib/utils';

// --- Types ---

export type DialogVariant = 'default' | 'destructive' | 'alert';

interface DialogProps {
  /** Whether the dialog is visible */
  isOpen: boolean;
  /** Callback when dialog should close */
  onClose: () => void;
  /** Dialog title */
  title: string;
  /** Dialog description/message */
  description?: string;
  /** Custom content (replaces description) */
  children?: ReactNode;
  /** Dialog variant for styling */
  variant?: DialogVariant;
  /** Confirm button text */
  confirmText?: string;
  /** Cancel button text */
  cancelText?: string;
  /** Callback when confirm is clicked */
  onConfirm?: () => void | Promise<void>;
  /** Callback when cancel is clicked */
  onCancel?: () => void;
  /** Whether confirm button is in loading state */
  isLoading?: boolean;
  /** Whether confirm button is disabled */
  isConfirmDisabled?: boolean;
  /** Hide cancel button (for alert variant) */
  hideCancelButton?: boolean;
  /** Additional class names */
  className?: string;
  /** Close on backdrop click (default: true for default/alert, false for destructive) */
  closeOnBackdropClick?: boolean;
}

interface ConfirmDialogProps extends Omit<DialogProps, 'variant' | 'hideCancelButton'> {
  /** Whether this is a destructive action */
  destructive?: boolean;
}

interface AlertDialogProps extends Omit<DialogProps, 'variant' | 'onCancel' | 'cancelText' | 'hideCancelButton'> {
  /** Button text (default: "OK") */
  buttonText?: string;
}

// --- Icon Components ---

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function QuestionIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// --- Dialog Component ---

export function Dialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  variant = 'default',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  isLoading = false,
  isConfirmDisabled = false,
  hideCancelButton = false,
  className,
  closeOnBackdropClick,
}: DialogProps) {
  const handleCancel = useCallback(() => {
    onCancel?.();
    onClose();
  }, [onCancel, onClose]);

  const handleConfirm = useCallback(async () => {
    if (onConfirm) {
      await onConfirm();
    }
    onClose();
  }, [onConfirm, onClose]);

  // Determine backdrop click behavior
  const shouldCloseOnBackdropClick =
    closeOnBackdropClick ?? (variant !== 'destructive');

  // Get icon based on variant
  const Icon =
    variant === 'destructive'
      ? WarningIcon
      : variant === 'alert'
        ? InfoIcon
        : QuestionIcon;

  const iconColorClass =
    variant === 'destructive'
      ? 'text-destructive'
      : variant === 'alert'
        ? 'text-primary'
        : 'text-muted-foreground';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant="default"
      closeOnBackdropClick={shouldCloseOnBackdropClick}
      closeOnEscape={shouldCloseOnBackdropClick}
      titleId="dialog-title"
      descriptionId="dialog-description"
      className={className}
    >
      <ModalHeader showCloseButton={false}>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full',
              variant === 'destructive' && 'bg-destructive/10',
              variant === 'alert' && 'bg-primary/10',
              variant === 'default' && 'bg-muted'
            )}
          >
            <Icon className={iconColorClass} />
          </div>
          <span id="dialog-title">{title}</span>
        </div>
      </ModalHeader>

      <ModalBody>
        {children || (
          <p id="dialog-description" className="text-muted-foreground">
            {description}
          </p>
        )}
      </ModalBody>

      <ModalFooter>
        {!hideCancelButton && (
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isLoading}
          >
            {cancelText}
          </Button>
        )}
        <Button
          variant={variant === 'destructive' ? 'destructive' : 'primary' as const}
          onClick={handleConfirm}
          disabled={isConfirmDisabled || isLoading}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <svg
                className="h-4 w-4 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Loading...
            </span>
          ) : (
            confirmText
          )}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// --- Confirm Dialog ---

/**
 * Pre-configured confirmation dialog for yes/no decisions
 */
export function ConfirmDialog({
  destructive = false,
  confirmText = destructive ? 'Delete' : 'Confirm',
  cancelText = 'Cancel',
  ...props
}: ConfirmDialogProps) {
  return (
    <Dialog
      variant={destructive ? 'destructive' : 'default'}
      confirmText={confirmText}
      cancelText={cancelText}
      {...props}
    />
  );
}

// --- Alert Dialog ---

/**
 * Pre-configured alert dialog for single button acknowledgment
 */
export function AlertDialog({
  buttonText = 'OK',
  confirmText,
  ...props
}: AlertDialogProps) {
  return (
    <Dialog
      variant="alert"
      confirmText={confirmText || buttonText}
      hideCancelButton
      {...props}
    />
  );
}

// --- Exports ---

export type { DialogProps, ConfirmDialogProps, AlertDialogProps };
