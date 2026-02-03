/**
 * React Query хуки для работы с книгами
 *
 * Обеспечивает кэширование, автоматическое обновление и оптимистичные обновления
 * для всех операций с книгами.
 *
 * Особенности:
 * - Offline-first: placeholderData из IndexedDB для мгновенного отображения
 * - Автоматический кэш с настраиваемым staleTime
 * - Оптимистичные обновления для лучшего UX
 * - Интеграция с чистящими функциями кэша (chapterCache, imageCache)
 * - Prefetching для следующих страниц
 *
 * @module hooks/api/useBooks
 */

import React from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
  type UseQueryOptions,
  type UseMutationOptions,
  type UseInfiniteQueryOptions,
} from '@tanstack/react-query';
import { booksAPI } from '@/api/books';
import { chapterCache } from '@/services/chapterCache';
import { imageCache } from '@/services/imageCache';
import { db } from '@/services/db';
import { bookKeys, queryKeyUtils, getCurrentUserId } from './queryKeys';
import { logger } from '@/lib/logger';
import type {
  Book,
  BookDetail,
  BookUploadResponse,
  PaginationParams,
  ReadingProgress,
  UserReadingStatistics,
} from '@/types/api';

/**
 * Параметры для списка книг
 */
interface BooksListParams extends PaginationParams {
  sort_by?: string;
}

/**
 * Расширенный тип книги с маркером offline
 */
interface OfflineBookMarker {
  _offline?: boolean;
}

/**
 * Загрузка offline книг из IndexedDB для placeholderData
 *
 * @param userId - ID пользователя
 * @returns Массив книг из IndexedDB или undefined
 */
async function getOfflineBooksPlaceholder(
  userId: string
): Promise<{ books: Book[]; total: number; skip: number; limit: number } | undefined> {
  try {
    const offlineBooks = await db.offlineBooks
      .where('userId')
      .equals(userId)
      .toArray();

    if (offlineBooks.length === 0) return undefined;

    // Преобразуем OfflineBook в Book формат для API совместимости
    const books: (Book & OfflineBookMarker)[] = offlineBooks.map((ob) => ({
      id: ob.bookId,
      title: ob.metadata.title,
      author: ob.metadata.author,
      genre: ob.metadata.genre ?? undefined,
      language: ob.metadata.language,
      description: undefined,
      total_pages: 0, // Unknown for offline
      estimated_reading_time_hours: 0,
      chapters_count: ob.metadata.totalChapters,
      reading_progress_percent: 0, // Will be updated from server
      has_cover: !!ob.metadata.coverUrl,
      is_parsed: ob.status === 'complete',
      is_processing: ob.status === 'downloading',
      created_at: new Date(ob.downloadedAt).toISOString(),
      last_accessed: new Date(ob.lastAccessedAt).toISOString(),
      // Маркер что это offline данные
      _offline: true,
    }));

    return {
      books,
      total: books.length,
      skip: 0,
      limit: books.length,
    };
  } catch (error) {
    logger.warn('[useBooks] Failed to load offline placeholder:', error);
    return undefined;
  }
}

/**
 * Получение списка книг с пагинацией
 *
 * Поддерживает offline-first: показывает книги из IndexedDB пока загружаются данные с сервера.
 *
 * @param params - Параметры пагинации и сортировки
 * @param options - Опции React Query
 *
 * @example
 * ```tsx
 * const { data, isLoading, error } = useBooks({
 *   skip: 0,
 *   limit: 10,
 *   sort_by: 'created_desc'
 * });
 * ```
 */
