/**
 * Политика обновления токена в перехватчике `client.ts`.
 *
 * Регрессия, ради которой файл существует: `refreshToken()` ходил через
 * `this.client`, и ошибка самого `/auth/refresh` проходила через
 * `handleError`, теряя статус. Внешний catch не опознавал в результате
 * AxiosError, считал отказ ПОСТОЯННЫМ и чистил сессию — даже на 429
 * от лимитера, хотя комментарий рядом обещает обратное.
 *
 * Тест перехватывает HTTP на уровне адаптера axios, поэтому проверяется
 * вся цепочка перехватчика, а не отдельная функция.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { STORAGE_KEYS } from '@/types/state';

/** Ответы, которые адаптер отдаёт по подстроке в URL. */
type Route = { status: number; data?: unknown };
let routes: Record<string, Route> = {};
const seen: string[] = [];

const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  const url = `${config.baseURL ?? ''}${config.url ?? ''}`;
  seen.push(url);
  const key = Object.keys(routes).find((k) => url.includes(k));
  const route = key ? routes[key] : { status: 200, data: {} };
  const response = {
    data: route.data ?? {},
    status: route.status,
    statusText: String(route.status),
    headers: {},
    config,
  };
  if (route.status >= 400) {
    throw new AxiosError('req failed', String(route.status), config, {}, response as never);
  }
  return response as never;
};

const realCreate = axios.create.bind(axios);
vi.spyOn(axios, 'create').mockImplementation((cfg) => realCreate({ ...cfg, adapter }));

// Импорт после подмены: клиент создаёт инстансы в конструкторе.
const { apiClient } = await import('../client');

describe('refresh policy', () => {
  beforeEach(() => {
    routes = {};
    seen.length = 0;
    vi.mocked(localStorage.removeItem).mockClear();
  });

  // Проверяем ВЫЗОВ очистки, а не содержимое хранилища: `src/test/setup.ts`
  // подменяет localStorage пустыми `vi.fn()`, и `getItem` там всегда
  // возвращает undefined — любая проверка значения была бы недостоверной.
  const cleared = () =>
    vi.mocked(localStorage.removeItem).mock.calls.some(
      ([key]) => key === STORAGE_KEYS.USER_DATA
    );

  it('keeps the session when refresh is rate limited', async () => {
    routes = { '/auth/me': { status: 401 }, '/auth/refresh': { status: 429 } };

    await expect(apiClient.get('/auth/me')).rejects.toBeDefined();

    expect(seen.some((u) => u.includes('/auth/refresh'))).toBe(true);
    expect(cleared(), 'временный отказ обновления не должен чистить сессию').toBe(false);
  });

  it('clears the session when refresh is genuinely rejected', async () => {
    routes = { '/auth/me': { status: 401 }, '/auth/refresh': { status: 401 } };

    await expect(apiClient.get('/auth/me')).rejects.toBeDefined();

    expect(cleared(), 'настоящий отказ обязан снять сессию').toBe(true);
  });

  it('does not try to refresh on the login endpoint', async () => {
    routes = { '/auth/login': { status: 401 } };

    await expect(apiClient.post('/auth/login', {})).rejects.toBeDefined();

    expect(seen.some((u) => u.includes('/auth/refresh'))).toBe(false);
  });
});
