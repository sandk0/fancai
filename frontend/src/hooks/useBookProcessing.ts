/**
 * useBookProcessing - Hook для управления обработкой описаний книги
 * 
 * Управляет состояниями:
 * - not_processed: книга не обработана, показывать кнопку ✨
 * - processing: идёт обработка, показывать ParsingOverlay
 * - processed: обработано, показывать badge ✓ и кнопку 🔄 при hover
 * - error: ошибка, показывать badge ⚠️ и кнопку retry
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { booksAPI } from '@/api/books';
import { bookKeys, getCurrentUserId } from '@/hooks/api/queryKeys';
import i18n from '@/lib/i18n';
import type { Book } from '@/types/api';

export type ProcessingState = 'not_processed' | 'processing' | 'processed' | 'error';

/**
 * Вычисляет состояние обработки книги на основе её полей
 */
export function getProcessingState(book: Book): ProcessingState {
    if (book.is_processing) {
        return 'processing';
    }
    if (book.descriptions_processing_error) {
        return 'error';
    }
    if (book.descriptions_extracted) {
        return 'processed';
    }
    return 'not_processed';
}

interface UseBookProcessingResult {
    // Состояние
    processingState: ProcessingState;

    // Мутации
    startProcessing: () => void;
    cancelProcessing: () => void;
    reprocess: () => void;

    // Статусы мутаций
    isStarting: boolean;
    isCancelling: boolean;
    isReprocessing: boolean;

    // Ошибки
    startError: Error | null;
    cancelError: Error | null;
    reprocessError: Error | null;
}

export function useBookProcessing(book: Book): UseBookProcessingResult {
    const queryClient = useQueryClient();
    const processingState = getProcessingState(book);

    // Invalidate book list and book detail after any mutation
    const invalidateQueries = () => {
        try {
            const userId = getCurrentUserId();
            // Invalidate all book queries (includes list)
            queryClient.invalidateQueries({ queryKey: bookKeys.all(userId) });
            // Invalidate specific book
            queryClient.invalidateQueries({ queryKey: bookKeys.detail(userId, book.id) });
        } catch {
            // User not authenticated, skip invalidation
        }
    };

    // Optimistic update helper
    const optimisticUpdate = (updates: Partial<Book>) => {
        try {
            const userId = getCurrentUserId();
            // Update book in list cache - use all() key as base for matching
            queryClient.setQueriesData<{ books: Book[]; total: number }>(
                { queryKey: bookKeys.all(userId) },
                (old) => {
                    if (!old) return old;
                    return {
                        ...old,
                        books: old.books.map((b) =>
                            b.id === book.id ? { ...b, ...updates } : b
                        ),
                    };
                }
            );
        } catch {
            // User not authenticated, skip optimistic update
        }
    };

    // Start processing mutation
    const startMutation = useMutation({
        mutationFn: () => booksAPI.processDescriptions(book.id),
        onMutate: () => {
            // Optimistic: set is_processing = true
            optimisticUpdate({
                is_processing: true,
                descriptions_extracted: false,
                descriptions_processing_error: null,
            });
        },
        onSuccess: () => {
            // НЕ вызываем invalidateQueries() здесь!
            // Optimistic update уже установил is_processing=true.
            // Вызов invalidateQueries() приведёт к перезагрузке /books/ с сервера,
            // где is_processing может быть ещё false (race condition),
            // что приведёт к исчезновению ParsingOverlay.
            // ParsingOverlay сам обновит UI через polling.
        },
        onError: () => {
            // Rollback optimistic update
            optimisticUpdate({
                is_processing: false,
            });
        },
    });

    // Cancel processing mutation
    const cancelMutation = useMutation({
        mutationFn: () => booksAPI.cancelProcessing(book.id),
        onMutate: () => {
            // Optimistic: set is_processing = false
            optimisticUpdate({
                is_processing: false,
                descriptions_extracted: false,
                descriptions_processing_error: i18n.t('hooks.bookProcessing.cancelled'),
            });
        },
        onSuccess: () => {
            invalidateQueries();
        },
        onError: () => {
            // Rollback - assume still processing
            optimisticUpdate({
                is_processing: true,
            });
        },
    });

    // Reprocess mutation
    const reprocessMutation = useMutation({
        mutationFn: () => booksAPI.reprocessDescriptions(book.id),
        onMutate: () => {
            // Optimistic: set is_processing = true, clear extracted flag
            optimisticUpdate({
                is_processing: true,
                descriptions_extracted: false,
                descriptions_processing_error: null,
            });
        },
        onSuccess: () => {
            invalidateQueries();
        },
        onError: () => {
            // Rollback
            optimisticUpdate({
                is_processing: false,
                descriptions_extracted: true, // Was processed before
            });
        },
    });

    return {
        processingState,

        startProcessing: () => startMutation.mutate(),
        cancelProcessing: () => cancelMutation.mutate(),
        reprocess: () => reprocessMutation.mutate(),

        isStarting: startMutation.isPending,
        isCancelling: cancelMutation.isPending,
        isReprocessing: reprocessMutation.isPending,

        startError: startMutation.error,
        cancelError: cancelMutation.error,
        reprocessError: reprocessMutation.error,
    };
}
