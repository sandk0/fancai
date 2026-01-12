/**
 * React Query хуки для работы с изображениями
 *
 * Генерация, кэширование и управление AI-сгенерированными изображениями
 * для визуальных описаний из книг.
 *
 * Особенности:
 * - Интеграция с imageCache (IndexedDB) для offline доступа
 * - Автоматическая нормализация URL изображений
 * - Batch генерация для глав
 * - Оптимистичные обновления
 * - Exponential backoff retry для генерации изображений
 *
 * @module hooks/api/useImages
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { imagesAPI, type AsyncGenerationResponse } from '@/api/images';
import { imageCache } from '@/services/imageCache';
import { imageKeys, getCurrentUserId } from './queryKeys';
import { QUERY_RETRY_PRESETS } from '@/lib/queryClient';
import type {
  GeneratedImage,
  ImageGenerationParams,
  BatchGenerationRequest,
  GenerationStatus,
  DescriptionType,
} from '@/types/api';

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
 *   console.log('Total images:', data.pagination.total_found);
 *   data.images.forEach(img => {
 *     console.log(`Image for ${img.description.type}: ${img.image_url}`);
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
      console.log(
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
        console.log(
          `💾 [useBookImages] Caching ${response.images.length} images to IndexedDB`
        );

        await Promise.all(
          response.images.map(async (image) => {
            try {
              // Проверяем, есть ли уже в кэше
              const cached = await imageCache.get(userId, image.description.id);
              if (!cached) {
                // Загружаем и кэшируем
                await imageCache.set(
                  userId,
                  image.description.id,
                  image.image_url,
                  bookId
                );
              }
            } catch (err) {
              console.warn(
                `⚠️ [useBookImages] Failed to cache image ${image.id}:`,
                err
              );
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
      console.log(
        `🖼️ [useImageForDescription] Fetching image for description ${descriptionId}`
      );

      // 1. Проверяем IndexedDB кэш
      const cachedUrl = await imageCache.get(userId, descriptionId);
      if (cachedUrl) {
        console.log(
          `✅ [useImageForDescription] Image loaded from IndexedDB cache`
        );

        // Возвращаем mock объект с кэшированным URL
        // В реальности нужно хранить полный GeneratedImage в кэше
        return {
          id: descriptionId,
          image_url: cachedUrl,
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
      console.log(
        `📡 [useImageForDescription] Image not in cache, fetching from API`
      );
      const image = await imagesAPI.getImageForDescription(descriptionId);

      // 3. Кэшируем
      // P1.3: Now using proper bookId for cache organization
      try {
        await imageCache.set(
          userId,
          descriptionId,
          image.image_url,
          bookId
        );
      } catch (err) {
        console.warn(
          `⚠️ [useImageForDescription] Failed to cache image:`,
          err
        );
      }

      return image;
    },
    staleTime: 30 * 60 * 1000, // 30 минут - изображения не меняются
    enabled: !!descriptionId && !!bookId,
    ...options,
  });
}

/**
 * Мутация генерации изображения для описания
 *
 * @param options - Опции мутации
 *
 * @example
 * ```tsx
 * const generateMutation = useGenerateImage();
 *
 * const handleGenerate = async (descriptionId: string, bookId: string) => {
 *   try {
 *     const result = await generateMutation.mutateAsync({
 *       descriptionId,
 *       bookId,
 *       params: {
 *         style_prompt: 'watercolor painting',
 *       },
 *     });
 *     console.log('Image generated:', result.image_url);
 *   } catch (error) {
 *     console.error('Generation failed:', error);
 *   }
 * };
 * ```
 */
