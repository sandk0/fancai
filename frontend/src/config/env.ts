import { logger } from '@/lib/logger';
/**
 * Environment Configuration для fancai Frontend
 *
 * Централизованное управление environment variables с валидацией.
 * Проверяет наличие обязательных переменных при build/runtime.
 *
 * @module config/env
 */

/**
 * Обязательные environment variables
 * Build завершится с ошибкой если они не определены
 */
const requiredEnvVars = [
  'VITE_API_BASE_URL',
] as const;

/**
 * Опциональные environment variables с default значениями
 * (Defined for documentation purposes - defaults are handled inline)
 */
// const optionalEnvVars = [
//   'VITE_WS_URL',
//   'VITE_APP_NAME',
//   'VITE_APP_VERSION',
//   'VITE_ENVIRONMENT',
//   'VITE_ENABLE_ANALYTICS',
//   'VITE_ENABLE_ERROR_REPORTING',
//   'VITE_DEBUG',
//   'VITE_SHOW_DEV_TOOLS',
//   'VITE_SENTRY_DSN',
//   'VITE_SENTRY_ENABLED',
// ] as const;

/**
 * Validate required environment variables
 * Throws error if any required variable is missing
 */
function validateRequiredEnvVars(): void {
  const missingVars: string[] = [];

  requiredEnvVars.forEach((varName) => {
    if (!import.meta.env[varName]) {
      missingVars.push(varName);
    }
  });

  if (missingVars.length > 0) {
    const errorMessage = `
╔═══════════════════════════════════════════════════════════╗
║  MISSING REQUIRED ENVIRONMENT VARIABLES                   ║
╠═══════════════════════════════════════════════════════════╣
║  The following environment variables are required but     ║
║  not defined:                                             ║
║                                                           ║
${missingVars.map(v => `║  - ${v.padEnd(55)} ║`).join('\n')}
║                                                           ║
║  Please create .env file from .env.production example:   ║
║  cp .env.production .env                                  ║
║  Then edit .env with your configuration values.          ║
╚═══════════════════════════════════════════════════════════╝
    `.trim();

    throw new Error(errorMessage);
  }
}

/**
 * Parse boolean environment variable
 */
function parseBool(value: string | undefined, defaultValue = false): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parse integer environment variable
 */
function parseInt(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

// Validate required variables on module load
validateRequiredEnvVars();

/**
 * Application Environment Configuration
 *
 * Type-safe, validated configuration object for the entire app.
 * Use this instead of directly accessing import.meta.env.
 */
export const config = {
  // API Configuration
  api: {
    baseUrl: import.meta.env.VITE_API_BASE_URL as string,
    timeout: parseInt(import.meta.env.VITE_API_TIMEOUT, 30000),
  },

  // WebSocket Configuration
  websocket: {
    url: import.meta.env.VITE_WS_URL || import.meta.env.VITE_API_BASE_URL?.replace(/^http/, 'ws') + '/ws',
  },

  // Application Info
  app: {
    name: import.meta.env.VITE_APP_NAME || 'fancai',
    version: import.meta.env.VITE_APP_VERSION || '1.0.0',
    environment: import.meta.env.VITE_ENVIRONMENT || (import.meta.env.PROD ? 'production' : 'development'),
  },

  // Feature Flags
  features: {
    analytics: parseBool(import.meta.env.VITE_ENABLE_ANALYTICS, false),
    errorReporting: parseBool(import.meta.env.VITE_ENABLE_ERROR_REPORTING, false),
    pwa: parseBool(import.meta.env.VITE_ENABLE_PWA, true),
  },

  // Error Tracking (Sentry)
  sentry: {
    dsn: import.meta.env.VITE_SENTRY_DSN || '',
    enabled: parseBool(import.meta.env.VITE_SENTRY_ENABLED, false),
  },

  // Analytics (Google Analytics)
  analytics: {
    trackingId: import.meta.env.VITE_GA_TRACKING_ID || '',
    enabled: parseBool(import.meta.env.VITE_GA_ENABLED, false),
  },

  // CDN Configuration
  cdn: {
    imageUrl: import.meta.env.VITE_IMAGE_CDN_URL || '',
  },

  // EPUB Reader Settings
  epub: {
    defaultFontSize: parseInt(import.meta.env.VITE_EPUB_DEFAULT_FONT_SIZE, 16),
    defaultTheme: (import.meta.env.VITE_EPUB_DEFAULT_THEME as 'light' | 'dark') || 'light',
    enableOffline: parseBool(import.meta.env.VITE_EPUB_ENABLE_OFFLINE, true),
  },

  // File Upload Limits
  upload: {
    maxUploadSizeMB: parseInt(import.meta.env.VITE_MAX_UPLOAD_SIZE_MB, 50),
    maxImageSizeMB: parseInt(import.meta.env.VITE_MAX_IMAGE_SIZE_MB, 10),
  },

  // Cache Settings
  cache: {
    enabled: parseBool(import.meta.env.VITE_CACHE_ENABLED, true),
    ttl: parseInt(import.meta.env.VITE_CACHE_TTL, 3600),
  },

  // Environment Detection
  env: {
    isDevelopment: import.meta.env.DEV,
    isProduction: import.meta.env.PROD,
    mode: import.meta.env.MODE,
  },

  // Debugging & Development Tools
  debug: {
    enabled: parseBool(import.meta.env.VITE_DEBUG, false),
    showDevTools: parseBool(import.meta.env.VITE_SHOW_DEV_TOOLS, import.meta.env.DEV),
    logLevel: import.meta.env.VITE_LOG_LEVEL || (import.meta.env.PROD ? 'error' : 'debug'),
  },

  // Build Info (for diagnostics)
  build: {
    time: import.meta.env.VITE_BUILD_TIME || '',
    gitCommit: import.meta.env.VITE_GIT_COMMIT || '',
  },
} as const;

/**
 * Type for application configuration
 * @example
 * ```typescript
 * import { config, type AppConfig } from '@/config/env';
 *
 * function useApiUrl(): string {
 *   return config.api.baseUrl;
 * }
 * ```
 */
export type AppConfig = typeof config;

/**
 * Development helper: Log configuration on startup (development only)
 */
if (config.env.isDevelopment && config.debug.enabled) {
  console.group('🔧 Environment Configuration');
  logger.debug('Environment:', config.app.environment);
  logger.debug('API Base URL:', config.api.baseUrl);
  logger.debug('WebSocket URL:', config.websocket.url);
  logger.debug('Features:', config.features);
  logger.debug('Debug Mode:', config.debug.enabled);
  console.groupEnd();
}

/**
 * Production warning if debug mode is enabled
 */
if (config.env.isProduction && config.debug.enabled) {
  logger.warn(
    '⚠️  WARNING: Debug mode is enabled in production! ' +
    'Set VITE_DEBUG=false in .env.production'
  );
}

/**
 * Export individual config sections for convenience
 */
export const { api, websocket, app, features, sentry, analytics, cdn, epub, upload, cache, env, debug, build } = config;

/**
 * Default export
 */
export default config;
