import { logger } from '@/lib/logger';
/**
 * iOS Support Utilities
 *
 * Provides platform detection, capability checking, and iOS-specific workarounds
 * for PWA functionality. iOS has limited support for certain Web APIs, so these
 * utilities help implement fallbacks and inform users about limitations.
 *
 * Key limitations on iOS:
 * - No Background Sync API support
 * - Push notifications only available in iOS 16.4+ in standalone mode
 * - Storage may be evicted after 7 days of inactivity in Safari
 * - No beforeinstallprompt event (manual install instructions required)
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Minimum iOS version that supports Web Push notifications in PWA mode
 */
export const IOS_MIN_PUSH_VERSION = 16.4;

/**
 * Number of days after which iOS Safari may evict storage data
 * (only applies to non-persistent storage)
 */
export const IOS_STORAGE_EVICTION_DAYS = 7;

/**
 * localStorage key for storing iOS install instructions dismissal timestamp
 */
export const IOS_INSTALL_DISMISSED_KEY = 'ios-install-dismissed';

/**
 * Number of days before showing install instructions again after dismissal
 */
export const IOS_INSTALL_REMIND_DAYS = 7;

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Checks if the current device is running iOS (iPhone, iPad, or iPod)
 *
 * @returns true if the device is running iOS
 *
 * @example
 * if (isIOS()) {
 *   // Apply iOS-specific workarounds
 * }
 */
export function isIOS(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent;
  const isIOSDevice = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isIOSDevice || isIPadOS;
}

/**
 * Checks if the current browser is Safari
 *
 * Note: This checks for Safari specifically, not Safari-based browsers like
 * Chrome on iOS (which uses WebKit but isn't Safari)
 *
 * @returns true if the browser is Safari
 */
export function isSafari(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('safari') && !ua.includes('chrome') && !ua.includes('android');
}

/**
 * Checks if the current browser is Safari on iOS
 *
 * This is the combination that requires special handling for PWA features
 *
 * @returns true if running Safari on iOS
 */
export function isIOSSafari(): boolean {
  return isIOS() && isSafari();
}

/**
 * Checks if the app is running in standalone mode (installed as PWA)
 *
 * This works on both iOS and Android/Chrome
 *
 * @returns true if the app is running as an installed PWA
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  // iOS Safari uses navigator.standalone
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const navigatorStandalone = (navigator as any).standalone;
  if (navigatorStandalone === true) {
    return true;
  }

  // Standard display-mode media query (works on Android/Chrome and modern browsers)
  if (window.matchMedia('(display-mode: standalone)').matches) {
    return true;
  }

  // Also check for fullscreen mode (some PWAs use this)
  if (window.matchMedia('(display-mode: fullscreen)').matches) {
    return true;
  }

  return false;
}

/**
 * Checks if the current device is running Android
 *
 * @returns true if the device is running Android
 *
 * @example
 * if (isAndroid()) {
 *   // Apply Android-specific workarounds
 * }
 */
export function isAndroid(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  return /Android/i.test(navigator.userAgent);
}

/**
 * Checks if the current device is a mobile device (iOS or Android)
 *
 * @returns true if the device is mobile
 *
 * @example
 * if (isMobile()) {
 *   // Apply mobile-specific UI adjustments
 * }
 */
export function isMobile(): boolean {
  return isIOS() || isAndroid();
}

/**
 * Parses and returns the iOS version from the user agent string
 *
 * @returns iOS version as a number (e.g., 16.4), or null if not iOS
 *
 * @example
 * const version = getIOSVersion();
 * if (version && version >= 16.4) {
 *   // Can use push notifications
 * }
 */
export function getIOSVersion(): number | null {
  if (!isIOS()) {
    return null;
  }

  const ua = navigator.userAgent;

  // Match patterns like "OS 16_4" or "OS 16_4_1"
  const match = ua.match(/OS (\d+)[_.](\d+)(?:[_.](\d+))?/);

  if (match) {
    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    // Return as a decimal (e.g., 16.4)
    return major + minor / 10;
  }

  return null;
}

