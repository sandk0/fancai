/**
 * Проверка сессии не должна разлогинивать на временных сбоях.
 *
 * Регрессия, ради которой файл существует: `loadUserFromStorage` очищал
 * состояние на ЛЮБУЮ ошибку `/auth/me`, а перехватчик `client.ts`
 * оборачивает всё в `ApiError` без статуса. Поэтому 429 от лимитера
 * и обрыв сети выглядели как «сессия истекла»: cookie оставались живыми,
 * а `AuthGuard` уводил пользователя на /login.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiError } from '@/types/api';

const getCurrentUser = vi.fn();
vi.mock('@/api/auth', () => ({
  authAPI: {
    getCurrentUser: () => getCurrentUser(),
  },
}));

import { useAuthStore } from '../auth';

const failWith = (status?: number): ApiError => ({
  error: 'e',
  message: 'm',
  timestamp: new Date().toISOString(),
  ...(status === undefined ? {} : { status }),
});

describe('loadUserFromStorage', () => {
  beforeEach(() => {
    getCurrentUser.mockReset();
    useAuthStore.setState({
      user: { id: 'u1', email: 'a@b.c' } as never,
      isAuthenticated: true,
      isLoading: false,
    });
  });

  it.each([429, 503, undefined])('keeps the session when the check fails with %s', async (s) => {
    getCurrentUser.mockRejectedValue(failWith(s));

    await useAuthStore.getState().loadUserFromStorage();

    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user).not.toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it.each([401, 403])('clears the session on a proven %s', async (s) => {
    getCurrentUser.mockRejectedValue(failWith(s));

    await useAuthStore.getState().loadUserFromStorage();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });
});
