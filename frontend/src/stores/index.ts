import { initializeStorageManagement, stopStorageMonitoring } from '@/services/storageManager';
import { imageCache } from '@/services/imageCache';
import { retryPendingSync } from '@/services/syncQueue';
import { registerPeriodicSync } from '@/utils/serviceWorker';
import { tabSync } from '@/services/tabSync';
import { logger } from '@/lib/logger';

// Main store exports
export { useAuthStore } from './auth';
export { useReaderStore } from './reader';
export { useUIStore, notify } from './ui';

// Store initialization function
export const initializeStores = () => {
  tabSync.init();

  try {
    const theme = localStorage.getItem('bookreader_theme') || 'light';
    const root = document.documentElement;
    root.classList.remove('light', 'dark', 'sepia');
    root.classList.add(theme);
  } catch (error) {
    logger.warn('Failed to initialize theme:', error);
  }
  
  // Auth store initialization is handled by Zustand persist's onRehydrateStorage
  // DO NOT call loadUserFromStorage here - it causes duplicate API calls and race conditions

  setTimeout(() => {
    initializeStorageManagement();
  }, 1000);

  setTimeout(() => {
    retryPendingSync().catch(() => {
      logger.debug('[Stores] retryPendingSync failed');
    });
  }, 3000);

  // Register for Periodic Background Sync (Android Chrome 80+ only)
  // This allows background sync of reading progress when app is closed
  // Note: iOS Safari does not support this API
  setTimeout(async () => {
    try {
      const registered = await registerPeriodicSync('sync-reading-progress', 12 * 60 * 60 * 1000); // 12 hours
      if (registered) {
        logger.debug('[Stores] Periodic Background Sync registered');
      } else {
        logger.debug('[Stores] Periodic Background Sync not available (iOS/Firefox or not installed as PWA)');
      }
    } catch (error) {
      logger.debug('[Stores] Periodic Sync registration failed:', error);
    }
  }, 2000);
};

/**
 * Cleanup function to stop all intervals and release resources.
 * Should be called on app unmount to prevent memory leaks.
 * TD-FRONT-131: Fix memory leak risks
 */
export const cleanupStores = () => {
  logger.debug('[Stores] Cleaning up...');
  
  // Stop storage monitoring interval
  stopStorageMonitoring();
  
  imageCache.destroy();

  tabSync.destroy();
  
  logger.debug('[Stores] Cleanup complete');
};