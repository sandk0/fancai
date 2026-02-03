// Health Check API methods

import { apiClient } from './client';

/**
 * Component health status
 */
interface ComponentHealthResponse {
  status: 'ok' | 'warning' | 'error';
  message?: string | null;
  latency_ms?: number | null;
  details?: Record<string, unknown> | null;
}

/**
 * Basic health check response
 */
interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime_seconds: number;
}

/**
 * Reading sessions health check response
 */
interface ReadingSessionsHealthResponse {
  status: string;
  timestamp: string;
  checks: Record<string, ComponentHealthResponse>;
  metrics: Record<string, unknown>;
}

/**
 * Deep health check response
 */
interface DeepHealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime_seconds: number;
  components: Record<string, ComponentHealthResponse>;
}

export const healthAPI = {
  /**
   * Basic health check endpoint.
   * Fast check to verify the application is running.
   * 
   * @returns Basic health status
   */
  async getHealth(): Promise<HealthCheckResponse> {
    return apiClient.get('/health');
  },

  /**
   * Detailed health check for reading sessions system.
   * Checks database, Redis, and reading session metrics.
   * 
   * @returns Reading sessions health status
   */
  async getReadingSessionsHealth(): Promise<ReadingSessionsHealthResponse> {
    return apiClient.get('/health/reading-sessions');
  },

  /**
   * Deep health check of all systems.
   * Comprehensive check of database, Redis, Celery, and all components.
   * 
   * @returns Deep health status
   */
  async getDeepHealth(): Promise<DeepHealthCheckResponse> {
    return apiClient.get('/health/deep');
  },

  /**
   * Get Prometheus metrics endpoint.
   * Returns metrics in Prometheus text format.
   * 
   * @returns Prometheus metrics as text
   */
  async getMetrics(): Promise<string> {
    const response = await apiClient.client.get('/metrics', {
      responseType: 'text',
    });
    return response.data;
  },
};
