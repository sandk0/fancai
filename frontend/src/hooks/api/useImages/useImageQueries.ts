/**
 * React Query read-only hooks for images
 *
 * @module hooks/api/useImages/useImageQueries
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { imagesAPI } from '@/api/images';
import { imageCache } from '@/services/imageCache';
import { imageKeys, getCurrentUserId } from '../queryKeys';
import { logger } from '@/lib/logger';
import type { GeneratedImage, GenerationStatus, DescriptionType } from '@/types/api';

/**
 * Получение изображений книги
 *
 * @param bookId - ID книги
 * @param chapterNumber - Опциональный номер главы для фильтрации
 * @param pagination - Параметры пагинации
 * @param options - Опции React Query
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useBookImages('book-123', 5);
 *
 * if (data) {
 *   logger.debug('Total images:', data.pagination.total_found);
 *   data.images.forEach(img => {
 *     logger.debug(`Image for ${img.description.type}: ${img.image_url}`);
 *   });
 * }
 * ```
 */
export function useBookImages(
  bookId: string,
  chapterNumber?: number,
  pagination: { skip?: number; limit?: number } = {},
  options?: Omit<
    UseQueryOptions<
      {
        book_id: string;
        book_title: string;
        images: GeneratedImage[];
        pagination: {
          skip: number;
          limit: number;
          total_found: number;
        };
      },
      Error
    >,
    'queryKey' | 'queryFn'
  >
) {
  const userId = getCurrentUserId();

  return useQuery({
    // ВАЖНО: Используем примитивные значения вместо объекта pagination
    // для предотвращения ненужных refetch из-за reference equality
    queryKey: imageKeys.byBookPaginated(
      userId,
      bookId,
      chapterNumber,
      pagination?.skip ?? 0,
      pagination?.limit ?? 50
    ),
    queryFn: async () => {
      logger.debug(
        `🖼️ [useBookImages] Fetching images for book ${bookId}, chapter ${chapterNumber || 'all'}`
      );

      const response = await imagesAPI.getBookImages(
        bookId,
        chapterNumber,
        pagination.skip || 0,
        pagination.limit || 50
      );

      // Кэшируем изображения в IndexedDB
      if (response.images.length > 0) {
        logger.debug(`💾 [useBookImages] Caching ${response.images.length} images to IndexedDB`);

        await Promise.all(
          response.images.map(async (image) => {
            try {
              // Проверяем, есть ли уже в кэше
              const cached = await imageCache.get(userId, image.description.id);
              if (!cached) {
                // Загружаем и кэшируем
                await imageCache.set(userId, image.description.id, image.image_url, bookId);
              }
            } catch (err) {
              logger.warn(`⚠️ [useBookImages] Failed to cache image ${image.id}:`, err);
            }
          })
        );
      }

      return response;
    },
    staleTime: 5 * 60 * 1000, // 5 минут
    enabled: !!bookId,
    ...options,
  });
}

/**
 * Получение изображения для конкретного описания
 *
 * Сначала проверяет IndexedDB кэш, затем загружает с API.
 *
 * @param descriptionId - ID описания
 * @param bookId - ID книги для кэширования (P1.3)
 * @param options - Опции React Query
 *
 * @example
 * ```tsx
 * const { data: image, isLoading } = useImageForDescription('desc-123', 'book-456');
 *
 * return (
 *   <img
 *     src={image?.image_url}
 *     alt={image?.description.text}
 *   />
 * );
 * ```
 */
export function useImageForDescription(
  descriptionId: string,
  bookId: string, // P1.3: Added for proper cache isolation
  options?: Omit<UseQueryOptions<GeneratedImage, Error>, 'queryKey' | 'queryFn'>
) {
  const userId = getCurrentUserId();

  return useQuery({
    queryKey: imageKeys.byDescription(userId, descriptionId),
    queryFn: async () => {
      logger.debug(`🖼️ [useImageForDescription] Fetching image for description ${descriptionId}`);

      // 1. Проверяем IndexedDB кэш (с metadata для полного GeneratedImage)
      const cached = await imageCache.getWithMetadata(userId, descriptionId);
      if (cached) {
        logger.debug(
          `✅ [useImageForDescription] Image loaded from IndexedDB cache (hasMetadata: ${!!cached.metadata})`
        );

        // Если metadata содержит полный GeneratedImage -- используем его
        if (cached.metadata && 'id' in cached.metadata) {
          return {
            ...cached.metadata,
            image_url: cached.url, // Заменяем на blob URL
          } as GeneratedImage;
        }

        // Fallback для старых записей без metadata -- mock объект
        return {
          id: descriptionId,
          image_url: cached.url,
          description: {
            id: descriptionId,
            type: 'location' as DescriptionType,
            text: '',
            content: '',
          },
          chapter: {
            id: '',
            number: 0,
            title: '',
          },
          service_used: 'pollinations',
          status: 'completed' as const,
          view_count: 0,
          download_count: 0,
          is_moderated: false,
          created_at: new Date().toISOString(),
        } as GeneratedImage;
      }

      // 2. Загружаем с API
      logger.debug(`📡 [useImageForDescription] Image not in cache, fetching from API`);
      const image = await imagesAPI.getImageForDescription(descriptionId);

      // 3. Кэшируем
      // P1.3: Now using proper bookId for cache organization
      try {
        await imageCache.set(
          userId,
          descriptionId,
          image.image_url,
          bookId,
          image as unknown as Record<string, unknown>
        );
      } catch (err) {
        logger.warn(`⚠️ [useImageForDescription] Failed to cache image:`, err);
      }

      return image;
    },
    staleTime: 30 * 60 * 1000, // 30 минут - изображения не меняются
    enabled: !!descriptionId && !!bookId,
    ...options,
  });
}

/**
 * Получение статуса генерации изображений
 *
 * @param options - Опции React Query
 *
 * @example
 * ```tsx
 * const { data: status } = useGenerationStatus();
 *
 * if (status) {
 *   logger.debug('Queue size:', status.queue_stats.queue_size);
 *   logger.debug('Is processing:', status.queue_stats.is_processing);
 *   logger.debug('Can generate:', status.user_info.can_generate);
 * }
 * ```
 */
export function useGenerationStatus(
  options?: Omit<UseQueryOptions<GenerationStatus, Error>, 'queryKey' | 'queryFn'>
) {
  const userId = getCurrentUserId();

  return useQuery({
    queryKey: imageKeys.generationStatus(userId),
    queryFn: () => imagesAPI.getGenerationStatus(),
    staleTime: 30 * 1000, // 30 секунд - статус меняется часто
    ...options,
  });
}

/**
 * Получение статистики пользователя по изображениям
 *
 * @param options - Опции React Query
 *
 * @example
 * ```tsx
 * const { data: stats } = useImageUserStats();
 *
 * if (stats) {
 *   logger.debug('Total generated:', stats.total_images_generated);
 *   logger.debug('Total descriptions:', stats.total_descriptions_found);
 * }
 * ```
 */
export function useImageUserStats(
  options?: Omit<
    UseQueryOptions<
      {
        total_images_generated: number;
        total_descriptions_found: number;
      },
      Error
    >,
    'queryKey' | 'queryFn'
  >
) {
  const userId = getCurrentUserId();

  return useQuery({
    queryKey: imageKeys.userStats(userId),
    queryFn: () => imagesAPI.getUserStats(),
    staleTime: 2 * 60 * 1000, // 2 минуты
    ...options,
  });
}