export function useGenerateImage(
  options?: Omit<
    UseMutationOptions<
      {
        image_id: string;
        description_id: string;
        image_url: string;
        generation_time: number;
        status: string;
        created_at: string;
        message: string;
      },
      Error,
      {
        descriptionId: string;
        bookId: string; // P1.3: Added for proper cache isolation
        params?: ImageGenerationParams;
      }
    >,
    'mutationFn'
  >
) {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();

  return useMutation({
    mutationFn: async ({ descriptionId, params = {} }) => {
      console.log(
        `[useGenerateImage] Generating image for description ${descriptionId}`
      );
      return imagesAPI.generateImageForDescription(descriptionId, params);
    },
    onSuccess: async (data, variables) => {
      // Cache the generated image
      // P1.3: Now using proper bookId for cache organization
      try {
        await imageCache.set(
          userId,
          variables.descriptionId,
          data.image_url,
          variables.bookId
        );
      } catch (err) {
        console.warn(`[useGenerateImage] Failed to cache image:`, err);
      }

      // Invalidate related queries
      queryClient.invalidateQueries({
        queryKey: imageKeys.byDescription(userId, variables.descriptionId),
      });
      queryClient.invalidateQueries({ queryKey: imageKeys.userStats(userId) });
    },
    // Use image generation retry preset (4 retries, 2-60s delays with jitter)
    ...QUERY_RETRY_PRESETS.imageGeneration,
    ...options,
  });
}

/**
 * Мутация batch генерации изображений для главы
 *
 * @param bookId - Book ID для кэширования (P1.3)
 * @param options - Опции мутации
 *
 * @example
 * ```tsx
 * const batchGenerateMutation = useBatchGenerateImages('book-123');
 *
 * const handleGenerateAll = async (chapterId: string) => {
 *   const result = await batchGenerateMutation.mutateAsync({
 *     chapter_id: chapterId,
 *     max_images: 10,
 *     description_types: ['location', 'character'],
 *   });
 *   console.log(`Generated ${result.successful}/${result.total_descriptions} images`);
 * };
 * ```
 */
export function useBatchGenerateImages(
  bookId: string, // P1.3: Added for proper cache isolation
  options?: Omit<
    UseMutationOptions<
      {
        chapter_id: string;
        total_descriptions: number;
        processed: number;
        successful: number;
        failed: number;
        images: Array<{
          description_id: string;
          description_type: DescriptionType;
          image_url: string;
          generation_time: number;
        }>;
        message: string;
      },
      Error,
      BatchGenerationRequest
    >,
    'mutationFn'
  >
) {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();

  return useMutation({
    mutationFn: async (request: BatchGenerationRequest) => {
      console.log(
        `[useBatchGenerateImages] Batch generating images for chapter ${request.chapter_id}`
      );
      return imagesAPI.generateImagesForChapter(request.chapter_id, request);
    },
    onSuccess: async (data, _variables) => {
      // Cache all generated images
      // P1.3: Now using proper bookId for cache organization
      console.log(
        `[useBatchGenerateImages] Caching ${data.images.length} generated images for book ${bookId}`
      );

      await Promise.all(
        data.images.map(async (image) => {
          try {
            await imageCache.set(
              userId,
              image.description_id,
              image.image_url,
              bookId
            );
          } catch (err) {
            console.warn(
              `[useBatchGenerateImages] Failed to cache image:`,
              err
            );
          }
        })
      );

      // Invalidate all image queries for this chapter
      queryClient.invalidateQueries({ queryKey: imageKeys.all(userId) });
    },
    // Use image generation retry preset (4 retries, 2-60s delays with jitter)
    ...QUERY_RETRY_PRESETS.imageGeneration,
    ...options,
  });
}

/**
 * Мутация удаления изображения
 *
 * @param options - Опции мутации
 *
 * @example
 * ```tsx
 * const deleteMutation = useDeleteImage();
 *
 * const handleDelete = async (imageId: string) => {
 *   if (confirm('Удалить изображение?')) {
 *     await deleteMutation.mutateAsync(imageId);
 *   }
 * };
 * ```
 */
export function useDeleteImage(
  options?: Omit<
    UseMutationOptions<{ message: string }, Error, string>,
    'mutationFn'
  >
) {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();

  return useMutation({
    mutationFn: (imageId: string) => imagesAPI.deleteImage(imageId),
    onSuccess: async (_data, _imageId) => {
      // Удаляем из всех кэшей
      // TODO: нужен descriptionId для удаления из imageCache
      // await imageCache.delete(descriptionId);

      // Инвалидация всех image queries
      queryClient.invalidateQueries({ queryKey: imageKeys.all(userId) });
    },
    ...options,
  });
}

