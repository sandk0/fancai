/**
 * OfflineBanner - Network status indicator component
 *
 * Displays a banner when the user goes offline or when sync operations are pending.
 * Automatically hides when online with no pending operations.
 *
 * Features:
 * - Real-time network status tracking
 * - Pending sync operations count (async via IndexedDB)
 * - Smooth slide-down animation via framer-motion
 * - Safe area padding for notched devices
 * - Dark theme compatible
 */

import { useState, useEffect, useCallback } from 'react';
import { m, AnimatePresence } from 'motion/react';
import { WifiOff, RefreshCw, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { getPendingCount, subscribeSyncQueue } from '@/services/syncQueue';
import { logger } from '@/lib/logger';

interface OfflineBannerProps {
  /** Auto-hide banner after sync complete (ms). Set to 0 to disable. */
  autoHideDelay?: number;
  /** Additional CSS classes */
  className?: string;
}

/**
 * OfflineBanner component for displaying network and sync status
 *
 * @example
 * ```tsx
 * // Basic usage (in App.tsx)
 * <OfflineBanner />
 *
 * // With custom auto-hide delay
 * <OfflineBanner autoHideDelay={5000} />
 * ```
 */
export function OfflineBanner({
  autoHideDelay = 3000,
  className = '',
}: OfflineBannerProps) {
  const { isOnline, wasOffline } = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [showSyncSuccess, setShowSyncSuccess] = useState(false);

  // Fetch pending count asynchronously
  const updatePendingCount = useCallback(async () => {
    try {
      const count = await getPendingCount();
      setPendingCount(count);
    } catch (error) {
      logger.warn('[OfflineBanner] Failed to get pending count:', error);
      setPendingCount(0);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(updatePendingCount, 0);
    const interval = setInterval(updatePendingCount, 5000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [updatePendingCount]);

  // Subscribe to queue changes for immediate updates
  useEffect(() => {
    const unsubscribe = subscribeSyncQueue(() => {
      updatePendingCount();
    });

    return unsubscribe;
  }, [updatePendingCount]);

  const [prevDerived, setPrevDerived] = useState({ isOnline, wasOffline, pendingCount });
  if (
    prevDerived.isOnline !== isOnline ||
    prevDerived.wasOffline !== wasOffline ||
    prevDerived.pendingCount !== pendingCount
  ) {
    setPrevDerived({ isOnline, wasOffline, pendingCount });

    if (!isOnline) {
      setIsVisible(true);
      setShowSyncSuccess(false);
    } else if (wasOffline && pendingCount > 0) {
      setIsVisible(true);
      setShowSyncSuccess(false);
    } else if (wasOffline && pendingCount === 0) {
      setShowSyncSuccess(true);
      setIsVisible(true);
    } else if (pendingCount > 0) {
      setIsVisible(true);
      setShowSyncSuccess(false);
    } else {
      setIsVisible(false);
    }
  }

  useEffect(() => {
    if (wasOffline && pendingCount === 0 && isOnline && autoHideDelay > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, autoHideDelay);
      return () => clearTimeout(timer);
    }
  }, [isOnline, wasOffline, pendingCount, autoHideDelay]);

  // Animation variants for slide-down effect
  const variants = {
    hidden: {
      y: -100,
      opacity: 0,
    },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        type: 'spring' as const,
        damping: 25,
        stiffness: 300,
      },
    },
    exit: {
      y: -100,
      opacity: 0,
      transition: {
        duration: 0.2,
      },
    },
  };

  // Determine banner state and styling
  const { t } = useTranslation();

  const getBannerConfig = () => {
    if (!isOnline) {
      return {
        bgColor: 'bg-red-600 dark:bg-red-700',
        icon: <WifiOff className="h-4 w-4" />,
        text: t('ui.offline.no_connection'),
        subtext: pendingCount > 0
          ? t('ui.offline.pending_sync', { count: pendingCount })
          : t('ui.offline.saved_locally'),
      };
    }

    if (pendingCount > 0) {
      return {
        bgColor: 'bg-amber-500 dark:bg-amber-600',
        icon: <RefreshCw className="h-4 w-4 animate-spin" />,
        text: t('ui.offline.syncing'),
        subtext: t('ui.offline.pending_sync', { count: pendingCount }),
      };
    }

    if (showSyncSuccess) {
      return {
        bgColor: 'bg-green-600 dark:bg-green-700',
        icon: <CheckCircle className="h-4 w-4" />,
        text: t('ui.offline.sync_complete'),
        subtext: t('ui.offline.all_saved'),
      };
    }

    return null;
  };

  const config = getBannerConfig();

  return (
    <AnimatePresence>
      {isVisible && config && (
        <m.div
          className={`
            fixed top-0 left-0 right-0 z-[800]
            pt-[env(safe-area-inset-top,0px)]
            ${config.bgColor}
            ${className}
          `}
          variants={variants}
          initial="hidden"
          animate="visible"
          exit="exit"
          role="status"
          aria-live="polite"
        >
          <div className="px-4 py-2">
            <div className="flex items-center justify-center gap-2 text-white text-sm">
              {config.icon}
              <span className="font-medium">{config.text}</span>
              {config.subtext && (
                <>
                  <span className="hidden sm:inline text-white/80">|</span>
                  <span className="hidden sm:inline text-white/80">{config.subtext}</span>
                </>
              )}
            </div>
            {/* Mobile subtext on second line */}
            {config.subtext && (
              <div className="sm:hidden text-center text-xs text-white/80 mt-0.5">
                {config.subtext}
              </div>
            )}
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

export default OfflineBanner;
