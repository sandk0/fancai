/**
 * Modal Component - Accessible modal dialog with variants
 *
 * Features:
 * - React Portal for proper z-index stacking
 * - Focus trap for keyboard accessibility
 * - Close on Escape key and backdrop click
 * - Smooth animations with framer-motion
 * - Mobile fullscreen variant
 * - Drawer variant for mobile bottom sheets
 *
 * @component
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  useState,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { m, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { Z_INDEX } from '@/lib/zIndex';

// --- Types ---

export type ModalVariant = 'default' | 'fullscreen' | 'drawer';

interface ModalContextValue {
  onClose: () => void;
  variant: ModalVariant;
}

interface ModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Modal variant: default, fullscreen, or drawer */
  variant?: ModalVariant;
  /** Children to render inside modal */
  children: ReactNode;
  /** Additional class names for the modal container */
  className?: string;
  /** Whether clicking the backdrop closes the modal (default: true) */
  closeOnBackdropClick?: boolean;
  /** Whether pressing Escape closes the modal (default: true) */
  closeOnEscape?: boolean;
  /** ID for the modal title (for aria-labelledby) */
  titleId?: string;
  /** ID for the modal description (for aria-describedby) */
  descriptionId?: string;
}

interface ModalHeaderProps {
  children: ReactNode;
  className?: string;
  /** Show close button (default: true) */
  showCloseButton?: boolean;
}

interface ModalBodyProps {
  children: ReactNode;
  className?: string;
}

interface ModalFooterProps {
  children: ReactNode;
  className?: string;
}

// --- Context ---

const ModalContext = createContext<ModalContextValue | null>(null);

function useModalContext(): ModalContextValue {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('Modal compound components must be used within Modal');
  }
  return context;
}

// --- Focus Trap Hook ---

function useFocusTrap(isOpen: boolean, containerRef: React.RefObject<HTMLDivElement | null>) {
  const previousActiveElement = useRef<Element | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Store currently focused element
    previousActiveElement.current = document.activeElement;

    const container = containerRef.current;
    if (!container) return;

    // Focus the first focusable element
    const focusableElements = getFocusableElements(container);
    if (focusableElements.length > 0) {
      (focusableElements[0] as HTMLElement).focus();
    } else {
      // Focus the container itself if no focusable elements
      container.focus();
    }

    return () => {
      // Restore focus when modal closes
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen, containerRef]);

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key !== 'Tab') return;

      const container = containerRef.current;
      if (!container) return;

      const focusableElements = getFocusableElements(container);
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

      // Trap focus within modal
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    },
    [containerRef]
  );

  return { handleKeyDown };
}

function getFocusableElements(container: HTMLElement): NodeListOf<Element> {
  return container.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
  );
}

// --- Animation Variants ---

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const modalVariants = {
  default: {
    hidden: { opacity: 0, scale: 0.95, y: 10 },
    visible: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.95, y: 10 },
  },
  fullscreen: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 },
  },
  drawer: {
    hidden: { opacity: 0, y: '100%' },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: '100%' },
  },
};

// --- Lock Body Scroll Hook ---

function useLockBodyScroll(isOpen: boolean) {
  useEffect(() => {
    if (!isOpen) return;

    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalStyle;
    };
  }, [isOpen]);
}

// --- Modal Component ---

export function Modal({
  isOpen,
  onClose,
  variant = 'default',
  children,
  className,
  closeOnBackdropClick = true,
  closeOnEscape = true,
  titleId,
  descriptionId,
}: ModalProps) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Set up portal container
  useEffect(() => {
    setPortalContainer(document.body);
  }, []);

  // Lock body scroll when modal is open
  useLockBodyScroll(isOpen);

  // Focus trap
  const { handleKeyDown: handleFocusTrapKeyDown } = useFocusTrap(isOpen, modalRef);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, closeOnEscape, onClose]);

  // Handle backdrop click
  const handleBackdropClick = useCallback(
    (event: React.MouseEvent) => {
      if (closeOnBackdropClick && event.target === event.currentTarget) {
        onClose();
      }
    },
    [closeOnBackdropClick, onClose]
  );

  if (!portalContainer) return null;

  const modalContent = (
    <AnimatePresence mode="wait">
      {isOpen && (
        <ModalContext.Provider value={{ onClose, variant }}>
          {/* Backdrop */}
          <m.div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto"
            style={{ zIndex: Z_INDEX.modalOverlay }}
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.2 }}
            onClick={handleBackdropClick}
            aria-hidden="true"
          />

          {/* Modal Container */}
          <div
            className={cn(
              'fixed inset-0 flex overflow-y-auto pointer-events-none',
              variant === 'drawer' ? 'items-end' : 'items-center justify-center',
              variant === 'fullscreen' && 'p-0',
              variant === 'default' && 'p-4'
            )}
            style={{ zIndex: Z_INDEX.modal }}
          >
            {/* Modal Content */}
            <m.div
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              tabIndex={-1}
              className={cn(
                'relative flex flex-col bg-popover text-popover-foreground shadow-xl outline-hidden pointer-events-auto',
                // Default variant: full width on mobile, constrained on desktop
                variant === 'default' && [
                  'w-full rounded-lg',
                  'max-h-[90vh]',
                  'md:max-w-lg',
                ],
                // Fullscreen variant: full screen on mobile, large modal on desktop
                variant === 'fullscreen' && [
                  'w-full h-full',
                  'md:w-full md:h-full md:max-w-none md:rounded-none',
                  'rounded-none',
                ],
                // Drawer variant: bottom sheet on mobile
                variant === 'drawer' && [
                  'w-full rounded-t-xl',
                  'max-h-[85vh]',
                  'md:max-w-lg md:rounded-lg md:mb-0',
                ],
                className
              )}
              variants={modalVariants[variant]}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{
                type: 'spring' as const,
                damping: 25,
                stiffness: 300,
                duration: 0.2,
              }}
              onKeyDown={handleFocusTrapKeyDown}
            >
              {children}
            </m.div>
          </div>
        </ModalContext.Provider>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, portalContainer);
}

// --- Modal Header ---

export function ModalHeader({
  children,
  className,
  showCloseButton = true,
}: ModalHeaderProps) {
  const { onClose } = useModalContext();

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 px-6 py-4 border-b border-border',
        className
      )}
    >
      <div className="flex-1 font-semibold text-lg">{children}</div>
      {showCloseButton && (
        <button
          type="button"
          onClick={onClose}
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-md',
            'text-muted-foreground hover:text-foreground',
            'hover:bg-accent transition-colors',
            'focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-popover'
          )}
          aria-label="Close modal"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}

// --- Modal Body ---

export function ModalBody({ children, className }: ModalBodyProps) {
  return (
    <div className={cn('flex-1 overflow-y-auto px-6 py-4', className)}>
      {children}
    </div>
  );
}

// --- Modal Footer ---

export function ModalFooter({ children, className }: ModalFooterProps) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 px-6 py-4 border-t border-border',
        'sm:flex-row sm:justify-end sm:gap-3',
        className
      )}
    >
      {children}
    </div>
  );
}

// --- Exports ---

Modal.Header = ModalHeader;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;


