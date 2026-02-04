/**
 * PWAUpdatePrompt - Notification component for PWA updates
 *
 * Displays a prompt when a new version of the app is available.
 * Uses VitePWA's useRegisterSW hook for service worker management.
 *
 * Features:
 * - Automatic update detection
 * - Periodic update checks (every hour)
 * - Smooth animation on appear/dismiss
 * - Dark theme support
 * - Mobile-first responsive design
 */

import { useCallback } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useTranslation } from 'react-i18next';
import { m, AnimatePresence } from 'motion/react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/UI/button';
import { Card } from '@/components/UI/Card';
import { logger } from '@/lib/logger';

export interface PWAUpdatePromptProps {
  /** Title text shown in the prompt */
  title?: string;
  /** Description text shown below the title */
  description?: string;
  /** Text for the update button */
  updateButtonText?: string;
  /** Text for the dismiss button */
  dismissButtonText?: string;
}

/**
 * PWAUpdatePrompt component for notifying users about available updates
 *
 * @example
 * ```tsx
 * // Basic usage (in App.tsx)
 * <PWAUpdatePrompt />
 *
 * // With custom text
 * <PWAUpdatePrompt
 *   title="Update Available"
 *   description="A new version is ready to install"
 *   updateButtonText="Install"
 *   dismissButtonText="Later"
 * />
 * ```
 */
export function PWAUpdatePrompt({
  title,
  description,
  updateButtonText,
  dismissButtonText,
}: PWAUpdatePromptProps) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t('ui.pwaUpdate.title');
  const resolvedDescription = description ?? t('ui.pwaUpdate.description');
  const resolvedUpdateText = updateButtonText ?? t('ui.pwaUpdate.update');
  const resolvedDismissText = dismissButtonText ?? t('ui.pwaUpdate.dismiss');
  // useRegisterSW hook from VitePWA
  // Provides needRefresh state and updateServiceWorker function
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // Check for updates immediately on mount
    immediate: true,
    // Check for updates every hour
    onRegisteredSW(swUrl, registration) {
      logger.debug('[PWA] Service Worker registered via useRegisterSW:', swUrl);
      if (registration) {
        setInterval(() => {
          logger.debug('[PWA] Checking for updates...');
          registration.update();
        }, 60 * 60 * 1000); // 1 hour
      }
    },
    onRegisterError(error) {
      logger.error('[PWA] Service Worker registration error:', error);
    },
    onNeedRefresh() {
      logger.debug('[PWA] New content available, showing update prompt');
    },
    onOfflineReady() {
      logger.debug('[PWA] App is ready to work offline');
    },
  });

  // Handle update button click
  const handleUpdate = useCallback(() => {
    logger.debug('[PWA] User initiated update');
    // Force update and reload
    updateServiceWorker(true);
  }, [updateServiceWorker]);

  // Handle dismiss button click
  const handleDismiss = useCallback(() => {
    logger.debug('[PWA] User dismissed update prompt');
    setNeedRefresh(false);
  }, [setNeedRefresh]);

  // Animation variants for slide-up effect
  const variants = {
    hidden: {
      y: 100,
      opacity: 0,
      scale: 0.95,
    },
    visible: {
      y: 0,
      opacity: 1,
      scale: 1,
      transition: {
        type: 'spring' as const,
        damping: 25,
        stiffness: 300,
      },
    },
    exit: {
      y: 100,
      opacity: 0,
      scale: 0.95,
      transition: {
        duration: 0.2,
      },
    },
  };

  return (
    <AnimatePresence>
      {needRefresh && (
        <m.div
          className="fixed left-4 right-4 z-[600] bottom-[calc(72px+env(safe-area-inset-bottom)+1rem)] md:bottom-4 md:left-auto md:right-4 md:max-w-sm"
          variants={variants}
          initial="hidden"
          animate="visible"
          exit="exit"
          role="alertdialog"
          aria-labelledby="pwa-update-title"
          aria-describedby="pwa-update-description"
        >
          <Card 
            variant="elevated" 
            padding="md" 
            className="relative bg-card text-card-foreground border border-border shadow-2xl backdrop-blur-none"
          >
            {/* Close button in top-right corner */}
            <button
              onClick={handleDismiss}
              className="absolute right-2 top-2 p-1.5 rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text-default)] hover:bg-[var(--color-bg-subtle)] transition-colors"
              aria-label={t('ui.pwaUpdate.close_aria')}
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex gap-3">
              {/* Icon */}
              <div className="flex-shrink-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-accent-100)] dark:bg-[var(--color-accent-900)]">
                  <RefreshCw className="h-5 w-5 text-[var(--color-accent-600)] dark:text-[var(--color-accent-400)]" />
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pr-4">
                <h3
                  id="pwa-update-title"
                  className="text-sm font-semibold text-[var(--color-text-default)]"
                >
                  {resolvedTitle}
                </h3>
                <p
                  id="pwa-update-description"
                  className="mt-1 text-sm text-[var(--color-text-muted)]"
                >
                  {resolvedDescription}
                </p>

                {/* Action buttons */}
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleUpdate}
                    className="flex-1 sm:flex-none"
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    {resolvedUpdateText}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDismiss}
                    className="flex-1 sm:flex-none"
                  >
                    {resolvedDismissText}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </m.div>
      )}
    </AnimatePresence>
  );
}

export default PWAUpdatePrompt;
