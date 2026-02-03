/**
 * useImageModal - Custom hook for managing image modal state
 *
 * Handles the modal state for displaying description images.
 * Includes image generation with status tracking and 409 error handling.
 * Now with IndexedDB caching for offline access.
 *
 * @returns Modal state and control functions
 *
 * @example
 * const { selectedImage, isGenerating, openModal, closeModal } = useImageModal({ bookId });
 * openModal(description, image);
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Description, GeneratedImage } from '@/types/api';
import { imagesAPI } from '@/api/images';
import { notify } from '@/stores/ui';
import { imageCache } from '@/services/imageCache';
import { getCurrentUserId } from '@/hooks/api/queryKeys';
import { useVisibilityManager } from '@/hooks/shared/useVisibilityManager';

import { logger } from '@/lib/logger';
import i18n from '@/lib/i18n';

/** Polling interval for checking async task status (ms) */
const POLLING_INTERVAL = 3000;

export type GenerationStatus = 'idle' | 'generating' | 'completed' | 'error';

interface UseImageModalOptions {
  bookId?: string; // Required for caching
  enableCache?: boolean; // Default: true
}

interface UseImageModalReturn {
  selectedImage: GeneratedImage | null;
  selectedDescription: Description | null;
  isOpen: boolean;
  isGenerating: boolean;
  generationStatus: GenerationStatus;
  generationError: string | null;
  descriptionPreview: string | null;
  isCached: boolean; // NEW: indicates if current image is from cache
  openModal: (description: Description, image?: GeneratedImage) => Promise<void>;
  closeModal: () => void;
  updateImage: (newImageUrl: string) => void;
  cancelGeneration: () => void;
}