// ============================================================================
// Capability Checking
// ============================================================================

/**
 * Checks if push notifications can be used on iOS
 *
 * Push notifications on iOS require:
 * - iOS 16.4 or later
 * - App running in standalone (PWA) mode
 * - User permission granted
 *
 * @returns true if push notifications are available
 */
export function canUsePushOnIOS(): boolean {
  if (!isIOS()) {
    // Non-iOS devices have different requirements
    return 'Notification' in window && 'serviceWorker' in navigator;
  }

  const version = getIOSVersion();

  // Must be iOS 16.4+ and in standalone mode
  return version !== null && version >= IOS_MIN_PUSH_VERSION && isStandalone();
}

/**
 * Checks if Background Sync API is available
 *
 * Background Sync is NOT supported on iOS Safari at all.
 * This function always returns false on iOS.
 *
 * @returns true if Background Sync can be used
 */
export function canUseBackgroundSync(): boolean {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  // iOS Safari does not support Background Sync
  if (isIOS()) {
    return false;
  }

  // Check if SyncManager is available (Chrome, Edge, etc.)
  return 'SyncManager' in window;
}

/**
 * Checks if persistent storage can be requested
 *
 * Persistent storage prevents the browser from automatically evicting
 * data when storage space is low.
 *
 * @returns true if persistent storage API is available
 */
export function canUsePersistentStorage(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return 'storage' in navigator && 'persist' in navigator.storage;
}

// ============================================================================
// iOS-Specific Workarounds
// ============================================================================

/**
 * Sets up iOS-compatible sync mechanism using visibility and online events
 *
 * Since iOS doesn't support Background Sync, we use:
 * - visibilitychange: Sync when app returns to foreground
 * - online: Sync when network is restored
 *
 * @param syncFn - Async function to call for synchronization
 * @returns Cleanup function to remove event listeners
 *
 * @example
 * // In a React component or service
 * const cleanup = setupIOSSync(async () => {
 *   await syncQueue.processQueue();
 * });
 *
 * // On unmount
 * cleanup();
 */
export function setupIOSSync(syncFn: () => Promise<void>): () => void {
  let isProcessing = false;

  const runSync = async () => {
    if (isProcessing) {
      return;
    }

    isProcessing = true;
    try {
      await syncFn();
    } catch (error) {
      logger.error('[IOSSync] Sync failed:', error);
    } finally {
      isProcessing = false;
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      logger.debug('[IOSSync] App visible and online, triggering sync');
      runSync();
    }
  };

  const handleOnline = () => {
    if (document.visibilityState === 'visible') {
      logger.debug('[IOSSync] Network restored, triggering sync');
      runSync();
    }
  };

  // Add event listeners
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('online', handleOnline);

  // Also sync on app:online custom event (from useOnlineStatus)
  window.addEventListener('app:online', handleOnline);

  // Return cleanup function
  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('app:online', handleOnline);
  };
}

/**
 * Requests persistent storage to prevent automatic eviction
 *
 * On iOS Safari, data can be evicted after 7 days of inactivity.
 * Requesting persistent storage can help prevent this, though
 * the browser may still deny the request.
 *
 * @returns true if persistent storage was granted, false otherwise
 *
 * @example
 * const isPersisted = await setupIOSPersistence();
 * if (!isPersisted) {
 *   logger.warn('Storage may be evicted after 7 days of inactivity');
 * }
 */
