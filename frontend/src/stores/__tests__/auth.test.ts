/**
 * Auth Store Tests
 *
 * Tests authentication with HttpOnly cookie-based auth.
 * Note: Tokens are managed by HttpOnly cookies, not stored in state.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuthStore } from '../auth';
import { authAPI } from '@/api/auth';
import { STORAGE_KEYS } from '@/types/state';

vi.mock('@/api/auth', () => ({
  authAPI: {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
    refreshToken: vi.fn(),
  },
}));

vi.mock('@/utils/cacheManager', () => ({
  clearAllCaches: vi.fn().mockResolvedValue(undefined),
  backupReadingProgress: vi.fn(),
  restoreReadingProgress: vi.fn().mockReturnValue(false),
}));

vi.mock('@/services/tabSync', () => ({
  tabSync: {
    broadcast: vi.fn(),
    subscribe: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import {
  clearAllCaches,
  backupReadingProgress,
  restoreReadingProgress,
} from '@/utils/cacheManager';
import { tabSync } from '@/services/tabSync';

describe('Auth Store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const { result } = renderHook(() => useAuthStore());

      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('login', () => {
    const mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      full_name: 'Test User',
      is_active: true,
      is_verified: true,
      is_admin: false,
      created_at: new Date().toISOString(),
    };

    const mockResponse = {
      user: mockUser,
      tokens: {
        access_token: 'access-token-123',
        refresh_token: 'refresh-token-123',
        token_type: 'bearer',
        expires_in: 3600,
      },
      message: 'Login successful',
    };

    it('should login successfully', async () => {
      vi.mocked(authAPI.login).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.login('test@example.com', 'password123');
      });

      expect(result.current.user).toEqual(mockUser);
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.isLoading).toBe(false);
    });

    it('should persist user data after login', async () => {
      vi.mocked(authAPI.login).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.login('test@example.com', 'password123');
      });

      expect(result.current.user).toEqual(mockUser);
      expect(authAPI.login).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });

    it('should handle login error', async () => {
      vi.mocked(authAPI.login).mockRejectedValue(new Error('Invalid credentials'));

      const { result } = renderHook(() => useAuthStore());

      try {
        await act(async () => {
          await result.current.login('wrong@example.com', 'wrongpassword');
        });
      } catch {
        // Expected to throw
      }

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });

    it('should set loading state during login', async () => {
      const loadingStates: boolean[] = [];
      vi.mocked(authAPI.login).mockImplementation(async () => {
        loadingStates.push(useAuthStore.getState().isLoading);
        return mockResponse;
      });

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.login('test@example.com', 'password');
      });

      expect(loadingStates[0]).toBe(true);
      expect(result.current.isLoading).toBe(false);
    });

    it('should clear stale caches before login', async () => {
      vi.mocked(authAPI.login).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.login('test@example.com', 'password123');
      });

      expect(clearAllCaches).toHaveBeenCalled();
    });

    it('should attempt to restore reading progress after login', async () => {
      vi.mocked(authAPI.login).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.login('test@example.com', 'password123');
      });

      expect(restoreReadingProgress).toHaveBeenCalledWith(mockUser.id);
    });

    it('should handle network error during login', async () => {
      vi.mocked(authAPI.login).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useAuthStore());

      try {
        await act(async () => {
          await result.current.login('test@example.com', 'password');
        });
      } catch {
        // Expected
      }

      expect(result.current.isAuthenticated).toBe(false);
    });

    it('should call authAPI.login with correct credentials', async () => {
      vi.mocked(authAPI.login).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.login('test@example.com', 'password123');
      });

      expect(authAPI.login).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });
  });

  describe('register', () => {
    const mockUser = {
      id: 'new-user-123',
      email: 'new@example.com',
      full_name: 'New User',
      is_active: true,
      is_verified: false,
      is_admin: false,
      created_at: new Date().toISOString(),
    };

    const mockResponse = {
      user: mockUser,
      tokens: {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
      },
      message: 'Registration successful',
    };

    it('should register successfully', async () => {
      vi.mocked(authAPI.register).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.register('new@example.com', 'password123', 'New User');
      });

      expect(result.current.user).toEqual(mockUser);
      expect(result.current.isAuthenticated).toBe(true);
    });

    it('should handle registration error', async () => {
      vi.mocked(authAPI.register).mockRejectedValue(new Error('Email already exists'));

      const { result } = renderHook(() => useAuthStore());

      await expect(
        act(async () => {
          await result.current.register('existing@example.com', 'password');
        })
      ).rejects.toThrow('Email already exists');

      expect(result.current.isAuthenticated).toBe(false);
    });

    it('should persist user data after registration', async () => {
      vi.mocked(authAPI.register).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.register('new@example.com', 'password123', 'New User');
      });

      expect(result.current.user).toEqual(mockUser);
      expect(result.current.isAuthenticated).toBe(true);
    });

    it('should clear caches before registration', async () => {
      vi.mocked(authAPI.register).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.register('new@example.com', 'password123');
      });

      expect(clearAllCaches).toHaveBeenCalled();
    });

    it('should set loading state during registration', async () => {
      const loadingStates: boolean[] = [];
      vi.mocked(authAPI.register).mockImplementation(async () => {
        loadingStates.push(useAuthStore.getState().isLoading);
        return mockResponse;
      });

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.register('new@example.com', 'password123');
      });

      expect(loadingStates[0]).toBe(true);
      expect(result.current.isLoading).toBe(false);
    });

    it('should call authAPI.register with correct data', async () => {
      vi.mocked(authAPI.register).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.register('new@example.com', 'password123', 'New User');
      });

      expect(authAPI.register).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'password123',
        full_name: 'New User',
      });
    });
  });

  describe('logout', () => {
    const loggedInUser = {
      id: '1',
      email: 'test@example.com',
      full_name: 'Test',
      is_active: true,
      is_verified: true,
      is_admin: false,
      created_at: new Date().toISOString(),
    };

    it('should logout and clear state', async () => {
      vi.mocked(authAPI.logout).mockResolvedValue({ message: 'Logged out' });

      useAuthStore.setState({
        user: loggedInUser,
        isAuthenticated: true,
      });

      localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify({ id: '1' }));

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(localStorage.getItem(STORAGE_KEYS.USER_DATA)).toBeFalsy();
    });

    it('should clear all localStorage keys on logout', async () => {
      vi.mocked(authAPI.logout).mockResolvedValue({ message: 'Logged out' });

      useAuthStore.setState({ user: loggedInUser, isAuthenticated: true });
      localStorage.setItem(STORAGE_KEYS.USER_DATA, 'data');
      localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, 'token');
      localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, 'refresh');

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.logout();
      });

      expect(localStorage.getItem(STORAGE_KEYS.USER_DATA)).toBeFalsy();
      expect(localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN)).toBeFalsy();
      expect(localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN)).toBeFalsy();
    });

    it('should backup reading progress before logout', async () => {
      vi.mocked(authAPI.logout).mockResolvedValue({ message: 'Logged out' });

      useAuthStore.setState({ user: loggedInUser, isAuthenticated: true });

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.logout();
      });

      expect(backupReadingProgress).toHaveBeenCalledWith('1');
    });

    it('should clear all caches on logout', async () => {
      vi.mocked(authAPI.logout).mockResolvedValue({ message: 'Logged out' });

      useAuthStore.setState({ user: loggedInUser, isAuthenticated: true });

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.logout();
      });

      expect(clearAllCaches).toHaveBeenCalled();
    });

    it('should broadcast logout to other tabs', async () => {
      vi.mocked(authAPI.logout).mockResolvedValue({ message: 'Logged out' });

      useAuthStore.setState({ user: loggedInUser, isAuthenticated: true });

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.logout();
      });

      expect(tabSync.broadcast).toHaveBeenCalledWith({ type: 'logout' });
    });

    it('should handle logout API failure gracefully', async () => {
      vi.mocked(authAPI.logout).mockRejectedValue(new Error('Network error'));

      useAuthStore.setState({ user: loggedInUser, isAuthenticated: true });

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });

    it('should call authAPI.logout', async () => {
      vi.mocked(authAPI.logout).mockResolvedValue({ message: 'Logged out' });

      useAuthStore.setState({ user: loggedInUser, isAuthenticated: true });

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.logout();
      });

      expect(authAPI.logout).toHaveBeenCalled();
    });
  });

  describe('refreshAccessToken', () => {
    it('should call refresh API', async () => {
      vi.mocked(authAPI.refreshToken).mockResolvedValue(
        undefined as unknown as Awaited<ReturnType<typeof authAPI.refreshToken>>
      );

      useAuthStore.setState({
        user: {
          id: '1',
          email: 'test@example.com',
          full_name: 'Test',
          is_active: true,
          is_verified: true,
          is_admin: false,
          created_at: new Date().toISOString(),
        },
        isAuthenticated: true,
      });

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.refreshAccessToken();
      });

      expect(authAPI.refreshToken).toHaveBeenCalledWith();
    });

    it('should logout on refresh failure', async () => {
      vi.mocked(authAPI.refreshToken).mockRejectedValue(new Error('Token expired'));
      vi.mocked(authAPI.logout).mockResolvedValue({ message: 'Logged out' });

      useAuthStore.setState({
        user: {
          id: '1',
          email: 'test@example.com',
          full_name: 'Test',
          is_active: true,
          is_verified: true,
          is_admin: false,
          created_at: new Date().toISOString(),
        },
        isAuthenticated: true,
      });

      const { result } = renderHook(() => useAuthStore());

      await expect(
        act(async () => {
          await result.current.refreshAccessToken();
        })
      ).rejects.toThrow('Token expired');
    });
  });

  describe('updateUser', () => {
    it('should update user in state', () => {
      const updatedUser = {
        id: '1',
        email: 'updated@example.com',
        full_name: 'Updated User',
        is_active: true,
        is_verified: true,
        is_admin: false,
        created_at: new Date().toISOString(),
      };

      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.updateUser(updatedUser);
      });

      expect(result.current.user).toEqual(updatedUser);
    });
  });

  describe('loadUserFromStorage', () => {
    it('should restore session from API', async () => {
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        full_name: 'Test',
        is_active: true,
        is_verified: true,
        is_admin: false,
        created_at: new Date().toISOString(),
      };

      localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(mockUser));
      vi.mocked(authAPI.getCurrentUser).mockResolvedValue({ user: mockUser });

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.loadUserFromStorage();
      });

      expect(result.current.user).toEqual(mockUser);
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.isLoading).toBe(false);
    });

    it('should clear state when session is invalid', async () => {
      localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify({ id: '1' }));
      vi.mocked(authAPI.getCurrentUser).mockRejectedValue(new Error('Unauthorized'));

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.loadUserFromStorage();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.isLoading).toBe(false);
    });

    it('should set loading state during session check', async () => {
      vi.mocked(authAPI.getCurrentUser).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  user: {
                    id: '1',
                    email: 'test@example.com',
                    full_name: 'Test',
                    is_active: true,
                    is_verified: true,
                    is_admin: false,
                    created_at: new Date().toISOString(),
                  },
                }),
              200
            )
          )
      );

      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.loadUserFromStorage();
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });

      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('persistence', () => {
    it('should support persistence configuration', () => {
      const { result } = renderHook(() => useAuthStore());

      expect(result.current).toBeDefined();
      expect(typeof result.current.login).toBe('function');
      expect(typeof result.current.logout).toBe('function');
      expect(typeof result.current.register).toBe('function');
    });
  });

  describe('checkAuthStatus', () => {
    it('should verify if user is authenticated via state', () => {
      const { result } = renderHook(() => useAuthStore());

      expect(result.current.isAuthenticated).toBe(false);

      act(() => {
        useAuthStore.setState({
          user: {
            id: '1',
            email: 'test@example.com',
            full_name: 'Test',
            is_active: true,
            is_verified: true,
            is_admin: false,
            created_at: new Date().toISOString(),
          },
          isAuthenticated: true,
        });
      });

      expect(result.current.isAuthenticated).toBe(true);
    });
  });
});
