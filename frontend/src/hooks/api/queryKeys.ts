/**
 * Centralized Query Keys для TanStack Query
 *
 * Все query keys для fancai в одном месте.
 * Позволяет легко управлять инвалидацией и предотвращает опечатки.
 *
 * SECURITY: Все keys изолированы по userId для предотвращения утечки данных между пользователями.
 *
 * Паттерн: иерархические массивы с обязательным userId
 * Пример: ['books', userId] -> ['books', userId, bookId] -> ['books', userId, bookId, 'chapters', chapterNumber]
 *
 * @module hooks/api/queryKeys
 */

import { useAuthStore } from '@/stores/auth';

/**
 * Получить ID текущего пользователя или выбросить ошибку
 *
 * @throws {Error} Если пользователь не аутентифицирован
 * @returns {string} ID текущего пользователя
 */
export function getCurrentUserId(): string {
  const user = useAuthStore.getState().user;

  if (!user?.id) {
    throw new Error('User not authenticated - cannot access user-specific data');
  }

  return user.id;
}

/**
 * Query keys для работы с книгами
 *
 * SECURITY: Все keys требуют userId для изоляции данных между пользователями
 */
export const bookKeys = {
  /**
   * Базовый ключ для всех книг конкретного пользователя
   * @param userId - ID пользователя
   */
  all: (userId: string) => ['books', userId] as const,

  /**
   * Список книг с опциональными параметрами
   *
   * @deprecated Используйте listPaginated для стабильных ключей с примитивами
   * @param userId - ID пользователя
   * @param params - Параметры пагинации и сортировки
   */
  list: (userId: string, params?: { skip?: number; limit?: number; sort_by?: string }) =>
    [...bookKeys.all(userId), 'list', params] as const,

  /**
   * Список книг с пагинацией (стабильный ключ с примитивами)
   *
   * ВАЖНО: Использует примитивные значения вместо объекта params
   * для предотвращения ненужных refetch из-за reference equality.
   *
   * @param userId - ID пользователя
   * @param skip - Смещение для пагинации (default: 0)
   * @param limit - Лимит записей (default: 10)
   * @param sortBy - Сортировка (default: undefined)
   */
  listPaginated: (userId: string, skip = 0, limit = 10, sortBy?: string) =>
    [...bookKeys.all(userId), 'list', skip, limit, sortBy ?? 'default'] as const,

  /**
   * Детали конкретной книги
   * @param userId - ID пользователя
   * @param bookId - ID книги
   */
  detail: (userId: string, bookId: string) => [...bookKeys.all(userId), bookId] as const,

  /**
   * Прогресс чтения книги
   * @param userId - ID пользователя
   * @param bookId - ID книги
   */
  progress: (userId: string, bookId: string) =>
    [...bookKeys.all(userId), bookId, 'progress'] as const,

  /**
   * Статус парсинга книги
   * @param userId - ID пользователя
   * @param bookId - ID книги
   */
  parsingStatus: (userId: string, bookId: string) =>
    [...bookKeys.all(userId), bookId, 'parsing-status'] as const,

  /**
   * Статистика пользователя по чтению
   * @param userId - ID пользователя
   */
  statistics: (userId: string) => [...bookKeys.all(userId), 'statistics'] as const,

  /**
   * URL файла книги для EPUB reader
   * @param userId - ID пользователя
   * @param bookId - ID книги
   */
  fileUrl: (userId: string, bookId: string) => [...bookKeys.all(userId), bookId, 'file'] as const,

  /**
   * Книги для HomePage (recently accessed)
   *
   * ВАЖНО: Этот ключ наследует от bookKeys.all(userId), поэтому
   * автоматически инвалидируется при upload/delete книг.
   *
   * @param userId - ID пользователя
   * @param limit - Лимит записей (default: 20)
   */
  homepage: (userId: string, limit = 20) => [...bookKeys.all(userId), 'homepage', limit] as const,
};

