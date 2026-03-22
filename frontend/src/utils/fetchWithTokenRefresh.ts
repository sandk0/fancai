/**
 * Fetch utility with automatic token refresh on 401 errors
 *
 * This utility wraps the native fetch API to handle JWT token expiration
 * by automatically refreshing the token and retrying the request.
 *
 * Use this for image loading and other cases where axios cannot be used
 * (e.g., blob downloads, img tag requests).
 *
 * @module utils/fetchWithTokenRefresh
 */

import { STORAGE_KEYS } from '@/types/state';
import { logger } from '@/lib/logger';

let globalRefreshPromise: Promise<void> | null = null;

/**
 * Refresh the access token via HttpOnly cookie.
 *
 * Sends POST /auth/refresh with `credentials: 'include'` — the refresh_token
 * cookie is attached automatically by the browser. No body is needed.
 * On success the server sets a new access_token cookie in the response.
 *
 * @throws Error if refresh fails (non-2xx) or rate-limited (429)
 */
async function refreshAccessToken(): Promise<void> {
  // Return existing promise if refresh is already in progress (Mutex)
  if (globalRefreshPromise) {
    return globalRefreshPromise;
  }

  globalRefreshPromise = (async () => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';
    const response = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // Cookie-based auth — browser sends refresh_token cookie
    });

    if (!response.ok) {
      // If 429 Too Many Requests, throw specific error to avoid logout
      if (response.status === 429) {
        throw new Error('Rate limit exceeded');
      }
      
      // Clear auth data on permanent refresh failure
      clearAuthData();
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    // Server sets new access_token cookie via Set-Cookie header — nothing to store
  })();

  try {
    return await globalRefreshPromise;
  } finally {
    // Clear promise after completion (success or fail)
    globalRefreshPromise = null;
  }
}

/**
 * Clear all authentication data from storage
 */
function clearAuthData(): void {
  logger.debug('[fetchWithTokenRefresh] Clearing auth data...');
  localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.USER_DATA);

  // Clear Zustand store (async import to avoid circular deps)
  import('@/stores/auth')
    .then(({ useAuthStore }) => {
      useAuthStore.getState().logout();
    })
    .catch((error) => {
      logger.warn('[fetchWithTokenRefresh] Failed to clear auth store:', error);
    });
}

/**
 * Configuration options for fetchWithTokenRefresh
 */
export interface FetchWithTokenRefreshOptions extends Omit<RequestInit, 'headers'> {
  /** Custom headers to merge with the request */
  headers?: Record<string, string>;
  /** Maximum number of retry attempts (default: 1) */
  maxRetries?: number;
}

/**
 * Fetch with automatic token refresh on 401 errors (cookie-based auth).
 *
 * Auth is handled entirely via HttpOnly cookies — the browser sends
 * the `access_token` cookie automatically with `credentials: 'include'`.
 * No Authorization header is set. On 401 the function calls refreshAccessToken()
 * which POSTs to /auth/refresh (also cookie-based), then retries the original request.
 *
 * @param url - The URL to fetch
 * @param options - Fetch options with additional token refresh configuration
 * @returns Promise with the fetch Response
 *
 * @example
 * ```typescript
 * // Basic usage — cookies handle auth automatically
 * const response = await fetchWithTokenRefresh('/api/images/123');
 * const blob = await response.blob();
 *
 * // With custom options
 * const response = await fetchWithTokenRefresh('/api/images/123', {
 *   cache: 'default',
 *   headers: { 'Accept': 'image/*' },
 * });
 * ```
 */
export async function fetchWithTokenRefresh(
  url: string,
  options: FetchWithTokenRefreshOptions = {}
): Promise<Response> {
  const {
    maxRetries = 1,
    headers: customHeaders = {},
    ...fetchOptions
  } = options;

  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      const response = await fetch(url, {
        ...fetchOptions,
        headers: { ...customHeaders },
        credentials: 'include', // Cookie-based auth — browser sends access_token cookie
      });

      // If 401 and we haven't exhausted retries, try to refresh token
      if (response.status === 401 && retryCount < maxRetries) {
        logger.debug('[fetchWithTokenRefresh] 401 received, attempting token refresh...');

        try {
          await refreshAccessToken();
          logger.debug('[fetchWithTokenRefresh] Token refreshed successfully, retrying request...');
          retryCount++;
          continue; // Retry — cookies already updated by server
        } catch (refreshError: unknown) {
          logger.warn('[fetchWithTokenRefresh] Token refresh failed:', refreshError);

          // Don't logout on Rate Limit or Network Error
          const isErrorInstance = refreshError instanceof Error;
          if (isErrorInstance && (refreshError.message === 'Rate limit exceeded' || refreshError.name === 'TypeError')) {
             throw refreshError;
          }

          // Only redirect if not already on login page
          if (!window.location.pathname.includes('/login')) {
            window.location.href = '/login';
          }

          throw new Error('Authentication failed');
        }
      }

      return response;
    } catch (error) {
      // Network errors - don't retry token refresh for these
      if (error instanceof TypeError && error.message.includes('fetch')) {
        logger.warn('[fetchWithTokenRefresh] Network error:', error);
        throw error;
      }

      // Re-throw authentication errors
      if (error instanceof Error && error.message === 'Authentication failed') {
        throw error;
      }

      // For other errors, throw them
      throw error;
    }
  }

  // This should not be reached, but TypeScript needs it
  throw new Error('Max retries exceeded');
}

/**
 * Fetch an image as a Blob URL with token refresh support
 *
 * Convenience function for loading images that require authentication.
 * Returns a blob URL that can be used in img.src.
 *
 * @param url - The image URL to fetch
 * @returns Promise with the blob URL, or null if fetch failed
 *
 * @example
 * ```typescript
 * const blobUrl = await fetchImageWithAuth('/api/images/123/file');
 * if (blobUrl) {
 *   img.src = blobUrl;
 *   // Remember to call URL.revokeObjectURL(blobUrl) when done!
 * }
 * ```
 */
export async function fetchImageWithAuth(url: string): Promise<string | null> {
  try {
    // Skip if already a blob or data URL
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      return url;
    }

    const response = await fetchWithTokenRefresh(url, {
      cache: 'default',
    });

    if (!response.ok) {
      logger.warn('[fetchImageWithAuth] Failed to fetch image:', response.status);
      return null;
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    logger.warn('[fetchImageWithAuth] Error fetching image:', error);
    return null;
  }
}

/**
 * Download a file with token refresh support
 *
 * Fetches a file with authentication and triggers a download.
 *
 * @param url - The file URL to download
 * @param filename - The filename to save as
 * @returns Promise that resolves when download is triggered
 * @throws Error if fetch fails
 *
 * @example
 * ```typescript
 * await downloadWithAuth('/api/images/123/file', 'image.jpg');
 * ```
 */
export async function downloadWithAuth(url: string, filename: string): Promise<void> {
  const response = await fetchWithTokenRefresh(url, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(blobUrl);
}

export default fetchWithTokenRefresh;