export async function setupIOSPersistence(): Promise<boolean> {
  if (!canUsePersistentStorage()) {
    logger.warn('[IOSPersistence] Persistent storage API not available');
    return false;
  }

  try {
    // Check current persistence state
    const isPersisted = await navigator.storage.persisted();

    if (isPersisted) {
      logger.debug('[IOSPersistence] Storage is already persistent');
      return true;
    }

    // Request persistence
    const granted = await navigator.storage.persist();

    if (granted) {
      logger.debug('[IOSPersistence] Persistent storage granted');
    } else {
      logger.warn(
        '[IOSPersistence] Persistent storage denied - data may be evicted after',
        IOS_STORAGE_EVICTION_DAYS,
        'days'
      );
    }

    return granted;
  } catch (error) {
    logger.error('[IOSPersistence] Failed to request persistent storage:', error);
    return false;
  }
}

/**
 * Returns step-by-step instructions for installing the PWA on iOS
 *
 * These instructions guide users through the "Add to Home Screen" flow
 * in Safari, which is the only way to install a PWA on iOS.
 *
 * @returns Array of instruction strings
 *
 * @example
 * const steps = getIOSInstallInstructions();
 * steps.forEach((step, index) => {
 *   logger.debug(`${index + 1}. ${step}`);
 * });
 */
export function getIOSInstallInstructions(): string[] {
  return [
    'Tap the Share button at the bottom of the screen',
    'Scroll down and tap "Add to Home Screen"',
    'Tap "Add" in the top right corner',
  ];
}

// ============================================================================
// Install Instructions Dismissal Management
// ============================================================================

/**
 * Checks if the iOS install instructions should be shown
 *
 * Returns true if:
 * - Device is iOS Safari (not in standalone mode)
 * - User hasn't dismissed the prompt, OR
 * - It's been more than 7 days since dismissal
 *
 * @returns true if install instructions should be shown
 */
export function shouldShowIOSInstallPrompt(): boolean {
  // Only show on iOS Safari when not already installed
  if (!isIOSSafari() || isStandalone()) {
    return false;
  }

  // Check if user has dismissed the prompt
  const dismissedTimestamp = localStorage.getItem(IOS_INSTALL_DISMISSED_KEY);

  if (!dismissedTimestamp) {
    return true;
  }

  // Check if enough time has passed since dismissal
  const dismissedDate = new Date(parseInt(dismissedTimestamp, 10));
  const now = new Date();
  const daysSinceDismissal =
    (now.getTime() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24);

  return daysSinceDismissal >= IOS_INSTALL_REMIND_DAYS;
}

/**
 * Records that the user dismissed the iOS install instructions
 *
 * The dismissal is stored in localStorage with a timestamp,
 * allowing the prompt to be shown again after a period of time.
 */
export function dismissIOSInstallPrompt(): void {
  try {
    localStorage.setItem(IOS_INSTALL_DISMISSED_KEY, Date.now().toString());
  } catch (error) {
    logger.warn('[IOSSupport] Failed to save dismissal state:', error);
  }
}

/**
 * Clears the iOS install instructions dismissal state
 *
 * This will cause the install prompt to be shown again on the next visit.
 */
export function clearIOSInstallDismissal(): void {
  try {
    localStorage.removeItem(IOS_INSTALL_DISMISSED_KEY);
  } catch (error) {
    logger.warn('[IOSSupport] Failed to clear dismissal state:', error);
  }
}

// ============================================================================
// Utility: Combined Platform Info
// ============================================================================

/**
 * Returns comprehensive platform information for debugging and analytics
 *
 * @returns Object with platform details
 */
export function getPlatformInfo(): {
  isIOS: boolean;
  isSafari: boolean;
  isIOSSafari: boolean;
  isStandalone: boolean;
  iosVersion: number | null;
  canUsePush: boolean;
  canUseBackgroundSync: boolean;
  canUsePersistentStorage: boolean;
} {
  return {
    isIOS: isIOS(),
    isSafari: isSafari(),
    isIOSSafari: isIOSSafari(),
    isStandalone: isStandalone(),
    iosVersion: getIOSVersion(),
    canUsePush: canUsePushOnIOS(),
    canUseBackgroundSync: canUseBackgroundSync(),
    canUsePersistentStorage: canUsePersistentStorage(),
  };
}
