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

    it('should save user data to localStorage', async () => {
      vi.mocked(authAPI.login).mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.login('test@example.com', 'password123');
      });

      const savedUser = localStorage.getItem(STORAGE_KEYS.USER_DATA);
      expect(savedUser).toBeTruthy();
      expect(JSON.parse(savedUser!)).toEqual(mockUser);
    });

    it('should handle login error', async () => {
      vi.mocked(authAPI.login).mockRejectedValue(new Error('Invalid credentials'));

      const { result } = renderHook(() => useAuthStore());

      await expect(
        act(async () => {
          await result.current.login('wrong@example.com', 'wrongpassword');
        })
      ).rejects.toThrow('Invalid credentials');

      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });

    it('should set loading state during login', async () => {
      vi.mocked(authAPI.login).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(mockResponse), 100))
      );

      const { result } = renderHook(() => useAuthStore());

      act(() => {
        result.current.login('test@example.com', 'password');
      });

      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(150);
        await Promise.resolve();
      });

      expect(result.current.isLoading).toBe(false);
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
  });

  describe('logout', () => {
    it('should logout and clear state', async () => {
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

      localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify({ id: '1' }));

      const { result } = renderHook(() => useAuthStore());

      await act(async () => {
        await result.current.logout();
      });

      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(localStorage.getItem(STORAGE_KEYS.USER_DATA)).toBeNull();
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
    it('should verify if user is authenticated', () => {
      const { result } = renderHook(() => useAuthStore());

      expect(result.current.isAuthenticated).toBe(false);

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

      expect(result.current.isAuthenticated).toBe(true);
    });
  });
});