export function useBooks(
  params?: BooksListParams,
  options?: Omit<
    UseQueryOptions<
      {
        books: Book[];
        total: number;
        skip: number;
        limit: number;
      },
      Error
    >,
    'queryKey' | 'queryFn'
  >
) {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();

  const query = useQuery({
    // ВАЖНО: Используем примитивные значения вместо объекта params
    // для предотвращения ненужных refetch из-за reference equality
    queryKey: bookKeys.listPaginated(
      userId,
      params?.skip ?? 0,
      params?.limit ?? 10,
      params?.sort_by
    ),
    queryFn: () => booksAPI.getBooks(params),

    // Offline-first: показываем книги из IndexedDB пока загружаем с сервера
    placeholderData: () => {
      // Используем синхронный placeholder из предыдущего запроса или undefined
      // Async placeholder загружается в initialData через отдельный эффект
      return undefined;
    },

    // P2.1: Adaptive staleTime based on processing status
    // Base staleTime is 5 minutes for completed books
    staleTime: 5 * 60 * 1000,

    // Dynamic refetchInterval: poll every 10s if any book is processing
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data?.books) return false;

      const hasProcessingBook = data.books.some(
        (book) => book.is_processing
      );

      // Poll every 10 seconds if any book is still processing
      return hasProcessingBook ? 10 * 1000 : false;
    },
    ...options,
  });

  // Загружаем offline данные при первом рендере для fallback
  React.useEffect(() => {
    // Если данные уже загружены с сервера - не нужен offline fallback
    if (query.data) return;

    // Если нет данных и не идёт загрузка - пробуем offline
    if (!query.data && !query.isFetching) {
      getOfflineBooksPlaceholder(userId).then((offlineData) => {
        if (offlineData && !query.data) {
          // Устанавливаем offline данные как placeholder
          queryClient.setQueryData(
            bookKeys.listPaginated(
              userId,
              params?.skip ?? 0,
              params?.limit ?? 10,
              params?.sort_by
            ),
            offlineData
          );
          logger.debug('[useBooks] Loaded offline placeholder data:', offlineData.books.length, 'books');
        }
      });
    }
  }, [userId, params?.skip, params?.limit, params?.sort_by, query.data, query.isFetching, queryClient]);

  // Prefetch следующей страницы после успешной загрузки
  React.useEffect(() => {
    if (query.data) {
      const currentSkip = params?.skip ?? 0;
      const currentLimit = params?.limit ?? 10;
      const currentSortBy = params?.sort_by;
      const nextSkip = currentSkip + currentLimit;
      if (nextSkip < query.data.total) {
        queryClient.prefetchQuery({
          queryKey: bookKeys.listPaginated(
            userId,
            nextSkip,
            currentLimit,
            currentSortBy
          ),
          queryFn: () =>
            booksAPI.getBooks({
              skip: nextSkip,
              limit: currentLimit,
              sort_by: currentSortBy,
            }),
        });
      }
    }
  }, [query.data, params?.skip, params?.limit, params?.sort_by, queryClient, userId]);

  return query;
}

/**
 * Получение списка книг с infinite scroll
 *
 * @param params - Базовые параметры (limit, sort_by)
 * @param options - Опции React Query
 *
 * @example
 * ```tsx
 * const {
 *   data,
 *   fetchNextPage,
 *   hasNextPage,
 *   isFetchingNextPage
 * } = useBooksInfinite({ limit: 20, sort_by: 'created_desc' });
 * ```
 */
