/**
 * Async image generation hook with Celery polling
 *
 * @module hooks/api/useImages/useAsyncImageGeneration
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { imagesAPI, type AsyncGenerationResponse } from '@/api/images';
import { imageKeys, getCurrentUserId } from '../queryKeys';
import { logger } from '@/lib/logger';
import type {
  GeneratedImage,
  ImageGenerationParams,
} from '@/types/api';

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
 *   onSuccess: (image) => logger.debug('Generated:', image.image_url),
 *   onError: (error) => logger.error('Failed:', error),
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
          logger.error('[useAsyncImageGeneration] Polling error:', err);
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
