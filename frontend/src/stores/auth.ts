// Authentication Store

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authAPI } from '@/api/auth';
import type { AuthState } from '@/types/state';
import { STORAGE_KEYS } from '@/types/state';
import { clearAllCaches, backupReadingProgress, restoreReadingProgress } from '@/utils/cacheManager';
import { tabSync } from '@/services/tabSync';
import { logger } from '@/lib/logger';

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      isAuthenticated: false,
      isLoading: false,

      // Actions
      login: async (email: string, password: string) => {
        set({ isLoading: true });

        try {
          // Clear any stale caches from previous session BEFORE login
          logger.debug('🧹 Clearing stale caches before login...');
          await clearAllCaches();

          const response = await authAPI.login({ email, password });
          const { user } = response; // Tokens are now in HttpOnly cookies

          logger.debug('🔐 Login successful for:', user.email);
          
          // Store user data in localStorage for offline access
          localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(user));

          // IMPORTANT: Restore reading progress AFTER successful login
          logger.debug('📂 Checking for reading progress backup...');
          const restored = restoreReadingProgress(user.id);
          if (restored) {
            logger.debug('✅ Reading progress restored successfully');
          }

          set({
            user,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      register: async (email: string, password: string, fullName?: string) => {
        set({ isLoading: true });

        try {
          logger.debug('🧹 Clearing stale caches before registration...');
          await clearAllCaches();

          const response = await authAPI.register({
            email,
            password,
            full_name: fullName
          });
          const { user } = response;

          localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(user));

          set({
            user,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          set({ isLoading: false });
          throw error;
        }
      },

      logout: async () => {
        logger.debug('🚪 Logging out...');

        const userId = get().user?.id;
        if (userId) {
          logger.debug('💾 Backing up reading progress before logout...');
          backupReadingProgress(userId);
        }

        // TD-FRONT-130: Properly await logout API call (clears cookies + blacklists token)
        try {
          await authAPI.logout();
          logger.debug('✅ Logout API call successful');
        } catch (error) {
          logger.error('❌ Logout API call failed:', error);
        }

        // Clear localStorage
        localStorage.removeItem(STORAGE_KEYS.USER_DATA);
        localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);

        logger.debug('🧹 Clearing all caches on logout...');
        try {
          await clearAllCaches();
          logger.debug('✅ All caches cleared on logout');
        } catch (error) {
          logger.error('❌ Failed to clear some caches on logout:', error);
        }

        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
        });

        tabSync.broadcast({ type: 'logout' });
      },

      refreshAccessToken: async () => {
        // Just call API, cookies handled automatically
        try {
          await authAPI.refreshToken(''); // Argument ignored in new implementation
        } catch (error) {
          get().logout();
          throw error;
        }
      },

      updateUser: (user) => {
        set({ user });
        localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(user));
      },

      loadUserFromStorage: async () => {
        logger.debug('📱 Loading user session...');
        set({ isLoading: true });

        try {
          // Optimistically load user data for UI
          const userData = localStorage.getItem(STORAGE_KEYS.USER_DATA);
          if (userData) {
            set({ user: JSON.parse(userData) });
          }

          // Verify session with API (checks HttpOnly cookies)
          const response = await authAPI.getCurrentUser();
          logger.debug('✅ Session valid for:', response.user.email);
          
          set({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
          });
          
          // Update cached user data
          localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(response.user));
          
        } catch {
          logger.debug('❌ Session invalid or expired');
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
          });
          localStorage.removeItem(STORAGE_KEYS.USER_DATA);
        }
      },
    }),
    {
      name: 'auth-store',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (_state) => {
        logger.debug('🔄 Zustand rehydrating auth store...');
        setTimeout(() => {
          useAuthStore.getState().loadUserFromStorage();
        }, 100);
      },
    }
  )
);

// Tab sync: when another tab logs out, clear local state and redirect
tabSync.subscribe('logout', () => {
  localStorage.removeItem(STORAGE_KEYS.USER_DATA);
  localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);

  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
  });

  window.location.href = '/login';
});