// Authentication Store

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authAPI } from '@/api/auth';
import type { AuthState } from '@/types/state';
import { STORAGE_KEYS } from '@/types/state';
import { clearAllCaches, backupReadingProgress, restoreReadingProgress } from '@/utils/cacheManager';

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
          console.log('🧹 Clearing stale caches before login...');
          await clearAllCaches();

          const response = await authAPI.login({ email, password });
          const { user } = response; // Tokens are now in HttpOnly cookies

          console.log('🔐 Login successful for:', user.email);
          
          // Store user data in localStorage for offline access
          localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(user));

          // IMPORTANT: Restore reading progress AFTER successful login
          console.log('📂 Checking for reading progress backup...');
          const restored = restoreReadingProgress(user.id);
          if (restored) {
            console.log('✅ Reading progress restored successfully');
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
          console.log('🧹 Clearing stale caches before registration...');
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
        console.log('🚪 Logging out...');

        const userId = get().user?.id;
        if (userId) {
          console.log('💾 Backing up reading progress before logout...');
          backupReadingProgress(userId);
        }

        // TD-FRONT-130: Properly await logout API call (clears cookies + blacklists token)
        try {
          await authAPI.logout();
          console.log('✅ Logout API call successful');
        } catch (error) {
          console.error('❌ Logout API call failed:', error);
        }

        // Clear localStorage
        localStorage.removeItem(STORAGE_KEYS.USER_DATA);
        localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);

        console.log('🧹 Clearing all caches on logout...');
        try {
          await clearAllCaches();
          console.log('✅ All caches cleared on logout');
        } catch (error) {
          console.error('❌ Failed to clear some caches on logout:', error);
        }

        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
        });
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
        console.log('📱 Loading user session...');
        set({ isLoading: true });

        try {
          // Optimistically load user data for UI
          const userData = localStorage.getItem(STORAGE_KEYS.USER_DATA);
          if (userData) {
            set({ user: JSON.parse(userData) });
          }

          // Verify session with API (checks HttpOnly cookies)
          const response = await authAPI.getCurrentUser();
          console.log('✅ Session valid for:', response.user.email);
          
          set({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
          });
          
          // Update cached user data
          localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(response.user));
          
        } catch {
          console.log('❌ Session invalid or expired');
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
        console.log('🔄 Zustand rehydrating auth store...');
        setTimeout(() => {
          useAuthStore.getState().loadUserFromStorage();
        }, 100);
      },
    }
  )
);