/**
 * Query keys для графа сущностей (глоссарий читалки)
 *
 * SECURITY: Все keys требуют userId для изоляции данных между пользователями
 *
 * ВАЖНО: ключ обязан начинаться с собственного префикса, а не с `['book', id]`.
 * Прежний ключ `['book', bookId, 'entities', chapter]` был ПОДключом деталей
 * книги, поэтому любая инвалидация деталей перезапрашивала и граф сущностей —
 * самый дорогой запрос читалки. Инцидент 2026-08-05 («вечное восстановление
 * позиции») держался именно на этом совпадении префиксов.
 */
export const entityKeys = {
  /**
   * Базовый ключ для всех сущностей пользователя
   * @param userId - ID пользователя
   */
  all: (userId: string) => ['entities', userId] as const,

  /**
   * Все сущности конкретной книги
   * @param userId - ID пользователя
   * @param bookId - ID книги
   */
  byBook: (userId: string, bookId: string) => [...entityKeys.all(userId), bookId] as const,

  /**
   * Граф сущностей книги, отфильтрованный по прочитанной главе
   *
   * `currentChapter` входит в ключ: спойлер-фильтрация выполняется на сервере,
   * и ответы для разных глав — разные данные, а не разные представления одних.
   *
   * @param userId - ID пользователя
   * @param bookId - ID книги
   * @param currentChapter - Глава для спойлер-фильтрации; без неё граф полный
   */
  network: (userId: string, bookId: string, currentChapter?: number) =>
    [...entityKeys.byBook(userId, bookId), 'network', currentChapter ?? 'all'] as const,
};

/**
 * Query keys для работы с главами
 *
 * SECURITY: Все keys требуют userId для изоляции данных между пользователями
 */
export const chapterKeys = {
  /**
   * Базовый ключ для всех глав конкретного пользователя
   * @param userId - ID пользователя
   */
  all: (userId: string) => ['chapters', userId] as const,

  /**
   * Главы конкретной книги
   * @param userId - ID пользователя
   * @param bookId - ID книги
   */
  byBook: (userId: string, bookId: string) => [...chapterKeys.all(userId), 'book', bookId] as const,

  /**
   * Конкретная глава
   * @param userId - ID пользователя
   * @param bookId - ID книги
   * @param chapterNumber - Номер главы
   */
  detail: (userId: string, bookId: string, chapterNumber: number) =>
    [...chapterKeys.byBook(userId, bookId), chapterNumber] as const,

  /**
   * Навигация по главам
   * @param userId - ID пользователя
   * @param bookId - ID книги
   * @param chapterNumber - Номер главы
   */
  navigation: (userId: string, bookId: string, chapterNumber: number) =>
    [...chapterKeys.detail(userId, bookId, chapterNumber), 'navigation'] as const,
};

/**
 * Query keys для работы с описаниями
 *
 * SECURITY: Все keys требуют userId для изоляции данных между пользователями
 */
export const descriptionKeys = {
  /**
   * Базовый ключ для всех описаний конкретного пользователя
   * @param userId - ID пользователя
   */
  all: (userId: string) => ['descriptions', userId] as const,

  /**
   * Описания конкретной главы
   * @param userId - ID пользователя
   * @param bookId - ID книги
   * @param chapterNumber - Номер главы
   */
  byChapter: (userId: string, bookId: string, chapterNumber: number) =>
    [...descriptionKeys.all(userId), 'book', bookId, 'chapter', chapterNumber] as const,

  /**
   * Описания книги (все главы)
   * @param userId - ID пользователя
   * @param bookId - ID книги
   */
  byBook: (userId: string, bookId: string) =>
    [...descriptionKeys.all(userId), 'book', bookId] as const,

  /**
   * NLP анализ главы
   * @param userId - ID пользователя
   * @param bookId - ID книги
   * @param chapterNumber - Номер главы
   */
  nlpAnalysis: (userId: string, bookId: string, chapterNumber: number) =>
    [...descriptionKeys.byChapter(userId, bookId, chapterNumber), 'nlp'] as const,
};