/**
 * Мутация регенерации изображения
 *
 * @param options - Опции мутации
 *
 * @example
 * ```tsx
 * const regenerateMutation = useRegenerateImage();
 *
 * const handleRegenerate = async (imageId: string, bookId: string) => {
 *   const result = await regenerateMutation.mutateAsync({
 *     imageId,
 *     bookId,
 *     params: {
 *       style_prompt: 'anime style',
 *       negative_prompt: 'blurry, low quality',
 *     },
 *   });
 * };
 * ```
 */
export function useRegenerateImage(
  options?: Omit<
    UseMutationOptions<
      {
        image_id: string;
        description_id: string;
        image_url: string;
        generation_time: number;
        status: string;
        updated_at: string;
        message: string;
        description: {
          id: string;
          type: DescriptionType;
          text: string;
          content: string;
        };
      },
      Error,
      {
        imageId: string;
        bookId: string; // P1.3: Added for proper cache isolation
        params?: ImageGenerationParams;
      }
    >,
    'mutationFn'
  >
) {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();

  return useMutation({
    mutationFn: async ({ imageId, params = {} }) => {
      console.log(`[useRegenerateImage] Regenerating image ${imageId}`);
      return imagesAPI.regenerateImage(imageId, params);
    },
    onSuccess: async (data, variables) => {
      // Update cache
      // P1.3: Now using proper bookId for cache organization
      try {
        await imageCache.set(
          userId,
          data.description_id,
          data.image_url,
          variables.bookId
        );
      } catch (err) {
        console.warn(`[useRegenerateImage] Failed to cache image:`, err);
      }

      // Invalidate queries
      queryClient.invalidateQueries({
        queryKey: imageKeys.byDescription(userId, data.description_id),
      });
      queryClient.invalidateQueries({ queryKey: imageKeys.all(userId) });
    },
    // Use image generation retry preset (4 retries, 2-60s delays with jitter)
    ...QUERY_RETRY_PRESETS.imageGeneration,
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
 *   console.log('Queue size:', status.queue_stats.queue_size);
 *   console.log('Is processing:', status.queue_stats.is_processing);
 *   console.log('Can generate:', status.user_info.can_generate);
 * }
 * ```
 */
export function useGenerationStatus(
  options?: Omit<
    UseQueryOptions<GenerationStatus, Error>,
    'queryKey' | 'queryFn'
  >
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
 *   console.log('Total generated:', stats.total_images_generated);
 *   console.log('Total descriptions:', stats.total_descriptions_found);
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

/**
 * Async image generation status type
 */
export type AsyncGenerationStatus = 'idle' | 'generating' | 'completed' | 'error';

/**
 * Options for useAsyncImageGeneration hook
 */
export interface UseAsyncImageGenerationOptions {
  /** Polling interval in milliseconds (default: 3000ms) */
  pollingInterval?: number;
  /** Callback when image generation completes successfully */
  onSuccess?: (image: GeneratedImage) => void;
  /** Callback when image generation fails */
  onError?: (error: string) => void;
}

/**
 * Hook for async image generation via Celery with polling
 *
 * Uses polling to track the status of a background image generation task.
 * Automatically invalidates caches on completion.
 *
 * @param options - Configuration options for the hook
 *
 * @example
 * ```tsx
 * const {
 *   generate,
 *   cancel,
 *   reset,
 *   status,
 *   progress,
 *   result,
 *   error,
 *   isGenerating,
 * } = useAsyncImageGeneration({
 *   pollingInterval: 2000,
 *   onSuccess: (image) => console.log('Generated:', image.image_url),
 *   onError: (error) => console.error('Failed:', error),
 * });
 *
 * // Start generation
 * generate({ descriptionId: 'desc-123', params: { style_prompt: 'anime' } });
 *
 * // Show progress
 * if (isGenerating) {
 *   return <ProgressBar value={progress} />;
 * }
 *
 * // Show result
 * if (result) {
 *   return <img src={result.image_url} alt="Generated" />;
 * }
 * ```
 */
export function useAsyncImageGeneration(options?: UseAsyncImageGenerationOptions) {
  // State
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<AsyncGenerationStatus>('idle');
  const [progress, setProgress] = useState<number>(0);
  const [result, setResult] = useState<GeneratedImage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Stop polling function
  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Polling function
  const startPolling = useCallback(
    (pollingTaskId: string) => {
      const interval = options?.pollingInterval || 3000;

      pollingIntervalRef.current = setInterval(async () => {
        try {
          const taskStatus = await imagesAPI.getTaskStatus(pollingTaskId);

          // Map Celery statuses to progress
          if (taskStatus.status === 'STARTED') {
            setProgress(50); // Indicate work in progress
          }

          if (taskStatus.status === 'SUCCESS' && taskStatus.result?.success) {
            stopPolling();
            setStatus('completed');
            // Create a GeneratedImage-like object from the result
            const generatedImage: GeneratedImage = {
              id: taskStatus.result.image_id || '',
              image_url: taskStatus.result.image_url || '',
              description: {
                id: '',
                type: 'location',
                text: '',
                content: '',
                confidence_score: 1.0,
                priority_score: 1.0,
              },
              chapter: {
                id: '',
                number: 0,
                title: '',
              },
              service_used: 'imagen',
              status: 'completed',
              view_count: 0,
              download_count: 0,
              is_moderated: false,
              created_at: new Date().toISOString(),
            };
            setResult(generatedImage);
            setProgress(100);
            // Invalidate caches
            const userId = getCurrentUserId();
            queryClient.invalidateQueries({ queryKey: imageKeys.all(userId) });
            options?.onSuccess?.(generatedImage);
          } else if (taskStatus.status === 'FAILURE' || (taskStatus.status === 'SUCCESS' && !taskStatus.result?.success)) {
            stopPolling();
            setStatus('error');
            const errorMessage = taskStatus.result?.error_message || taskStatus.message || 'Generation failed';
            setError(errorMessage);
            options?.onError?.(errorMessage);
          } else if (taskStatus.status === 'REVOKED') {
            stopPolling();
            setStatus('idle');
            setTaskId(null);
          }
        } catch (err) {
          // Don't stop polling on network errors - may be temporary
          console.error('[useAsyncImageGeneration] Polling error:', err);
        }
      }, interval);
    },
    [queryClient, options, stopPolling]
  );

  // Mutation for starting generation
  const startMutation = useMutation({
    mutationFn: async ({
      descriptionId,
      params,
    }: {
      descriptionId: string;
      params?: ImageGenerationParams;
    }): Promise<AsyncGenerationResponse> => {
      abortControllerRef.current = new AbortController();
      const response = await imagesAPI.generateAsync(
        descriptionId,
        params,
        abortControllerRef.current.signal
      );
      return response;
    },
    onSuccess: (data) => {
      setTaskId(data.task_id);
      setStatus('generating');
      setProgress(0);
      startPolling(data.task_id);
    },
    onError: (err) => {
      setStatus('error');
      const errorMessage = err instanceof Error ? err.message : 'Failed to start generation';
      setError(errorMessage);
      options?.onError?.(errorMessage);
    },
  });

  // Cancel generation
  const cancel = useCallback(() => {
    stopPolling();
    abortControllerRef.current?.abort();
    setStatus('idle');
    setTaskId(null);
  }, [stopPolling]);

  // Reset state
  const reset = useCallback(() => {
    stopPolling();
    setTaskId(null);
    setStatus('idle');
    setProgress(0);
    setResult(null);
    setError(null);
  }, [stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
      abortControllerRef.current?.abort();
    };
  }, [stopPolling]);

  return {
    // Methods
    generate: startMutation.mutate,
    generateAsync: startMutation.mutateAsync,
    cancel,
    reset,

    // State
    taskId,
    status,
    progress,
    result,
    error,

    // Flags
    isIdle: status === 'idle',
    isGenerating: status === 'generating',
    isCompleted: status === 'completed',
    isError: status === 'error',
    isPending: startMutation.isPending,
  };
}
