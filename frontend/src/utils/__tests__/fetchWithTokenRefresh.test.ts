/**
 * Tests for fetchWithTokenRefresh — cookie-based auth flow.
 *
 * After M002 migration to HttpOnly cookies:
 * - No Authorization header is set
 * - No localStorage reads for AUTH_TOKEN / REFRESH_TOKEN
 * - All requests use credentials: 'include'
 * - Token refresh POSTs to /auth/refresh with credentials: 'include', no body
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';

// Mock logger before importing module under test
vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock auth store (used by clearAuthData)
vi.mock('@/stores/auth', () => ({
  useAuthStore: {
    getState: () => ({
      logout: vi.fn(),
    }),
  },
}));

import { fetchWithTokenRefresh } from '../fetchWithTokenRefresh';

// Helper to create a mock Response
function mockResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 401 ? 'Unauthorized' : `Error ${status}`,
    headers: new Headers(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    blob: () => Promise.resolve(new Blob()),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    clone: () => mockResponse(status, body),
    body: null,
    bodyUsed: false,
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    formData: () => Promise.resolve(new FormData()),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

describe('fetchWithTokenRefresh', () => {
  let fetchMock: Mock;
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock fetch
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    // Mock localStorage (defensive removeItem in clearAuthData)
    vi.spyOn(Storage.prototype, 'removeItem');

    // Mock window.location for redirect checks
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, pathname: '/library', href: '/library' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  describe('happy path — cookie-based auth', () => {
    it('sends request with credentials: "include" and no Authorization header', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { data: 'ok' }));

      const response = await fetchWithTokenRefresh('/api/test');

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/test');
      expect(options.credentials).toBe('include');
      // No Authorization header
      expect(options.headers).toBeDefined();
      expect(options.headers['Authorization']).toBeUndefined();
    });

    it('passes custom headers without adding Authorization', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200));

      await fetchWithTokenRefresh('/api/test', {
        headers: { 'Accept': 'image/*', 'X-Custom': 'value' },
      });

      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers['Accept']).toBe('image/*');
      expect(options.headers['X-Custom']).toBe('value');
      expect(options.headers['Authorization']).toBeUndefined();
    });

    it('forwards fetch options (method, cache, signal) correctly', async () => {
      const controller = new AbortController();
      fetchMock.mockResolvedValueOnce(mockResponse(200));

      await fetchWithTokenRefresh('/api/test', {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
      });

      const [, options] = fetchMock.mock.calls[0];
      expect(options.method).toBe('POST');
      expect(options.cache).toBe('no-store');
      expect(options.signal).toBe(controller.signal);
      expect(options.credentials).toBe('include');
    });
  });

  describe('401 → refresh → retry', () => {
    it('refreshes token and retries on 401', async () => {
      // First call: 401 (original request)
      // Second call: 200 (refresh endpoint)
      // Third call: 200 (retried original request)
      fetchMock
        .mockResolvedValueOnce(mockResponse(401))
        .mockResolvedValueOnce(mockResponse(200)) // refresh
        .mockResolvedValueOnce(mockResponse(200, { data: 'success' }));

      const response = await fetchWithTokenRefresh('/api/test');

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Verify refresh call
      const [refreshUrl, refreshOptions] = fetchMock.mock.calls[1];
      expect(refreshUrl).toContain('/auth/refresh');
      expect(refreshOptions.method).toBe('POST');
      expect(refreshOptions.credentials).toBe('include');
      // No body — cookie-based refresh
      expect(refreshOptions.body).toBeUndefined();
      expect(refreshOptions.headers).toBeUndefined();

      // Verify retry call has credentials: 'include'
      const [retryUrl, retryOptions] = fetchMock.mock.calls[2];
      expect(retryUrl).toBe('/api/test');
      expect(retryOptions.credentials).toBe('include');
      expect(retryOptions.headers['Authorization']).toBeUndefined();
    });

    it('does not retry more than maxRetries times', async () => {
      fetchMock
        .mockResolvedValueOnce(mockResponse(401))
        .mockResolvedValueOnce(mockResponse(200)) // refresh succeeds
        .mockResolvedValueOnce(mockResponse(401)); // retry still 401

      const response = await fetchWithTokenRefresh('/api/test', { maxRetries: 1 });

      // Second 401 is returned (no more retries)
      expect(response.status).toBe(401);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('refresh failure → clearAuthData + redirect', () => {
    it('clears auth data and redirects to /login on refresh failure', async () => {
      // First call: 401 (original request)
      // Second call: 401 (refresh endpoint — permanent failure)
      fetchMock
        .mockResolvedValueOnce(mockResponse(401))
        .mockResolvedValueOnce(mockResponse(401)); // refresh fails

      await expect(fetchWithTokenRefresh('/api/test')).rejects.toThrow('Authentication failed');

      // clearAuthData should have been called (defensive localStorage cleanup)
      expect(localStorage.removeItem).toHaveBeenCalled();

      // Should redirect to /login
      expect(window.location.href).toBe('/login');
    });

    it('does not redirect if already on login page', async () => {
      window.location.pathname = '/login';
      window.location.href = '/login';

      fetchMock
        .mockResolvedValueOnce(mockResponse(401))
        .mockResolvedValueOnce(mockResponse(401)); // refresh fails

      await expect(fetchWithTokenRefresh('/api/test')).rejects.toThrow('Authentication failed');

      // Should NOT change href since already on /login
      expect(window.location.href).toBe('/login');
    });
  });

  describe('rate limit (429) → no logout', () => {
    it('throws rate limit error without clearing auth data or redirecting', async () => {
      // First call: 401 (original request)
      // Second call: 429 (refresh rate-limited)
      fetchMock
        .mockResolvedValueOnce(mockResponse(401))
        .mockResolvedValueOnce(mockResponse(429)); // refresh rate-limited

      await expect(fetchWithTokenRefresh('/api/test')).rejects.toThrow('Rate limit exceeded');

      // Should NOT redirect — rate limiting is transient
      expect(window.location.href).not.toBe('/login');
      // Should NOT clear auth data
      expect(localStorage.removeItem).not.toHaveBeenCalled();
    });
  });

  describe('network errors', () => {
    it('throws network error without attempting refresh', async () => {
      const networkError = new TypeError('Failed to fetch');
      fetchMock.mockRejectedValueOnce(networkError);

      await expect(fetchWithTokenRefresh('/api/test')).rejects.toThrow('Failed to fetch');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('refresh mutex (deduplication)', () => {
    it('deduplicates concurrent refresh calls', async () => {
      // Both requests get 401, trigger refresh simultaneously
      fetchMock
        .mockResolvedValueOnce(mockResponse(401)) // req 1
        .mockResolvedValueOnce(mockResponse(401)) // req 2
        .mockResolvedValueOnce(mockResponse(200)) // single refresh
        .mockResolvedValueOnce(mockResponse(200, { a: 1 })) // retry req 1
        .mockResolvedValueOnce(mockResponse(200, { b: 2 })); // retry req 2

      const [res1, res2] = await Promise.all([
        fetchWithTokenRefresh('/api/test1'),
        fetchWithTokenRefresh('/api/test2'),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Only ONE refresh call should have been made (mutex dedup)
      const refreshCalls = fetchMock.mock.calls.filter(
        ([url]) => typeof url === 'string' && url.includes('/auth/refresh')
      );
      expect(refreshCalls.length).toBe(1);
    });
  });
});