/**
 * Query keys для работы с изображениями
 *
 * SECURITY: Все keys требуют userId для изоляции данных между пользователями
 */
export const imageKeys = {
  /**
   * Базовый ключ для всех изображений конкретного пользователя
   * @param userId - ID пользователя
   */
  all: (userId: string) => ['images', userId] as const,

  /**
   * Изображения конкретной книги
   * @param userId - ID пользователя
   * @param bookId - ID книги
   * @param chapterNumber - Опциональный номер главы для фильтрации
   */
  byBook: (userId: string, bookId: string, chapterNumber?: number) =>
    chapterNumber !== undefined
      ? ([...imageKeys.all(userId), 'book', bookId, 'chapter', chapterNumber] as const)
      : ([...imageKeys.all(userId), 'book', bookId] as const),

  /**
   * Изображения книги с пагинацией (стабильный ключ с примитивами)
   *
   * ВАЖНО: Использует примитивные значения вместо объекта pagination
   * для предотвращения ненужных refetch из-за reference equality.
   *
   * @param userId - ID пользователя
   * @param bookId - ID книги
   * @param chapterNumber - Опциональный номер главы для фильтрации
   * @param skip - Смещение для пагинации (default: 0)
   * @param limit - Лимит записей (default: 50)
   */
  byBookPaginated: (userId: string, bookId: string, chapterNumber?: number, skip = 0, limit = 50) =>
    [...imageKeys.byBook(userId, bookId, chapterNumber), 'paginated', skip, limit] as const,

  /**
   * Изображение для конкретного описания
   * @param userId - ID пользователя
   * @param descriptionId - ID описания
   */
  byDescription: (userId: string, descriptionId: string) =>
    [...imageKeys.all(userId), 'description', descriptionId] as const,

  /**
   * Статус генерации изображений
   * @param userId - ID пользователя
   */
  generationStatus: (userId: string) => [...imageKeys.all(userId), 'generation', 'status'] as const,

  /**
   * Статистика пользователя по изображениям
   * @param userId - ID пользователя
   */
  userStats: (userId: string) => [...imageKeys.all(userId), 'user', 'stats'] as const,

  /**
   * Статус async задачи генерации изображения (Celery task polling)
   * Не содержит userId, т.к. taskId уже уникален и привязан к пользователю через Celery.
   * @param taskId - ID задачи Celery
   */
  taskStatus: (taskId: string) => ['images', 'task', taskId] as const,

  /**
   * Админ-статистика по изображениям (не зависит от userId)
   */
  adminStats: () => ['images', 'admin', 'stats'] as const,
};

/**
 * Query keys для закладок и выделений (March 2026)
 *
 * SECURITY: Все keys требуют userId для изоляции данных между пользователями
 */
export const syncKeys = {
  /**
   * Закладки конкретной книги (unified: bookmarks + highlights)
   * @param userId - ID пользователя
   * @param bookId - ID книги
   */
  bookmarks: (userId: string, bookId: string) => ['books', userId, bookId, 'bookmarks'] as const,
};

/**
 * Query keys для reading sessions (January 2026)
 *
 * Управление активными сессиями чтения и их состоянием.
 * SECURITY: Все keys требуют userId для изоляции данных между пользователями
 */
export const sessionKeys = {
  /**
   * Базовый ключ для всех reading sessions конкретного пользователя
   * @param userId - ID пользователя
   */
  all: (userId: string) => ['readingSessions', userId] as const,

  /**
   * Активная сессия чтения (только одна на пользователя)
   * @param userId - ID пользователя
   */
  active: (userId: string) => [...sessionKeys.all(userId), 'active'] as const,

  /**
   * Детали конкретной сессии
   * @param userId - ID пользователя
   * @param sessionId - ID сессии
   */
  detail: (userId: string, sessionId: string) => [...sessionKeys.all(userId), sessionId] as const,

  /**
   * История сессий пользователя
   * @param userId - ID пользователя
   * @param bookId - Опциональная фильтрация по книге
   */
  history: (userId: string, bookId?: string) =>
    bookId
      ? ([...sessionKeys.all(userId), 'history', bookId] as const)
      : ([...sessionKeys.all(userId), 'history'] as const),
};

