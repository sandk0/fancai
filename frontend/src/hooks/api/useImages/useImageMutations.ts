/**
 * React Query mutation hooks for images
 *
 * @module hooks/api/useImages/useImageMutations
 */

import { useMutation, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { imagesAPI } from '@/api/images';
import { imageCache } from '@/services/imageCache';
import { imageKeys, getCurrentUserId } from '../queryKeys';
import { QUERY_RETRY_PRESETS } from '@/lib/queryClient';
import { logger } from '@/lib/logger';
import type { ImageGenerationParams, BatchGenerationRequest, DescriptionType } from '@/types/api';

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
 *     logger.debug('Image generated:', result.image_url);
 *   } catch (error) {
 *     logger.error('Generation failed:', error);
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
      logger.debug(`[useGenerateImage] Generating image for description ${descriptionId}`);
      return imagesAPI.generateImageForDescription(descriptionId, params);
    },
    onSuccess: async (data, variables) => {
      // Cache the generated image
      // P1.3: Now using proper bookId for cache organization
      try {
        await imageCache.set(userId, variables.descriptionId, data.image_url, variables.bookId);
      } catch (err) {
        logger.warn(`[useGenerateImage] Failed to cache image:`, err);
      }

      // Invalidate ALL related query keys
      queryClient.invalidateQueries({
        queryKey: imageKeys.byDescription(userId, variables.descriptionId),
      });
      queryClient.invalidateQueries({
        queryKey: imageKeys.byBook(userId, variables.bookId),
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
 *   logger.debug(`Generated ${result.successful}/${result.total_descriptions} images`);
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
      logger.debug(
        `[useBatchGenerateImages] Batch generating images for chapter ${request.chapter_id}`
      );
      return imagesAPI.generateImagesForChapter(request.chapter_id, request);
    },
    onSuccess: async (data, _variables) => {
      // Cache all generated images
      // P1.3: Now using proper bookId for cache organization
      logger.debug(
        `[useBatchGenerateImages] Caching ${data.images.length} generated images for book ${bookId}`
      );

      await Promise.all(
        data.images.map(async (image) => {
          try {
            await imageCache.set(userId, image.description_id, image.image_url, bookId);
          } catch (err) {
            logger.warn(`[useBatchGenerateImages] Failed to cache image:`, err);
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
 * const handleDelete = async (imageId: string, descriptionId: string) => {
 *   if (confirm('Удалить изображение?')) {
 *     await deleteMutation.mutateAsync({ imageId, descriptionId });
 *   }
 * };
 * ```
 */
export function useDeleteImage(
  options?: Omit<
    UseMutationOptions<{ message: string }, Error, { imageId: string; descriptionId: string }>,
    'mutationFn'
  >
) {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();

  return useMutation({
    mutationFn: ({ imageId }: { imageId: string; descriptionId: string }) =>
      imagesAPI.deleteImage(imageId),
    onSuccess: async (_data, { descriptionId }) => {
      // Очистить blob URL из памяти
      imageCache.release(descriptionId);
      // Удалить из IndexedDB
      await imageCache.delete(userId, descriptionId);

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
      logger.debug(`[useRegenerateImage] Regenerating image ${imageId}`);
      return imagesAPI.regenerateImage(imageId, params);
    },
    onSuccess: async (data, variables) => {
      // Update cache
      // P1.3: Now using proper bookId for cache organization
      try {
        await imageCache.set(userId, data.description_id, data.image_url, variables.bookId);
      } catch (err) {
        logger.warn(`[useRegenerateImage] Failed to cache image:`, err);
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
