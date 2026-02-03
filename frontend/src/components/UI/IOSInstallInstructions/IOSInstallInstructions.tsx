import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Share, Plus, X } from 'lucide-react';
import { m, AnimatePresence, LazyMotion, domAnimation } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Z_INDEX } from '@/lib/zIndex';
import { Button } from '@/components/UI/button';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import {
  shouldShowIOSInstallPrompt,
  dismissIOSInstallPrompt,
  getIOSInstallInstructions,
} from '@/utils/iosSupport';
import { InstallStep } from './InstallStep';
import {
  modalBackdropVariants,
  modalContentVariants,
  inlineVariants,
} from './animations';

export interface IOSInstallInstructionsProps {
  mode?: 'modal' | 'inline';
  onDismiss?: () => void;
  showOnlyOnIOS?: boolean;
  className?: string;
  forceShow?: boolean;
}

export function IOSInstallInstructions({
  mode = 'modal',
  onDismiss,
  showOnlyOnIOS = true,
  className,
  forceShow = false,
}: IOSInstallInstructionsProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusTrap(mode === 'modal' && isVisible, modalRef);

  useEffect(() => {
    if (forceShow) {
      setShouldRender(true);
      setIsVisible(true);
      return;
    }

    if (showOnlyOnIOS) {
      const shouldShow = shouldShowIOSInstallPrompt();
      setShouldRender(shouldShow);
      setIsVisible(shouldShow);
    } else {
      setShouldRender(true);
      setIsVisible(true);
    }
  }, [forceShow, showOnlyOnIOS]);

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    dismissIOSInstallPrompt();

    setTimeout(() => {
      onDismiss?.();
      setShouldRender(false);
    }, 300);
  }, [onDismiss]);

  useEffect(() => {
    if (mode !== 'modal' || !isVisible) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleDismiss();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [mode, isVisible, handleDismiss]);

  useEffect(() => {
    if (mode !== 'modal' || !isVisible) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [mode, isVisible]);

  const steps = getIOSInstallInstructions();

  const getStepIcon = (index: number): React.ReactNode => {
    switch (index) {
      case 0:
        return <Share className="h-5 w-5" aria-hidden="true" />;
      case 2:
        return <Plus className="h-5 w-5" aria-hidden="true" />;
      default:
        return null;
    }
  };

  if (!shouldRender) {
    return null;
  }

  const content = (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3
          className={cn(
            'text-lg font-semibold text-[var(--color-text-default)]',
            mode === 'inline' && 'text-base'
          )}
        >
          Install the App
        </h3>
        <p className="text-sm text-[var(--color-text-muted)]">
          Add this app to your home screen for the best experience
        </p>
      </div>

      <div className="space-y-1">
        {steps.map((step, index) => (
          <InstallStep
            key={index}
            stepNumber={index + 1}
            text={step}
            icon={getStepIcon(index)}
          />
        ))}
      </div>

      {mode === 'modal' && (
        <div
          className={cn(
            'rounded-lg p-3',
            'bg-[var(--color-bg-subtle)]',
            'border border-[var(--color-border-default)]'
          )}
        >
          <p className="text-xs text-[var(--color-text-muted)]">
            Installing the app provides offline access, faster loading, and a full-screen
            experience.
          </p>
        </div>
      )}

      <div
        className={cn(
          'flex gap-2',
          mode === 'modal' ? 'flex-col sm:flex-row sm:justify-end' : 'flex-row justify-end'
        )}
      >
        <Button
          variant="secondary"
          size={mode === 'modal' ? 'md' : 'sm'}
          onClick={handleDismiss}
        >
          {mode === 'modal' ? 'Maybe Later' : 'Dismiss'}
        </Button>
      </div>
    </div>
  );

  if (mode === 'inline') {
    return (
      <LazyMotion features={domAnimation}>
        <AnimatePresence mode="wait">
          {isVisible && (
            <m.div
              className={cn(
                'overflow-hidden rounded-lg',
                'bg-card border border-[var(--color-border-default)]',
                'p-4',
                className
              )}
              variants={inlineVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {content}
            </m.div>
          )}
        </AnimatePresence>
      </LazyMotion>
    );
  }

  return (
    <LazyMotion features={domAnimation}>
      <AnimatePresence mode="wait">
        {isVisible && (
          <>
            <m.div
              className="fixed inset-0 bg-black/50 backdrop-blur-sm"
              style={{ zIndex: Z_INDEX.iosInstall - 1 }}
              variants={modalBackdropVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ duration: 0.2 }}
              onClick={handleDismiss}
              onTouchEnd={handleDismiss}
              aria-hidden="true"
            />

            <div
              className={cn(
                'fixed inset-0 flex items-end justify-center p-4',
                'sm:items-center'
              )}
              style={{ zIndex: Z_INDEX.iosInstall }}
              onClick={handleDismiss}
              onTouchEnd={handleDismiss}
            >
              <m.div
                ref={modalRef}
                className={cn(
                  'relative w-full max-w-md',
                  'bg-popover text-popover-foreground',
                  'rounded-xl shadow-xl',
                  'p-6',
                  'rounded-b-xl sm:rounded-xl',
                  className
                )}
                variants={modalContentVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                onClick={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="ios-install-title"
              >
                <button
                  type="button"
                  onClick={handleDismiss}
                  className={cn(
                    'absolute right-4 top-4',
                    'flex h-8 w-8 items-center justify-center rounded-md',
                    'text-[var(--color-text-muted)] hover:text-[var(--color-text-default)]',
                    'hover:bg-[var(--color-bg-muted)] transition-colors',
                    'focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-500)]'
                  )}
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>

                {content}
              </m.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}

export default IOSInstallInstructions;