/**
 * Query keys для PWA функциональности (January 2026)
 *
 * Управление оффлайн-данными, push-уведомлениями и хранилищем.
 * SECURITY: Все keys требуют userId для изоляции данных между пользователями
 */
export const pwaKeys = {
  /**
   * Базовый ключ для всех PWA данных конкретного пользователя
   * @param userId - ID пользователя
   */
  all: (userId: string) => ['pwa', userId] as const,

  /**
   * Информация о хранилище устройства
   * @param userId - ID пользователя
   */
  storage: (userId: string) => [...pwaKeys.all(userId), 'storage'] as const,

  /**
   * Список скачанных книг для оффлайн-доступа
   * @param userId - ID пользователя
   */
  downloads: (userId: string) => [...pwaKeys.all(userId), 'downloads'] as const,

  /**
   * Статус скачивания конкретной книги
   * @param userId - ID пользователя
   * @param bookId - ID книги
   */
  downloadStatus: (userId: string, bookId: string) =>
    [...pwaKeys.downloads(userId), bookId] as const,

  /**
   * Push-подписка пользователя
   * @param userId - ID пользователя
   */
  pushSubscription: (userId: string) => [...pwaKeys.all(userId), 'push-subscription'] as const,

  /**
   * Очередь синхронизации
   * @param userId - ID пользователя
   */
  syncQueue: (userId: string) => [...pwaKeys.all(userId), 'sync-queue'] as const,
};

/**
 * Utility функции для работы с query keys
 *
 * SECURITY: Все функции требуют userId для изоляции данных между пользователями
 */
export const queryKeyUtils = {
  /**
   * Инвалидация всех запросов связанных с книгой
   * @param userId - ID пользователя
   * @param bookId - ID книги
   */
  invalidateBook: (userId: string, bookId: string) => [
    bookKeys.detail(userId, bookId),
    bookKeys.progress(userId, bookId),
    chapterKeys.byBook(userId, bookId),
    descriptionKeys.byBook(userId, bookId),
    imageKeys.byBook(userId, bookId),
  ],

  /**
   * Инвалидация всех запросов связанных с главой
   * @param userId - ID пользователя
   * @param bookId - ID книги
   * @param chapterNumber - Номер главы
   */
  invalidateChapter: (userId: string, bookId: string, chapterNumber: number) => [
    chapterKeys.detail(userId, bookId, chapterNumber),
    descriptionKeys.byChapter(userId, bookId, chapterNumber),
  ],

  /**
   * Инвалидация после загрузки новой книги
   * @param userId - ID пользователя
   */
  invalidateAfterUpload: (userId: string) => [
    bookKeys.all(userId), // Инвалидирует все list queries независимо от пагинации
    bookKeys.statistics(userId),
  ],

  /**
   * Инвалидация после удаления книги
   * @param userId - ID пользователя
   * @param bookId - ID удаленной книги
   */
  invalidateAfterDelete: (userId: string, bookId: string) => [
    bookKeys.all(userId), // Инвалидирует все list queries независимо от пагинации
    bookKeys.detail(userId, bookId),
    bookKeys.statistics(userId),
    chapterKeys.byBook(userId, bookId),
    descriptionKeys.byBook(userId, bookId),
    imageKeys.byBook(userId, bookId),
  ],

  /**
   * Инвалидация после генерации изображения
   * @param userId - ID пользователя
   * @param bookId - ID книги
   * @param descriptionId - ID описания
   */
  invalidateAfterImageGeneration: (userId: string, bookId: string, descriptionId: string) => [
    imageKeys.byBook(userId, bookId),
    imageKeys.byDescription(userId, descriptionId),
    imageKeys.userStats(userId),
  ],
};
