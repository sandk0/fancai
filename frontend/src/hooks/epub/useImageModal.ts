/**
 * useImageModal - Custom hook for managing image modal state
 *
 * Handles the modal state for displaying description images.
 * Includes image generation with status tracking and 409 error handling.
 * Now with IndexedDB caching for offline access.
 *
 * Refactored: Uses TanStack Query (useQuery with refetchInterval) for polling
 * instead of manual setInterval. Visibility pause handled by TQ focusManager.
 *
 * @returns Modal state and control functions
 *
 * @example
 * const { selectedImage, isGenerating, openModal, closeModal } = useImageModal({ bookId });
 * openModal(description, image);
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Description, GeneratedImage } from '@/types/api';
import { imagesAPI } from '@/api/images';
import { notify } from '@/stores/ui';
import { imageCache } from '@/services/imageCache';
import { imageKeys, getCurrentUserId } from '@/hooks/api/queryKeys';
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
  isCached: boolean;
  openModal: (description: Description, image?: GeneratedImage) => Promise<void>;
  closeModal: () => void;
  updateImage: (newImageUrl: string) => void;
  cancelGeneration: () => void;
}

export const useImageModal = (options: UseImageModalOptions = {}): UseImageModalReturn => {
  const { bookId, enableCache = true } = options;
  const queryClient = useQueryClient();

  // UI state
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null);
  const [selectedDescription, setSelectedDescription] = useState<Description | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle');
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [descriptionPreview, setDescriptionPreview] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);

  // Polling state
  const [taskId, setTaskId] = useState<string | null>(null);
  const [isPollingCancelled, setIsPollingCancelled] = useState(false);

  // Ref for description in polling useEffect (avoid stale closure)
  const descriptionRef = useRef<Description | null>(null);
  // Guard ref to prevent double-fetch on 409 conflict
  const isFetchingExistingRef = useRef(false);
  useEffect(() => {
    descriptionRef.current = selectedDescription;
  }, [selectedDescription]);

  // --- TQ Polling Query ---
  // Activates when taskId != null and not cancelled.
  // focusManager automatically pauses refetchInterval when document is hidden (P7 visibility).
  const { data: taskStatus } = useQuery({
    queryKey: imageKeys.taskStatus(taskId!),
    queryFn: () => imagesAPI.getTaskStatus(taskId!),
    enabled: !!taskId && !isPollingCancelled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'SUCCESS' || status === 'FAILURE') return false;
      return POLLING_INTERVAL;
    },
    refetchOnWindowFocus: false, // refetchInterval manages polling
    retry: 2,
  });

  // --- React to polling completion ---
  useEffect(() => {
    if (!taskStatus || !taskId) return;

    if (taskStatus.status === 'SUCCESS' && taskStatus.result?.success) {
      const imageUrl = taskStatus.result.image_url || '';
      const generationTime = taskStatus.result.generation_time_seconds || 0;
      const currentDescription = descriptionRef.current;

      if (!currentDescription) {
        logger.warn('[useImageModal] No selected description for completed task');
        setTaskId(null);
        return;
      }

      const newImage: GeneratedImage = {
        id: taskStatus.result.image_id || currentDescription.id,
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
        chapter: { id: '', number: 0, title: '' },
      };

      setSelectedImage(newImage);
      setGenerationStatus('completed');
      setTaskId(null);

      // Cache + query invalidation
      (async () => {
        if (enableCache && bookId) {
          try {
            const userId = getCurrentUserId();
            await imageCache.set(userId, currentDescription.id, imageUrl, bookId);
            // Invalidate for sync with DescriptionDrawer and gallery
            queryClient.invalidateQueries({
              queryKey: imageKeys.byDescription(userId, currentDescription.id),
            });
            queryClient.invalidateQueries({
              queryKey: imageKeys.byBook(userId, bookId),
            });
            queryClient.invalidateQueries({ queryKey: imageKeys.userStats(userId) });
          } catch (err) {
            logger.warn('[useImageModal] Cache/invalidate error:', err);
          }
        }
      })();

      notify.success(
        i18n.t('hooks.imageModal.image_created'),
        i18n.t('hooks.imageModal.generated_in', { time: generationTime.toFixed(1) })
      );
    } else if (taskStatus.status === 'FAILURE') {
      const errorMessage =
        taskStatus.result?.error_message ||
        taskStatus.message ||
        i18n.t('hooks.imageModal.create_error');
      setGenerationError(errorMessage);
      setGenerationStatus('error');
      setTaskId(null);
      notify.error(i18n.t('hooks.imageModal.generation_error'), errorMessage);
    }
    // PENDING, STARTED, RETRY -- polling continues automatically
  }, [taskStatus, taskId, enableCache, bookId, queryClient]);

  // --- Cache helpers ---
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

  // --- Open Modal ---
  const openModal = useCallback(
    async (description: Description, image?: GeneratedImage) => {
      // Clear previous errors
      setGenerationError(null);
      setSelectedDescription(description);
      setDescriptionPreview(description.content?.substring(0, 100) || null);
      setIsCached(false);
      setIsPollingCancelled(false);

      // If image already provided, check cache for local URL
      if (image) {
        const cachedUrl = await getCachedImageUrl(description.id);
        if (cachedUrl) {
          setSelectedImage({ ...image, image_url: cachedUrl });
          setIsCached(true);
        } else {
          setSelectedImage(image);
          // Cache the image for future offline use (async, don't wait)
          if (enableCache && bookId) {
            try {
              const userId = getCurrentUserId();
              imageCache.set(userId, description.id, image.image_url, bookId);
            } catch {
              /* ignore */
            }
          }
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
          chapter: { id: '', number: 0, title: '' },
        };

        setSelectedImage(cachedImage);
        setIsOpen(true);
        setGenerationStatus('completed');
        setIsCached(true);
        return;
      }

      // Generate image -- start async task and activate polling
      setGenerationStatus('generating');
      setIsOpen(true); // Open modal immediately to show loading state

      try {
        // Start async generation -- returns immediately with task_id
        const queueResult = await imagesAPI.generateAsync(description.id, {});
        setTaskId(queueResult.task_id); // Activates polling query
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') return;

        logger.error('[useImageModal] Async generation failed:', error);

        // Check for 409 -- image already exists
        const err = error as {
          response?: { status?: number };
          message?: string;
          details?: { detail?: string };
        };
        const isConflict =
          err.response?.status === 409 ||
          err.message?.includes('already exists') ||
          err.details?.detail?.includes?.('already exists');

        if (isConflict) {
          if (isFetchingExistingRef.current) return; // prevent double-fetch
          isFetchingExistingRef.current = true;
          try {
            // Fetch existing image
            const existingImage = await imagesAPI.getImageForDescription(description.id);
            setSelectedImage(existingImage);
            setGenerationStatus('completed');
            if (enableCache && bookId) {
              try {
                const userId = getCurrentUserId();
                imageCache.set(userId, description.id, existingImage.image_url, bookId);
              } catch {
                /* ignore */
              }
            }
          } catch (fetchError: unknown) {
            logger.error('[useImageModal] Failed to fetch existing image:', fetchError);
            setGenerationError(i18n.t('hooks.imageModal.load_error'));
            setGenerationStatus('error');
            notify.error(
              i18n.t('hooks.imageModal.error_title'),
              i18n.t('hooks.imageModal.load_error_short')
            );
          } finally {
            isFetchingExistingRef.current = false;
          }
        } else {
          const errorMessage = (error as Error).message || i18n.t('hooks.imageModal.create_error');
          setGenerationError(errorMessage);
          setGenerationStatus('error');
          notify.error(i18n.t('hooks.imageModal.generation_error'), errorMessage);
        }
      }
    },
    [getCachedImageUrl, enableCache, bookId]
  );

  // --- Close Modal ---
  const closeModal = useCallback(() => {
    setIsOpen(false);

    // Blob URL lifecycle managed by imageCache.cleanupStaleObjectURLs() (1 min interval, 30 min TTL).
    // Do NOT call imageCache.release() here — the same blob URL is shared with
    // TanStack Query cache (useImageForDescription, staleTime 30 min).
    // Revoking it would break the image in DescriptionDrawer.

    // Don't clear selectedImage immediately -- allow animation
    setTimeout(() => {
      setSelectedImage(null);
      setSelectedDescription(null);
      setGenerationError(null);
      setDescriptionPreview(null);
      setIsCached(false);
    }, 300);
  }, []);

  // --- Cancel Generation ---
  const cancelGeneration = useCallback(() => {
    setIsPollingCancelled(true);
    setTaskId(null);
    setGenerationStatus('idle');
    setGenerationError(null);
    setDescriptionPreview(null);
  }, []);

  // --- Update Image URL ---
  const updateImage = useCallback((newImageUrl: string) => {
    setSelectedImage((prev) => (prev ? { ...prev, image_url: newImageUrl } : null));
  }, []);

  // isGenerating derived from generationStatus
  const isGenerating = generationStatus === 'generating';

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
