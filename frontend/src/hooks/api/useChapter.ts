/**
 * React Query хуки для работы с главами книг
 *
 * Интеграция с Dexie.js для offline-first кэширования глав.
 *
 * Особенности:
 * - Offline-first: сначала IndexedDB, потом сервер
 * - Двухуровневый кэш: React Query (memory) + Dexie/IndexedDB (persistent)
 * - Фоновое обновление при наличии сети
 * - Prefetching соседних глав
 * - Автоматическая инвалидация при обновлении книги
 *
 * @module hooks/api/useChapter
 */

import React from 'react';
import {
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { booksAPI } from '@/api/books';
import { chapterCache } from '@/services/chapterCache';
import {
  db,
  createChapterId,
  type CachedChapter,
  type CachedDescription,
} from '@/services/db';
import { isOnline } from '@/hooks/useOnlineStatus';
import { chapterKeys, descriptionKeys, getCurrentUserId } from './queryKeys';
import type { Chapter, Description } from '@/types/api';
import { logger } from '@/lib/logger';

/**
 * Response типа для главы с навигацией
 */
interface ChapterResponse {
  chapter: Chapter;
  descriptions?: Description[];
  navigation: {
    has_previous: boolean;
    has_next: boolean;
    previous_chapter?: number;
    next_chapter?: number;
  };
  /** Флаг что данные из offline кэша */
  _cached?: boolean;
}

/**
 * Маппинг типов описаний из кэша в API формат
 */
function mapDescriptionType(cachedType: CachedDescription['type']): Description['type'] {
  const typeMap: Record<CachedDescription['type'], Description['type']> = {
    scene: 'action',
    character: 'character',
    setting: 'location',
    object: 'object',
  };
  return typeMap[cachedType] ?? 'object';
}

/**
 * Конвертирует CachedDescription в Description формат API
 */
function convertCachedDescriptions(
  cached: CachedDescription[]
): Description[] {
  return cached.map((desc) => ({
    id: desc.id,
    content: desc.content,
    type: mapDescriptionType(desc.type),
    confidence_score: desc.confidence,
    priority_score: desc.confidence,
    generated_image: desc.imageUrl ? {
      id: `cached_${desc.id}`,
      service_used: 'cached',
      status: desc.imageStatus === 'generated' ? 'completed' : 'pending',
      image_url: desc.imageUrl,
      is_moderated: false,
      view_count: 0,
      download_count: 0,
      created_at: new Date().toISOString(),
      description: {
        id: desc.id,
        type: mapDescriptionType(desc.type),
        text: desc.content,
        content: desc.content,
        confidence_score: desc.confidence,
        priority_score: desc.confidence,
      },
      chapter: { id: '', number: 0, title: '' },
    } : undefined,
  })) as Description[];
}

/**
 * Маппинг типов описаний из API в кэш формат
 */
function mapToCachedDescriptionType(apiType: Description['type']): CachedDescription['type'] {
  const typeMap: Record<Description['type'], CachedDescription['type']> = {
    action: 'scene',
    character: 'character',
    location: 'setting',
    object: 'object',
    atmosphere: 'setting',
  };
  return typeMap[apiType] ?? 'object';
}

/**
 * Сохраняет главу в Dexie IndexedDB
 */
async function saveChapterToCache(
  userId: string,
  bookId: string,
  chapterNumber: number,
  response: ChapterResponse
): Promise<void> {
  const cacheId = createChapterId(userId, bookId, chapterNumber);

  const cachedDescriptions: CachedDescription[] = (response.descriptions ?? []).map((desc) => ({
    id: desc.id,
    content: desc.content,
    type: mapToCachedDescriptionType(desc.type),
    confidence: desc.confidence_score ?? 0,
    imageUrl: desc.generated_image?.image_url ?? null,
    imageStatus: desc.generated_image?.status === 'completed' ? 'generated' as const : 'none' as const,
  }));

  const chapter: CachedChapter = {
    id: cacheId,
    userId,
    bookId,
    chapterNumber,
    title: response.chapter.title ?? `Chapter ${chapterNumber}`,
    content: response.chapter.content ?? '',
    descriptions: cachedDescriptions,
    wordCount: response.chapter.word_count ?? 0,
    cachedAt: Date.now(),
    lastAccessedAt: Date.now(),
  };

  await db.chapters.put(chapter);
}

/**
 * Фоновое обновление главы с сервера (не блокирует UI)
 */
async function backgroundRefreshChapter(
  userId: string,
  bookId: string,
  chapterNumber: number
): Promise<void> {
  try {
    logger.debug(`🔄 [useChapter] Background refresh chapter ${chapterNumber}`);
    const response = await booksAPI.getChapter(bookId, chapterNumber);
    await saveChapterToCache(userId, bookId, chapterNumber, response);
    logger.debug(`✅ [useChapter] Background refresh complete for chapter ${chapterNumber}`);
  } catch (error) {
    logger.warn(`⚠️ [useChapter] Background refresh failed for chapter ${chapterNumber}:`, error);
  }
}

/**
 * Получение конкретной главы книги
 *
 * Offline-first подход:
 * 1. Сначала проверяет Dexie IndexedDB кэш
 * 2. Если есть - возвращает сразу + запускает фоновое обновление
 * 3. Если нет - загружает с API и сохраняет в кэш
 *
 * Автоматически prefetch'ит следующую главу для плавной навигации.
 *
 * @param bookId - ID книги
 * @param chapterNumber - Номер главы
 * @param options - Опции React Query
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useChapter('book-123', 5);
 *
 * if (data) {
 *   logger.debug('Chapter:', data.chapter.title);
 *   logger.debug('Descriptions:', data.descriptions?.length);
 *   logger.debug('Has next:', data.navigation.has_next);
 *   logger.debug('From cache:', data._cached);
 * }
 * ```
 */
export function useChapter(
  bookId: string,
  chapterNumber: number,
  options?: Omit<UseQueryOptions<ChapterResponse, Error>, 'queryKey' | 'queryFn'>
) {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();

  const query = useQuery({
    queryKey: chapterKeys.detail(userId, bookId, chapterNumber),
    queryFn: async (): Promise<ChapterResponse> => {
      logger.debug(
        `📖 [useChapter] Fetching chapter ${chapterNumber} for book ${bookId}`
      );

      // 1. Проверяем Dexie IndexedDB кэш
      const cacheId = createChapterId(userId, bookId, chapterNumber);
      const cached = await db.chapters.get(cacheId);

      if (cached) {
        logger.debug(
          `✅ [useChapter] Chapter ${chapterNumber} loaded from Dexie cache`
        );

        // Обновляем время последнего доступа
        await db.chapters.update(cacheId, { lastAccessedAt: Date.now() }).catch(() => {});

        // Если онлайн - запускаем фоновое обновление (не блокирует)
        if (isOnline()) {
          backgroundRefreshChapter(userId, bookId, chapterNumber).catch(() => {});
        }

        // Возвращаем данные из кэша
        return {
          chapter: {
            id: `${bookId}_${chapterNumber}`,
            book_id: bookId,
            number: chapterNumber,
            title: cached.title,
            content: cached.content,
            word_count: cached.wordCount,
            estimated_reading_time_minutes: Math.ceil(cached.wordCount / 200),
            descriptions: convertCachedDescriptions(cached.descriptions),
          } as Chapter,
          descriptions: convertCachedDescriptions(cached.descriptions),
          navigation: {
            has_previous: chapterNumber > 1,
            has_next: true, // Пессимистично предполагаем что есть следующая
            previous_chapter: chapterNumber > 1 ? chapterNumber - 1 : undefined,
            next_chapter: chapterNumber + 1,
          },
          _cached: true,
        };
      }

      // 2. Пробуем старый chapterCache как fallback (для миграции)
      const legacyCached = await chapterCache.get(userId, bookId, chapterNumber).catch(() => null);
      if (legacyCached) {
        logger.debug(
          `✅ [useChapter] Chapter ${chapterNumber} loaded from legacy chapterCache`
        );

        return {
          chapter: {
            id: `${bookId}_${chapterNumber}`,
            book_id: bookId,
            number: chapterNumber,
            title: `Chapter ${chapterNumber}`,
            content: '',
            word_count: 0,
            estimated_reading_time_minutes: 0,
            descriptions: legacyCached.descriptions,
          } as Chapter,
          descriptions: legacyCached.descriptions,
          navigation: {
            has_previous: chapterNumber > 1,
            has_next: true,
            previous_chapter: chapterNumber > 1 ? chapterNumber - 1 : undefined,
            next_chapter: chapterNumber + 1,
          },
          _cached: true,
        };
      }

      // 3. Загружаем с API
      logger.debug(
        `📡 [useChapter] Chapter ${chapterNumber} not in cache, fetching from API`
      );
      const response = await booksAPI.getChapter(bookId, chapterNumber);

      // 4. Сохраняем в Dexie IndexedDB кэш
      await saveChapterToCache(userId, bookId, chapterNumber, response).catch((err) => {
        logger.warn(
          `⚠️ [useChapter] Failed to cache chapter ${chapterNumber} in Dexie:`,
          err
        );
      });

      // 5. Также сохраняем в старый chapterCache для обратной совместимости
      if (response.descriptions) {
        await chapterCache
          .set(userId, bookId, chapterNumber, response.descriptions, [])
          .catch((err) => {
            logger.warn(
              `⚠️ [useChapter] Failed to cache chapter ${chapterNumber} in legacy cache:`,
              err
            );
          });
      }

      return response;
    },
    // Увеличенный staleTime для offline-first
    staleTime: 60 * 60 * 1000, // 1 час - главы редко меняются
    enabled: !!bookId && chapterNumber > 0,
    ...options,
  });

  // Кэшируем descriptions и делаем prefetch в useEffect
  React.useEffect(() => {
    if (query.data?.descriptions) {
      queryClient.setQueryData(
        descriptionKeys.byChapter(userId, bookId, chapterNumber),
        {
          chapter_info: {
            id: query.data.chapter.id,
            number: query.data.chapter.number,
            title: query.data.chapter.title,
            word_count: query.data.chapter.word_count,
            estimated_reading_time_minutes:
              query.data.chapter.estimated_reading_time_minutes,
            is_description_parsed: true,
            descriptions_found: query.data.descriptions.length,
          },
          nlp_analysis: {
            total_descriptions: query.data.descriptions.length,
            by_type: query.data.descriptions.reduce(
              (acc, desc) => {
                acc[desc.type] = (acc[desc.type] || 0) + 1;
                return acc;
              },
              {} as Record<string, number>
            ),
            descriptions: query.data.descriptions,
          },
          message: 'Descriptions loaded from chapter',
        }
      );
    }

    // Prefetch соседних глав
    if (query.data?.navigation.has_next && query.data?.navigation.next_chapter) {
      const nextChapter = query.data.navigation.next_chapter;
      queryClient.prefetchQuery({
        queryKey: chapterKeys.detail(userId, bookId, nextChapter),
        queryFn: () => booksAPI.getChapter(bookId, nextChapter),
        staleTime: 10 * 60 * 1000,
      });
    }

    if (query.data?.navigation.has_previous && query.data?.navigation.previous_chapter) {
      const prevChapter = query.data.navigation.previous_chapter;
      queryClient.prefetchQuery({
        queryKey: chapterKeys.detail(userId, bookId, prevChapter),
        queryFn: () => booksAPI.getChapter(bookId, prevChapter),
        staleTime: 10 * 60 * 1000,
      });
    }
  }, [query.data, bookId, chapterNumber, queryClient, userId]);

  return query;
}

/**
 * Получение главы для Reader контекста
 *
 * Отключает автоматический refetch при фокусе окна для предотвращения
 * race conditions с инициализацией Zustand auth store.
 *
 * @param bookId - ID книги
 * @param chapterNumber - Номер главы
 * @param options - Опции React Query
 *
 * @example
 * ```tsx
 * // В EpubReader компоненте
 * const { data, isLoading } = useChapterForReader('book-123', 5);
 * ```
 */
export function useChapterForReader(
  bookId: string,
  chapterNumber: number,
  options?: Omit<UseQueryOptions<ChapterResponse, Error>, 'queryKey' | 'queryFn'>
) {
  return useChapter(bookId, chapterNumber, {
    // Reader-specific: отключаем auto-refetch для предотвращения race conditions
    // с инициализацией Zustand auth store (100ms delay)
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    ...options,
  });
}

/**
 * Получение только контента главы (без descriptions)
 *
 * Легковесная версия useChapter для случаев, когда descriptions не нужны.
 *
 * @param bookId - ID книги
 * @param chapterNumber - Номер главы
 * @param options - Опции React Query
 *
 * @example
 * ```tsx
 * const { data: chapter, isLoading } = useChapterContent('book-123', 5);
 * ```
 */
export function useChapterContent(
  bookId: string,
  chapterNumber: number,
  options?: Omit<UseQueryOptions<Chapter, Error>, 'queryKey' | 'queryFn'>
) {
  const userId = getCurrentUserId();

  return useQuery({
    queryKey: [...chapterKeys.detail(userId, bookId, chapterNumber), 'content'],
    queryFn: async () => {
      const response = await booksAPI.getChapter(bookId, chapterNumber);
      return response.chapter;
    },
    staleTime: 10 * 60 * 1000,
    enabled: !!bookId && chapterNumber > 0,
    ...options,
  });
}

/**
 * Получение навигационной информации главы
 *
 * Для отображения кнопок next/prev без загрузки полного контента.
 *
 * @param bookId - ID книги
 * @param chapterNumber - Номер главы
 * @param options - Опции React Query
 *
 * @example
 * ```tsx
 * const { data: navigation } = useChapterNavigation('book-123', 5);
 *
 * return (
 *   <div>
 *     {navigation.has_previous && (
 *       <button onClick={() => goToChapter(navigation.previous_chapter)}>
 *         Previous
 *       </button>
 *     )}
 *     {navigation.has_next && (
 *       <button onClick={() => goToChapter(navigation.next_chapter)}>
 *         Next
 *       </button>
 *     )}
 *   </div>
 * );
 * ```
 */
export function useChapterNavigation(
  bookId: string,
  chapterNumber: number,
  options?: Omit<
    UseQueryOptions<
      {
        has_previous: boolean;
        has_next: boolean;
        previous_chapter?: number;
        next_chapter?: number;
      },
      Error
    >,
    'queryKey' | 'queryFn'
  >
) {
  const userId = getCurrentUserId();

  return useQuery({
    queryKey: chapterKeys.navigation(userId, bookId, chapterNumber),
    queryFn: async () => {
      const response = await booksAPI.getChapter(bookId, chapterNumber);
      return response.navigation;
    },
    staleTime: 15 * 60 * 1000, // 15 минут - навигация точно не меняется
    enabled: !!bookId && chapterNumber > 0,
    ...options,
  });
}

/**
 * Prefetch главы для предзагрузки
 *
 * Utility функция для ручного prefetch глав.
 * Полезно для предзагрузки нескольких глав заранее.
 *
 * @param bookId - ID книги
 * @param chapterNumber - Номер главы
 *
 * @example
 * ```tsx
 * const prefetchChapter = usePrefetchChapter();
 *
 * // Prefetch следующих 3 глав
 * useEffect(() => {
 *   for (let i = 1; i <= 3; i++) {
 *     prefetchChapter('book-123', currentChapter + i);
 *   }
 * }, [currentChapter]);
 * ```
 */
export function usePrefetchChapter() {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();

  return (bookId: string, chapterNumber: number) => {
    return queryClient.prefetchQuery({
      queryKey: chapterKeys.detail(userId, bookId, chapterNumber),
      queryFn: () => booksAPI.getChapter(bookId, chapterNumber),
      staleTime: 10 * 60 * 1000,
    });
  };
}
