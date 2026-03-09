/**
 * PWAInstallBanner - Install prompt banner for PWA
 *
 * Displays an install banner on the library page when the app can be installed.
 * Handles both Chrome/Android (beforeinstallprompt) and iOS (manual instructions).
 *
 * Features:
 * - Dismiss logic with localStorage (max 3 shows, 7-day cooldown)
 * - iOS-specific instructions via IOSInstallInstructions
 * - Spring slide-up animation (same pattern as PWAUpdatePrompt)
 * - Respects online status (hidden when offline)
 * - Hidden when already installed
 *
 * @module components/UI/PWAInstallBanner
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { m, AnimatePresence } from 'motion/react';
import { Download } from 'lucide-react';
import { Button } from '@/components/UI/button';
import { Card } from '@/components/UI/Card';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { IOSInstallInstructions } from '@/components/UI/IOSInstallInstructions';

// --- Dismiss logic (pure functions, localStorage-based) ---

const DISMISS_KEY = 'pwa_install_dismiss';
const MAX_DISMISS_COUNT = 3;
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface DismissRecord {
  timestamp: number;
  count: number;
}

function getDismissRecord(): DismissRecord | null {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DismissRecord;
  } catch {
    return null;
  }
}

function shouldShowBanner(): boolean {
  const record = getDismissRecord();
  if (!record) return true;
  if (record.count >= MAX_DISMISS_COUNT) return false;
  const elapsed = Date.now() - record.timestamp;
  return elapsed >= DISMISS_COOLDOWN_MS;
}

function recordDismiss(): void {
  const record = getDismissRecord();
  const newRecord: DismissRecord = {
    timestamp: Date.now(),
    count: (record?.count ?? 0) + 1,
  };
  localStorage.setItem(DISMISS_KEY, JSON.stringify(newRecord));
}

// --- Animation variants (same as PWAUpdatePrompt) ---

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

/**
 * PWAInstallBanner component
 *
 * Self-contained banner that manages its own visibility.
 * Shows install prompt on Chrome/Android or iOS instructions.
 */
export function PWAInstallBanner() {
  const { t } = useTranslation();
  const { isInstallable, isInstalled, isIOSDevice, install } = usePWAInstall();
  const { isOnline } = useOnlineStatus();

  const [dismissed, setDismissed] = useState(() => !shouldShowBanner());
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  const handleDismiss = useCallback(() => {
    recordDismiss();
    setDismissed(true);
  }, []);

  const handleInstall = useCallback(async () => {
    const accepted = await install();
    if (accepted) {
      setDismissed(true);
    }
  }, [install]);

  const handleIOSGuide = useCallback(() => {
    setShowIOSInstructions((prev) => !prev);
  }, []);

  // Determine visibility
  const shouldShow = !isInstalled && isOnline && !dismissed && (isInstallable || isIOSDevice);

  return (
    <AnimatePresence>
      {shouldShow && (
        <m.div
          className="fixed bottom-4 left-4 right-4 z-[500] pb-[env(safe-area-inset-bottom)] md:left-auto md:right-4 md:max-w-[400px] md:mx-auto"
          variants={variants}
          initial="hidden"
          animate="visible"
          exit="exit"
          role="alert"
          aria-labelledby="pwa-install-title"
          aria-describedby="pwa-install-description"
        >
          <Card
            variant="elevated"
            padding="md"
            className="relative bg-card text-card-foreground border border-border shadow-2xl"
          >
            <div className="flex gap-3">
              {/* App icon */}
              <div className="flex-shrink-0">
                <img
                  src="/favicon-192.png"
                  alt=""
                  className="w-10 h-10 rounded-lg"
                  aria-hidden="true"
                />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <h3
                  id="pwa-install-title"
                  className="text-sm font-semibold text-[var(--color-text-default)]"
                >
                  {t('ui.pwaInstall.title')}
                </h3>
                <p
                  id="pwa-install-description"
                  className="mt-1 text-sm text-[var(--color-text-muted)]"
                >
                  {t('ui.pwaInstall.description')}
                </p>

                {/* Action buttons */}
                <div className="mt-3 flex gap-2">
                  {isInstallable ? (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleInstall}
                      className="flex-1 sm:flex-none"
                    >
                      <Download className="h-4 w-4 mr-1" />
                      {t('ui.pwaInstall.install')}
                    </Button>
                  ) : isIOSDevice ? (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleIOSGuide}
                      className="flex-1 sm:flex-none"
                    >
                      {t('ui.pwaInstall.ios_guide')}
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDismiss}
                    className="flex-1 sm:flex-none"
                  >
                    {t('ui.pwaInstall.dismiss')}
                  </Button>
                </div>

                {/* iOS install instructions (inline) */}
                {showIOSInstructions && isIOSDevice && (
                  <div className="mt-3">
                    <IOSInstallInstructions
                      mode="inline"
                      showOnlyOnIOS={false}
                      forceShow
                      onDismiss={() => setShowIOSInstructions(false)}
                    />
                  </div>
                )}
              </div>
            </div>
          </Card>
        </m.div>
      )}
    </AnimatePresence>
  );
}

export default PWAInstallBanner;