export function useBooksInfinite(
  params?: Omit<BooksListParams, 'skip'>,
  options?: Omit<
    UseInfiniteQueryOptions<
      {
        books: Book[];
        total: number;
        skip: number;
        limit: number;
      },
      Error
    >,
    'queryKey' | 'queryFn' | 'getNextPageParam' | 'initialPageParam'
  >
) {
  const userId = getCurrentUserId();

  return useInfiniteQuery({
    // ВАЖНО: Для infinite query используем стабильный ключ без skip
    // (skip управляется через pageParam)
    queryKey: bookKeys.listPaginated(
      userId,
      0, // skip = 0 для базового ключа infinite query
      params?.limit ?? 10,
      params?.sort_by
    ),
    queryFn: ({ pageParam }) =>
      booksAPI.getBooks({
        ...params,
        skip: pageParam as number,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextSkip = lastPage.skip + lastPage.limit;
      return nextSkip < lastPage.total ? nextSkip : undefined;
    },
    // P2.1: Adaptive staleTime based on processing status
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => {
      const pages = query.state.data?.pages;
      if (!pages) return false;

      const hasProcessingBook = pages.some((page) =>
        page.books.some(
          (book) => book.is_processing
        )
      );

      return hasProcessingBook ? 10 * 1000 : false;
    },
    ...options,
  });
}

/**
 * Получение деталей конкретной книги
 *
 * @param bookId - ID книги
 * @param options - Опции React Query
 *
 * @example
 * ```tsx
 * const { data: book, isLoading } = useBook('book-123');
 * ```
 */
export function useBook(
  bookId: string,
  options?: Omit<UseQueryOptions<BookDetail, Error>, 'queryKey' | 'queryFn'>
) {
  const userId = getCurrentUserId();

  return useQuery({
    queryKey: bookKeys.detail(userId, bookId),
    queryFn: () => booksAPI.getBook(bookId),
    staleTime: 5 * 60 * 1000, // 5 минут - детали книги меняются редко
    enabled: !!bookId, // Не запускать, если нет ID
    ...options,
  });
}

/**
 * Получение деталей книги для Reader контекста
 *
 * Отключает автоматический refetch при фокусе окна для предотвращения
 * race conditions с инициализацией Zustand auth store.
 *
 * @param bookId - ID книги
 * @param options - Опции React Query
 *
 * @example
 * ```tsx
 * // В EpubReader или BookReaderPage
 * const { data: book, isLoading } = useBookForReader('book-123');
 * ```
 */
export function useBookForReader(
  bookId: string,
  options?: Omit<UseQueryOptions<BookDetail, Error>, 'queryKey' | 'queryFn'>
) {
  const userId = getCurrentUserId();

  return useQuery({
    queryKey: bookKeys.detail(userId, bookId),
    queryFn: () => booksAPI.getBook(bookId),
    staleTime: 5 * 60 * 1000, // 5 минут
    enabled: !!bookId,
    // Reader-specific: отключаем auto-refetch для предотвращения race conditions
    // с инициализацией Zustand auth store (100ms delay)
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    ...options,
  });
}

/**
 * Получение прогресса чтения книги
 *
 * @param bookId - ID книги
 * @param options - Опции React Query
 *
 * @example
 * ```tsx
 * const { data: progress } = useReadingProgress('book-123');
 * ```
 */
export function useReadingProgress(
  bookId: string,
  options?: Omit<
    UseQueryOptions<{ progress: ReadingProgress | null }, Error>,
    'queryKey' | 'queryFn'
  >
) {
  const userId = getCurrentUserId();

  return useQuery({
    queryKey: bookKeys.progress(userId, bookId),
    queryFn: () => booksAPI.getReadingProgress(bookId),
    staleTime: 60 * 1000, // 1 минута - прогресс обновляется часто
    enabled: !!bookId,
    ...options,
  });
}

/**
 * Получение статистики чтения пользователя
 *
 * @param options - Опции React Query
 *
 * @example
 * ```tsx
 * const { data: stats } = useUserStatistics();
 * ```
 */
export function useUserStatistics(
  options?: Omit<
    UseQueryOptions<UserReadingStatistics, Error>,
    'queryKey' | 'queryFn'
  >
) {
  const userId = getCurrentUserId();

  return useQuery({
    queryKey: bookKeys.statistics(userId),
    queryFn: async () => {
      const data = await booksAPI.getUserReadingStatistics();
      return data;
    },
    staleTime: 2 * 60 * 1000, // 2 минуты
    ...options,
  });
}

/**
 * Мутация загрузки новой книги
 *
 * @param options - Опции мутации
 *
 * @example
 * ```tsx
 * const uploadMutation = useUploadBook();
 *
 * const handleUpload = async (file: File) => {
 *   try {
 *     const book = await uploadMutation.mutateAsync(file);
 *     logger.debug('Книга загружена:', book);
 *   } catch (error) {
 *     logger.error('Ошибка загрузки:', error);
 *   }
 * };
 * ```
 */
export function useUploadBook(
  options?: Omit<
    UseMutationOptions<
      BookUploadResponse,
      Error,
      {
        file: File;
        onProgress?: (percent: number) => void;
      }
    >,
    'mutationFn'
  >
) {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();

  return useMutation({
    mutationFn: async ({ file, onProgress }) => {
      const formData = new FormData();
      formData.append('file', file);

      return booksAPI.uploadBook(formData, {
        onUploadProgress: (progressEvent) => {
          const percent = Math.round(
            (progressEvent.loaded * 100) / (progressEvent.total || 1)
          );
          onProgress?.(percent);
        },
      });
    },
    onSuccess: (data) => {
      // Инвалидация списка книг и статистики
      queryKeyUtils.invalidateAfterUpload(userId).forEach((key) => {
        queryClient.invalidateQueries({ queryKey: key });
      });

      // Сразу добавляем книгу в кэш деталей
      queryClient.setQueryData(bookKeys.detail(userId, data.book.id), data.book);
    },
    ...options,
  });
}

/**
 * Мутация удаления книги
 *
 * @param options - Опции мутации
 *
 * @example
 * ```tsx
 * const deleteMutation = useDeleteBook();
 *
 * const handleDelete = async (bookId: string) => {
 *   if (confirm('Удалить книгу?')) {
 *     await deleteMutation.mutateAsync(bookId);
 *   }
 * };
 * ```
 */
export function useDeleteBook(
  options?: Omit<
    UseMutationOptions<
      { message: string },
      Error,
      string,
      { previousBooks: unknown }
    >,
    'mutationFn'
  >
) {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();

  return useMutation({
    mutationFn: (bookId: string) => booksAPI.deleteBook(bookId),
    onMutate: async (bookId): Promise<{ previousBooks: unknown }> => {
      // Cancel outgoing queries - use bookKeys.all(userId) to cancel ALL user's book queries
      await queryClient.cancelQueries({ queryKey: bookKeys.all(userId) });

      // Snapshot previous state для rollback
      const previousBooks = queryClient.getQueryData(bookKeys.list(userId));

      // Оптимистичное удаление из списка - update ALL list queries for this user
      queryClient.setQueriesData<{
        books: Book[];
        total: number;
        skip: number;
        limit: number;
      }>({ queryKey: bookKeys.all(userId) }, (old) => {
        if (!old || !old.books) return old;
        return {
          ...old,
          books: old.books.filter((book) => book.id !== bookId),
          total: Math.max(0, (old.total || 0) - 1),
        };
      });

      return { previousBooks };
    },
    onSuccess: async (_data, bookId) => {
      // Очистка кэшей глав и изображений
      logger.debug('🗑️ [useDeleteBook] Clearing caches for book:', bookId);
      await Promise.all([
        chapterCache.clearBook(userId, bookId),
        imageCache.clearBook(userId, bookId),
      ]).catch((err) => {
        logger.warn('⚠️ [useDeleteBook] Error clearing caches:', err);
      });

      // Инвалидация всех связанных запросов
      queryKeyUtils.invalidateAfterDelete(userId, bookId).forEach((key) => {
        queryClient.invalidateQueries({ queryKey: key });
      });
    },
    onError: (_error, _bookId, context) => {
      // Rollback на предыдущее состояние
      if (context?.previousBooks) {
        queryClient.setQueryData(bookKeys.list(userId), context.previousBooks);
      }
    },
    ...options,
  });
}

/**
 * Мутация обновления прогресса чтения
 *
 * @param options - Опции мутации
 *
 * @example
 * ```tsx
 * const updateProgressMutation = useUpdateReadingProgress();
 *
 * const handleProgressUpdate = async () => {
 *   await updateProgressMutation.mutateAsync({
 *     bookId: 'book-123',
 *     current_chapter: 5,
 *     current_position_percent: 75,
 *     reading_location_cfi: 'epubcfi(...)',
 *   });
 * };
 * ```
 */
export function useUpdateReadingProgress(
  options?: Omit<
    UseMutationOptions<
      {
        progress: ReadingProgress;
        message: string;
      },
      Error,
      {
        bookId: string;
        current_chapter: number;
        current_position_percent: number;
        reading_location_cfi?: string;
        scroll_offset_percent?: number;
      },
      { previousProgress: unknown }
    >,
    'mutationFn'
  >
) {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();

  return useMutation({
    mutationFn: ({ bookId, ...data }) =>
      booksAPI.updateReadingProgress(bookId, data),
    onMutate: async ({ bookId, ...newProgress }): Promise<{ previousProgress: unknown }> => {
      // Cancel queries
      await queryClient.cancelQueries({ queryKey: bookKeys.progress(userId, bookId) });

      // Snapshot
      const previousProgress = queryClient.getQueryData(
        bookKeys.progress(userId, bookId)
      );

      // Оптимистичное обновление
      queryClient.setQueryData(bookKeys.progress(userId, bookId), {
        progress: {
          book_id: bookId,
          current_chapter: newProgress.current_chapter,
          current_position: newProgress.current_position_percent,
          reading_location_cfi: newProgress.reading_location_cfi,
          scroll_offset_percent: newProgress.scroll_offset_percent,
          progress_percent: 0, // Будет пересчитано на бэкенде
          current_page: 0,
          last_read_at: new Date().toISOString(),
        },
      });

      return { previousProgress };
    },
    onSuccess: (data, variables) => {
      // Обновляем кэш прогресса
      queryClient.setQueryData(bookKeys.progress(userId, variables.bookId), data);

      // Обновляем процент прогресса в деталях книги
      queryClient.setQueryData<BookDetail>(
        bookKeys.detail(userId, variables.bookId),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            reading_progress: {
              ...old.reading_progress,
              current_chapter: data.progress.current_chapter,
              current_position: data.progress.current_position,
              reading_location_cfi: data.progress.reading_location_cfi,
              progress_percent: data.progress.progress_percent,
            },
          };
        }
      );

      // Обновляем процент в списке книг
      queryClient.setQueriesData<{
        books: Book[];
        total: number;
        skip: number;
        limit: number;
      }>({ queryKey: bookKeys.all(userId) }, (old) => {
        if (!old) return old;
        return {
          ...old,
          books: old.books.map((book) =>
            book.id === variables.bookId
              ? { ...book, reading_progress_percent: data.progress.progress_percent }
              : book
          ),
        };
      });

      // Также инвалидируем статистику пользователя
      queryClient.invalidateQueries({ queryKey: bookKeys.statistics(userId) });
    },
    onError: (_error, variables, context) => {
      // Rollback
      if (context?.previousProgress) {
        queryClient.setQueryData(
          bookKeys.progress(userId, variables.bookId),
          context.previousProgress
        );
      }
    },
    ...options,
  });
}

/**
 * Получение URL файла книги для EPUB reader
 *
 * @param bookId - ID книги
 * @returns URL файла
 *
 * @example
 * ```tsx
 * const bookFileUrl = useBookFileUrl('book-123');
 * ```
 */
export function useBookFileUrl(bookId: string): string {
  return booksAPI.getBookFileUrl(bookId);
}