export const useImageModal = (options: UseImageModalOptions = {}): UseImageModalReturn => {
  const { bookId, enableCache = true } = options;
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [selectedDescription, setSelectedDescription] = useState<Description | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle');
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [descriptionPreview, setDescriptionPreview] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);

  // AbortController for cancelling generation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Polling interval ref for async generation status checks
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Current task ID for async generation
  const currentTaskIdRef = useRef<string | null>(null);

  const wasPollingRef = useRef(false);
  const resumePollingRef = useRef<((taskId: string) => void) | null>(null);

  useVisibilityManager({
    id: 'image-modal-polling',
    priority: 20,
    delay: 0,
    enabled: isGenerating,
    onHidden: () => {
      if (pollingIntervalRef.current) {
        wasPollingRef.current = true;
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        logger.debug('[useImageModal] Paused polling due to background');
      }
    },
    onVisible: () => {
      if (wasPollingRef.current && currentTaskIdRef.current && isGenerating) {
        logger.debug('[useImageModal] Resuming polling after foreground, taskId:', currentTaskIdRef.current);
        setTimeout(() => {
          if (document.visibilityState === 'visible' && currentTaskIdRef.current && isGenerating) {
            resumePollingRef.current?.(currentTaskIdRef.current);
          }
          wasPollingRef.current = false;
        }, 200);
      } else {
        wasPollingRef.current = false;
      }
    },
    shouldRun: () => isGenerating,
  });

  /**
   * Cleanup polling interval and abort controller on unmount
   */
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  /**
   * Try to get cached image URL
   * Returns null if not cached or cache disabled
   */
  const getCachedImageUrl = useCallback(
    async (descriptionId: string): Promise<string | null> => {
      if (!enableCache || !bookId) return null;
      try {
        const userId = getCurrentUserId();
        return await imageCache.get(userId, descriptionId);
      } catch {
        return null;
      }
    },
    [enableCache, bookId]
  );

  /**
   * Cache image for offline use
   * Skips caching if app is not visible (P7 fix)
   */
  const cacheImage = useCallback(
    async (descriptionId: string, imageUrl: string): Promise<void> => {
      if (!enableCache || !bookId) return;

      // P7 fix: Skip caching if app is not visible to prevent IndexedDB corruption
      if (document.visibilityState !== 'visible') {
      logger.debug('[useImageModal] Skipping cache write - app not visible');
        return;
      }

      try {
        const userId = getCurrentUserId();
        await imageCache.set(userId, descriptionId, imageUrl, bookId);
      } catch (err) {
        logger.warn('⚠️ [useImageModal] Failed to cache image:', err);
      }
    },
    [enableCache, bookId]
  );

  /**
   * Resume polling for a task after returning from background (P7 fix)
   * This creates a new polling interval with the same taskId
   */
  const resumePolling = useCallback((taskId: string) => {
    // Don't start new polling if one exists
    if (pollingIntervalRef.current) {
      logger.debug('[useImageModal] resumePolling: polling already exists');
      return;
    }

    // Don't resume if aborted
    if (abortControllerRef.current?.signal.aborted) {
      logger.debug('[useImageModal] resumePolling: aborted, not resuming');
      return;
    }

    const signal = abortControllerRef.current?.signal;

    logger.debug('[useImageModal] resumePolling: starting polling for task', taskId);

    pollingIntervalRef.current = setInterval(async () => {
      // P7 fix: Don't poll if not visible
      if (document.visibilityState !== 'visible') {
        logger.debug('[useImageModal] Skipping poll - app not visible');
        return;
      }

      if (signal?.aborted) {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        return;
      }

      try {
        const status = await imagesAPI.getTaskStatus(taskId, signal);

        // P7 fix: Double-check visibility before updating state
        if (document.visibilityState !== 'visible') {
          logger.debug('[useImageModal] Skipping state update - app not visible');
          return;
        }

        if (status.status === 'SUCCESS' && status.result?.success) {
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }

          const imageUrl = status.result.image_url || '';
          const generationTime = status.result.generation_time_seconds || 0;

          // Get the current description from state for creating the image object
          const currentDescription = selectedDescription;
          if (!currentDescription) {
            logger.debug('[useImageModal] No selected description for completed task');
            return;
          }

          const newImage: GeneratedImage = {
            id: status.result.image_id || currentDescription.id,
            image_url: imageUrl,
            service_used: 'imagen',
            status: 'completed',
            generation_time_seconds: generationTime,
            created_at: new Date().toISOString(),
            is_moderated: false,
            view_count: 0,
            download_count: 0,
            description: {
              id: currentDescription.id,
              type: currentDescription.type,
              text: currentDescription.content,
              content: currentDescription.content,
              confidence_score: currentDescription.confidence_score || 0,
              priority_score: currentDescription.priority_score,
            },
            chapter: {
              id: '',
              number: 0,
              title: '',
            },
          };

          setSelectedImage(newImage);
          setGenerationStatus('completed');
          setIsGenerating(false);
          currentTaskIdRef.current = null;

          // Cache with visibility check built-in
          cacheImage(currentDescription.id, imageUrl);

          notify.success(
            i18n.t('hooks.imageModal.image_created'),
            i18n.t('hooks.imageModal.generated_in', { time: generationTime.toFixed(1) })
          );
        } else if (status.status === 'FAILURE') {
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }

          const errorMessage = status.result?.error_message || status.message || i18n.t('hooks.imageModal.create_error');

          setGenerationError(errorMessage);
          setGenerationStatus('error');
          setIsGenerating(false);
          currentTaskIdRef.current = null;
          notify.error(i18n.t('hooks.imageModal.generation_error'), errorMessage);
        }
      } catch (pollError: unknown) {
        if (pollError instanceof Error && pollError.name === 'AbortError') {
          return;
        }
        logger.error('[useImageModal] Polling error:', pollError);
      }
    }, POLLING_INTERVAL);
  }, [cacheImage, selectedDescription]);

  resumePollingRef.current = resumePolling;

  /**
   * Open modal with description and optional image
   * If no image exists, check cache first, then generate
   * Handles 409 (image exists) by fetching the existing image
   */
  const openModal = useCallback(async (description: Description, image?: GeneratedImage) => {
    // Clear previous errors
    setGenerationError(null);
    setSelectedDescription(description);
    setDescriptionPreview(description.content?.substring(0, 100) || null);
    setIsCached(false);

    // If image already provided, check cache for local URL
    if (image) {
      // Try to use cached version for faster/offline display
      const cachedUrl = await getCachedImageUrl(description.id);
      if (cachedUrl) {
        setSelectedImage({ ...image, image_url: cachedUrl });
        setIsCached(true);
      } else {
        setSelectedImage(image);
        // Cache the image for future offline use (async, don't wait)
        cacheImage(description.id, image.image_url);
      }

      setIsOpen(true);
      setGenerationStatus('completed');
      return;
    }

    // Check cache first before generating
    const cachedUrl = await getCachedImageUrl(description.id);
    if (cachedUrl) {

      const cachedImage: GeneratedImage = {
        id: description.id,
        image_url: cachedUrl,
        service_used: 'cached',
        status: 'completed',
        generation_time_seconds: 0,
        created_at: new Date().toISOString(),
        is_moderated: false,
        view_count: 0,
        download_count: 0,
        description: {
          id: description.id,
          type: description.type,
          text: description.content,
          content: description.content,
          confidence_score: description.confidence_score || 0,
          priority_score: description.priority_score,
        },
        chapter: {
          id: '',
          number: 0,
          title: '',
        },
      };

      setSelectedImage(cachedImage);
      setIsOpen(true);
      setGenerationStatus('completed');
      setIsCached(true);
      return;
    }

    // Generate image if not in cache - use async generation with polling
    setIsGenerating(true);
    setGenerationStatus('generating');
    setIsOpen(true); // Open modal immediately to show loading state

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      // Start async generation - returns immediately with task_id
      const queueResult = await imagesAPI.generateAsync(description.id, {}, signal);

      currentTaskIdRef.current = queueResult.task_id;

      // Start polling for task status (with P7 visibility checks)
      pollingIntervalRef.current = setInterval(async () => {
        // P7 fix: Skip polling if app is not visible
        if (document.visibilityState !== 'visible') {
          logger.debug('[useImageModal] Skipping poll tick - app not visible');
          return;
        }

        if (signal.aborted) {
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          return;
        }

        try {
          const status = await imagesAPI.getTaskStatus(queueResult.task_id, signal);

           // P7 fix: Double-check visibility before updating state
          if (document.visibilityState !== 'visible') {
            logger.debug('[useImageModal] Skipping state update after poll - app not visible');
            return;
          }

          if (status.status === 'SUCCESS' && status.result?.success) {
            // Task completed successfully
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }

            const imageUrl = status.result.image_url || '';
            const generationTime = status.result.generation_time_seconds || 0;

            const newImage: GeneratedImage = {
              id: status.result.image_id || description.id,
              image_url: imageUrl,
              service_used: 'imagen',
              status: 'completed',
              generation_time_seconds: generationTime,
              created_at: new Date().toISOString(),
              is_moderated: false,
              view_count: 0,
              download_count: 0,
              description: {
                id: description.id,
                type: description.type,
                text: description.content,
                content: description.content,
                confidence_score: description.confidence_score || 0,
                priority_score: description.priority_score,
              },
              chapter: {
                id: '',
                number: 0,
                title: '',
              },
            };

            setSelectedImage(newImage);
            setGenerationStatus('completed');
            setIsGenerating(false);
            currentTaskIdRef.current = null;

            // Cache the generated image (with visibility check built-in)
            cacheImage(description.id, imageUrl);

            notify.success(
              i18n.t('hooks.imageModal.image_created'),
              i18n.t('hooks.imageModal.generated_in', { time: generationTime.toFixed(1) })
            );
          } else if (status.status === 'FAILURE') {
            // Task failed
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }

            const errorMessage = status.result?.error_message || status.message || i18n.t('hooks.imageModal.create_error');

            setGenerationError(errorMessage);
            setGenerationStatus('error');
            setIsGenerating(false);
            currentTaskIdRef.current = null;
            notify.error(i18n.t('hooks.imageModal.generation_error'), errorMessage);
          }
          // For PENDING, STARTED, RETRY - continue polling
        } catch (pollError: unknown) {
          // Ignore abort errors during polling
          if (pollError instanceof Error && pollError.name === 'AbortError') {
            return;
          }
          logger.error('[useImageModal] Polling error:', pollError);
        }
      }, POLLING_INTERVAL);

    } catch (error: unknown) {
      // Check if aborted
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      logger.error('[useImageModal] Async generation failed:', error);

      // Check for 409 - image already exists
      const err = error as { response?: { status?: number }; message?: string; details?: { detail?: string } };
      const isConflict =
        err.response?.status === 409 ||
        err.message?.includes('already exists') ||
        err.details?.detail?.includes?.('already exists');

      if (isConflict) {
        try {
          // Fetch existing image
          const existingImage = await imagesAPI.getImageForDescription(description.id);

          setSelectedImage(existingImage);
          setGenerationStatus('completed');

          // Cache the fetched image (async, don't wait)
          cacheImage(description.id, existingImage.image_url);
        } catch (fetchError: unknown) {
          logger.error('[useImageModal] Failed to fetch existing image:', fetchError);
          setGenerationError(i18n.t('hooks.imageModal.load_error'));
          setGenerationStatus('error');
          notify.error(i18n.t('hooks.imageModal.error_title'), i18n.t('hooks.imageModal.load_error_short'));
        }
      } else {
        // Handle other errors
        const errorMessage = err.message || i18n.t('hooks.imageModal.create_error');
        setGenerationError(errorMessage);
        setGenerationStatus('error');
        notify.error(i18n.t('hooks.imageModal.generation_error'), errorMessage);
      }
    } finally {
      if (!pollingIntervalRef.current) {
        // Only clean up if no polling is active (error case)
        setIsGenerating(false);
        abortControllerRef.current = null;
      }
    }
  }, [getCachedImageUrl, cacheImage]);

  /**
   * Close modal and reset state
   * ВАЖНО: Освобождает Object URL если изображение было из кеша
   */
  const closeModal = useCallback(() => {
    setIsOpen(false);

    // Освобождаем Object URL если изображение из кеша
    if (isCached && selectedDescription) {
      imageCache.release(selectedDescription.id);
    }

    // Don't clear selectedImage immediately - allow animation
    setTimeout(() => {
      setSelectedImage(null);
      setSelectedDescription(null);
      setGenerationError(null);
      setDescriptionPreview(null);
      setIsCached(false);
      // Don't reset status to idle - keep it for status bar to show completion
    }, 300);
  }, [isCached, selectedDescription]);

  /**
   * Cancel ongoing generation
   * Clears polling interval and aborts any pending requests
   */
  const cancelGeneration = useCallback(() => {
    // Clear polling interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    // Abort any pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Clear task ID
    currentTaskIdRef.current = null;

    setIsGenerating(false);
    setGenerationStatus('idle');
    setGenerationError(null);
    setDescriptionPreview(null);
  }, []);

  /**
   * Update image URL (after regeneration)
   */
  const updateImage = useCallback((newImageUrl: string) => {
    if (selectedImage) {
      setSelectedImage({
        ...selectedImage,
        image_url: newImageUrl,
      });
    }
  }, [selectedImage]);

  return {
    selectedImage,
    selectedDescription,
    isOpen,
    isGenerating,
    generationStatus,
    generationError,
    descriptionPreview,
    isCached,
    openModal,
    closeModal,
    updateImage,
    cancelGeneration,
  };
};
