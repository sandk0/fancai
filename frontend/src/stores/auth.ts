// Authentication Store

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authAPI } from '@/api/auth';
import type { AuthState } from '@/types/state';
import { STORAGE_KEYS } from '@/types/state';
import {
  clearAllCaches,
  backupReadingProgress,
  restoreReadingProgress,
} from '@/utils/cacheManager';
import { tabSync } from '@/services/tabSync';
import { logger } from '@/lib/logger';

const USER_DATA_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Store user data with expiration timestamp */
function setUserDataWithTTL(user: unknown): void {
  localStorage.setItem(
    STORAGE_KEYS.USER_DATA,
    JSON.stringify({ data: user, expiresAt: Date.now() + USER_DATA_TTL_MS })
  );
}

/** Read user data, returning null if expired */
function getUserDataWithTTL(): unknown | null {
  const raw = localStorage.getItem(STORAGE_KEYS.USER_DATA);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    // Backward compat: old format stored user directly
    const userData = parsed.expiresAt ? parsed.data : parsed;
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      localStorage.removeItem(STORAGE_KEYS.USER_DATA);
      return null;
    }
    return userData;
  } catch {
    localStorage.removeItem(STORAGE_KEYS.USER_DATA);
    return null;
  }
}

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

          // Store user data in localStorage for offline access (with TTL)
          setUserDataWithTTL(user);

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
            full_name: fullName,
          });
          const { user } = response;

          setUserDataWithTTL(user);

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

        // Notify service worker to clear cached API data
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'LOGOUT' });
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
          await authAPI.refreshToken();
        } catch (error) {
          get().logout();
          throw error;
        }
      },

      updateUser: (user) => {
        set({ user });
        setUserDataWithTTL(user);
      },

      loadUserFromStorage: async () => {
        logger.debug('📱 Loading user session...');
        set({ isLoading: true });

        try {
          // Optimistically load user data for UI (TTL-aware)
          const cachedUser = getUserDataWithTTL();
          if (cachedUser) {
            set({ user: cachedUser as AuthState['user'] });
          }

          // Verify session with API (checks HttpOnly cookies)
          const response = await authAPI.getCurrentUser();
          logger.debug('✅ Session valid for:', response.user.email);

          set({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
          });

          // Update cached user data with TTL
          setUserDataWithTTL(response.user);
        } catch (error) {
          // Временный отказ — не повод разлогинивать. Раньше сюда попадал
          // любой сбой `/auth/me`, включая 429 от лимитера и обрыв сети:
          // сессия обнулялась, и AuthGuard уводил на /login, хотя cookie
          // были живы. Постоянным считается только явный отказ в доступе.
          // Правило перевёрнуто намеренно: постоянным считается только
          // ДОКАЗАННЫЙ отказ в доступе. Всё остальное — 429 от лимитера,
          // 5xx, обрыв сети, неизвестная ошибка — временное, и сессия
          // остаётся. Раньше было наоборот, и любой сбой `/auth/me`
          // выкидывал пользователя на /login при живых cookie.
          const status = (error as { status?: number })?.status;
          const isPermanent = status === 401 || status === 403;

          if (!isPermanent) {
            logger.warn('⏳ Проверка сессии временно не удалась:', status ?? 'без статуса');
            set({ isLoading: false });
            return;
          }

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
