// Store imports for initialization
import { initializeStorageManagement, stopStorageMonitoring } from '@/services/storageManager';
import { imageCache } from '@/services/imageCache';
import { registerPeriodicSync } from '@/utils/serviceWorker';

const DEBUG = import.meta.env.DEV;

// Main store exports
export { useAuthStore } from './auth';
export { useBooksStore } from './books';
export { useImagesStore } from './images';
export { useReaderStore } from './reader';
export { useUIStore, notify } from './ui';

// Store initialization function
export const initializeStores = () => {
  // Apply saved theme
  try {
    const theme = localStorage.getItem('bookreader_theme') || 'light';
    const root = document.documentElement;
    root.classList.remove('light', 'dark', 'sepia');
    root.classList.add(theme);
  } catch (error) {
    console.warn('Failed to initialize theme:', error);
  }
  
  // Auth store initialization is handled by Zustand persist's onRehydrateStorage
  // DO NOT call loadUserFromStorage here - it causes duplicate API calls and race conditions

  // Initialize storage management for PWA (delay to ensure app is ready)
  setTimeout(() => {
    initializeStorageManagement();
  }, 1000);

  // Register for Periodic Background Sync (Android Chrome 80+ only)
  // This allows background sync of reading progress when app is closed
  // Note: iOS Safari does not support this API
  setTimeout(async () => {
    try {
      const registered = await registerPeriodicSync('sync-reading-progress', 12 * 60 * 60 * 1000); // 12 hours
      if (registered) {
        if (DEBUG) console.log('[Stores] Periodic Background Sync registered');
      } else {
        if (DEBUG) console.log('[Stores] Periodic Background Sync not available (iOS/Firefox or not installed as PWA)');
      }
    } catch (error) {
      if (DEBUG) console.log('[Stores] Periodic Sync registration failed:', error);
    }
  }, 2000);
};

/**
 * Cleanup function to stop all intervals and release resources.
 * Should be called on app unmount to prevent memory leaks.
 * TD-FRONT-131: Fix memory leak risks
 */
export const cleanupStores = () => {
  if (DEBUG) console.log('[Stores] Cleaning up...');
  
  // Stop storage monitoring interval
  stopStorageMonitoring();
  
  // Destroy image cache (stops auto-cleanup interval + releases Object URLs)
  imageCache.destroy();
  
  if (DEBUG) console.log('[Stores] Cleanup complete');
};