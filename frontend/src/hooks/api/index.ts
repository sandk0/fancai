/**
 * React Query Hooks - Barrel Export
 *
 * Централизованный экспорт всех React Query хуков для fancai.
 *
 * Использование:
 * ```tsx
 * import { useBooks, useBook, useGenerateImage } from '@/hooks/api';
 * ```
 *
 * @module hooks/api
 */

// Query Keys
export {
  bookKeys,
  chapterKeys,
  descriptionKeys,
  imageKeys,
  sessionKeys,
  pwaKeys,
  queryKeyUtils,
  getCurrentUserId,
} from './queryKeys';

// Books Hooks
export {
  useBooks,
  useBooksInfinite,
  useBook,
  useBookForReader,
  useReadingProgress,
  useUserStatistics,
  useUploadBook,
  useDeleteBook,
  useUpdateReadingProgress,
  useBookFileUrl,
} from './useBooks';

// Chapter Hooks
export {
  useChapter,
  useChapterForReader,
  useChapterContent,
  useChapterNavigation,
  usePrefetchChapter,
} from './useChapter';

// Description Hooks
export {
  useChapterDescriptions,
  useDescriptionsList,
  useDescriptionsByType,
  useNLPAnalysis,
  useBookDescriptions,
  useReextractDescriptions,
} from './useDescriptions';

// Image Hooks
export {
  useBookImages,
  useImageForDescription,
  useGenerateImage,
  useBatchGenerateImages,
  useDeleteImage,
  useRegenerateImage,
  useGenerationStatus,
  useImageUserStats,
  useAsyncImageGeneration,
  type AsyncGenerationStatus,
  type UseAsyncImageGenerationOptions,
} from './useImages';

// Parsing Status Hook
export { useParsingStatus } from './useParsingStatus';

// Recap Hook
export { useRecap, type RecapEntity } from './useRecap';

/**
 * Type exports для использования в компонентах
 */
export type {
  // Можно добавить custom типы если нужно
} from '@/types/api';
