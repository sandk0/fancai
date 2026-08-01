// API Client for fancai

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { STORAGE_KEYS } from '@/types/state';
import type { ApiError } from '@/types/api';
import { logger } from '@/lib/logger';

class ApiClient {
  public client: AxiosInstance;
  private refreshPromise: Promise<string> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
      timeout: 120000, // 2 minutes for LLM description extraction
      withCredentials: true, // Send HttpOnly cookies
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor: auth token + FormData handling
    this.client.interceptors.request.use(
      (config) => {
        if (import.meta.env.DEV) {
          logger.debug(
            `🌐 [AXIOS] Outgoing ${config.method?.toUpperCase()} request to ${config.url}`
          );
        }

        // КРИТИЧЕСКИ ВАЖНО: Если data это FormData, удаляем Content-Type
        // чтобы браузер сам установил multipart/form-data с boundary
        if (config.data instanceof FormData) {
          if (import.meta.env.DEV)
            logger.debug('🌐 [AXIOS] Detected FormData, removing Content-Type header');
          if (config.headers) {
            delete config.headers['Content-Type'];
          }
        }

        // No longer adding Authorization header manually - using HttpOnly cookies
        return config;
      },
      (error) => {
        logger.error('🌐 [AXIOS] Request interceptor error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for token refresh
    this.client.interceptors.response.use(
      (response) => {
        if (import.meta.env.DEV)
          logger.debug(`🌐 [AXIOS] Response received for ${response.config.url}:`, response.status);
        return response;
      },
      async (error) => {
        const originalRequest = error.config;

        // If config is missing (e.g. cancelled request), skip processing
        if (!originalRequest) {
          return Promise.reject(error);
        }

        // Skip logging for 401s that we're about to retry (reduces noise)
        if (error.response?.status !== 401 || originalRequest._retry) {
          logger.error('🌐 [AXIOS] Response error:', {
            url: originalRequest.url,
            status: error.response?.status,
            message: error.message,
          });
        }

        // Skip token refresh for auth endpoints - they handle their own auth
        const isAuthEndpoint = originalRequest.url?.includes('/auth/');
        // Skip refresh for metrics/health endpoints to prevent loops
        const isIgnoredEndpoint =
          originalRequest.url?.includes('/metrics') || originalRequest.url?.includes('/health');

        if (
          error.response?.status === 401 &&
          !originalRequest._retry &&
          !isAuthEndpoint &&
          !isIgnoredEndpoint
        ) {
          if (import.meta.env.DEV)
            logger.debug('🌐 [AXIOS] 401 error, attempting token refresh...');
          originalRequest._retry = true;

          try {
            await this.refreshToken();
            if (import.meta.env.DEV)
              logger.debug('🌐 [AXIOS] Token refreshed, retrying request...');
            return this.client(originalRequest);
          } catch (refreshError: unknown) {
            // Refresh failed

            // Don't logout on 429 (Rate Limit) or Network Error
            // Just fail the request and let the user try again later
            const isAxios = this.isAxiosError(refreshError);
            const status = isAxios ? refreshError.response?.status : undefined;
            if (status === 429 || (isAxios && refreshError.code === 'ERR_NETWORK')) {
              logger.warn('🔄 Token refresh failed (temporary):', status || 'Network Error');
              return Promise.reject(refreshError);
            }

            logger.warn('🔄 Token refresh failed (permanent):', refreshError);
            this.clearAuthData();

            // Only redirect to login if not already on login page
            if (!window.location.pathname.includes('/login')) {
              window.location.href = '/login';
            }

            return Promise.reject(refreshError);
          }
        }

        return Promise.reject(this.handleError(error));
      }
    );
  }

  private async refreshToken(): Promise<string> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Call refresh endpoint - cookie will be sent automatically
    this.refreshPromise = this.client
      .post('/auth/refresh')
      .then(() => {
        // Cookie updated successfully
        return 'refreshed';
      })
      .catch((error) => {
        this.refreshPromise = null;
        throw error;
      })
      .finally(() => {
        // Keep promise for a bit to prevent stampede?
        // Actually we should clear it immediately or shortly after
        setTimeout(() => {
          this.refreshPromise = null;
        }, 1000);
      });

    return this.refreshPromise;
  }

  private clearAuthData() {
    logger.debug('🧹 Clearing auth data...');
    // Clear legacy tokens if any
    localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER_DATA);

    // Call logout endpoint to clear cookies
    this.client.post('/auth/logout').catch(() => {});

    // Also clear Zustand store (async import)
    import('@/stores/auth')
      .then(({ useAuthStore }) => {
        useAuthStore.getState().logout();
      })
      .catch((error) => {
        logger.warn('Failed to clear auth store:', error);
      });
  }

  private handleError(error: unknown): ApiError {
    if (this.isAxiosError(error)) {
      if (error.response) {
        // Server responded with error
        const responseData = error.response.data as Record<string, unknown> | undefined;
        return {
          error: (responseData?.error as string) || 'Server Error',
          message:
            (responseData?.detail as string) ||
            (responseData?.message as string) ||
            'An error occurred',
          details: responseData,
          timestamp: new Date().toISOString(),
        };
      } else if (error.request) {
        // Network error
        return {
          error: 'Network Error',
          message: 'Unable to connect to server. Please check your internet connection.',
          timestamp: new Date().toISOString(),
        };
      }
    }

    // Other error
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
    return {
      error: 'Client Error',
      message: errorMessage,
      timestamp: new Date().toISOString(),
    };
  }

  private isAxiosError(error: unknown): error is AxiosError {
    return error !== null && typeof error === 'object' && 'isAxiosError' in error;
  }

  // Generic request methods
  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    // Cache-busting: только Cache-Control. Pragma и Expires — legacy-заголовки
    // ответа, в запросе они ничего не добавляют, но выводят GET за пределы
    // CORS allow_headers бэкенда, из-за чего в dev-режиме (5173 → 8000) любой
    // GET падал с net::ERR_FAILED на preflight.
    const response: AxiosResponse<T> = await this.client.get(url, {
      ...config,
      headers: {
        ...config?.headers,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
    return response.data;
  }

  async post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.post(url, data, config);
    return response.data;
  }

  async put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.put(url, data, config);
    return response.data;
  }

  async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response: AxiosResponse<T> = await this.client.delete(url, config);
    return response.data;
  }

  // Upload file with progress
  async upload<T = unknown>(
    url: string,
    file: File,
    onUploadProgress?: (progressEvent: { loaded: number; total?: number }) => void
  ): Promise<T> {
    const formData = new FormData();
    formData.append('file', file);

    const response: AxiosResponse<T> = await this.client.post(url, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress,
    });

    return response.data;
  }

  // Download file
  async download(url: string, filename?: string): Promise<Blob> {
    const response = await this.client.get(url, {
      responseType: 'blob',
    });

    // Create download link if filename provided
    if (filename) {
      const blob = response.data;
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    }

    return response.data;
  }

  // Health check
  async healthCheck(): Promise<{ status: string; version: string }> {
    return this.get('/health');
  }

  // Get API info
  async getApiInfo(): Promise<{
    name: string;
    version: string;
    description?: string;
    environment?: string;
  }> {
    return this.get('/info');
  }
}

// Create singleton instance
export const apiClient = new ApiClient();

// Export for direct usage
export default apiClient;
