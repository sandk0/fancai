/**
 * Hawk Tracker — мониторинг ошибок для React-фронтенда.
 *
 * Интеграция с hawk-tracker.ru для отслеживания JavaScript-ошибок.
 * При отсутствии VITE_HAWK_TOKEN инициализация пропускается (graceful skip).
 */

import HawkCatcher from '@hawk.so/javascript';

let hawk: HawkCatcher | null = null;

/**
 * Инициализация Hawk Tracker для React-приложения.
 * Вызывается один раз при запуске приложения в main.tsx.
 */
export function initHawk(): void {
  // VITE_HAWK_TOKEN is embedded in the build bundle.
  // This is acceptable: it's a write-only error reporting token, not a secret.
  // If abuse becomes an issue, proxy error reports through backend.
  const token = import.meta.env.VITE_HAWK_TOKEN;
  if (!token) {
    console.info('Hawk Tracker отключен (VITE_HAWK_TOKEN не установлен)');
    return;
  }
  hawk = new HawkCatcher({
    token,
    release: import.meta.env.VITE_APP_VERSION || 'dev',
  });
}

/**
 * Получить экземпляр Hawk Tracker для ручной отправки ошибок.
 * Возвращает null если Hawk не инициализирован (токен не задан).
 */
export function getHawk(): HawkCatcher | null {
  return hawk;
}
