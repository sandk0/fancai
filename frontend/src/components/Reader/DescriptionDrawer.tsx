import React, { useState, useEffect, useCallback } from 'react';
import { Drawer } from 'vaul';
import { Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useImageForDescription } from '@/hooks/api/useImages/useImageQueries';
import { useRegenerateImage } from '@/hooks/api/useImages/useImageMutations';
import { imagesAPI } from '@/api/images';
import { imageCache } from '@/services/imageCache';
import { imageKeys, getCurrentUserId } from '@/hooks/api/queryKeys';
import { notify } from '@/stores/ui';
import type { Description, GeneratedImage } from '@/types/api';

interface DescriptionDrawerProps {
  description: Description | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenImage: (description: Description, image?: GeneratedImage) => void;
  bookId: string;
}

const SNAP_POINTS: [number, number] = [0.4, 0.8];

/**
 * DescriptionDrawer - Bottom sheet showing full description content
 * with image generation controls.
 *
 * Uses vaul Drawer with snap points [0.4, 0.8] for mobile-friendly
 * swipeable bottom sheet. Includes generate/view image button,
 * regeneration button with overlay spinner, and image preview.
 *
 * SSoT for images: useImageForDescription TQ query (IndexedDB L1 -> API L2).
 * Uses async generation endpoint with TQ polling (pattern from useImageModal).
 * Error messages displayed to user under retry button.
 */
export const DescriptionDrawer: React.FC<DescriptionDrawerProps> = ({
  description,
  isOpen,
  onClose,
  onOpenImage,
  bookId,
}) => {
  const { t } = useTranslation();
  const regenerateMutation = useRegenerateImage();
  const queryClient = useQueryClient();

  // SSoT: image from TQ cache (IndexedDB L1 -> API L2)
  const { data: image, isLoading: isImageLoading } = useImageForDescription(
    description?.id ?? '',
    bookId,
    { enabled: !!description?.id && isOpen }
  );

  // --- Async generation state ---
  const [taskId, setTaskId] = useState<string | null>(null);
  const [genStatus, setGenStatus] = useState<'idle' | 'generating' | 'error'>('idle');
  const [genError, setGenError] = useState<string | null>(null);

  // Reset generation state on description change
  useEffect(() => {
    setTaskId(null);
    setGenStatus('idle');
    setGenError(null);
    regenerateMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description?.id]);

  // TQ polling query (pattern from useImageModal)
  const POLLING_INTERVAL = 3000;
  const { data: taskStatus } = useQuery({
    queryKey: imageKeys.taskStatus(taskId!),
    queryFn: () => imagesAPI.getTaskStatus(taskId!),
    enabled: !!taskId && isOpen,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'SUCCESS' || status === 'FAILURE') return false;
      return POLLING_INTERVAL;
    },
    refetchOnWindowFocus: false,
    retry: 2,
  });

  // React to polling completion
  useEffect(() => {
    if (!taskStatus || !taskId) return;

    if (taskStatus.status === 'SUCCESS' && taskStatus.result?.success) {
      setGenStatus('idle');
      setTaskId(null);
      // Invalidate TQ cache so useImageForDescription refetches
      const userId = getCurrentUserId();
      queryClient.invalidateQueries({
        queryKey: imageKeys.byDescription(userId, description?.id ?? ''),
      });
      queryClient.invalidateQueries({
        queryKey: imageKeys.byBook(userId, bookId),
      });
      queryClient.invalidateQueries({ queryKey: imageKeys.userStats(userId) });
      // Cache the new image
      if (taskStatus.result.image_url && description) {
        imageCache.set(userId, description.id, taskStatus.result.image_url, bookId).catch(() => {});
      }
    } else if (taskStatus.status === 'FAILURE') {
      const errorMessage =
        taskStatus.result?.error_message ||
        taskStatus.message ||
        t('reader.description_drawer.generation_failed');
      setGenError(errorMessage);
      setGenStatus('error');
      setTaskId(null);
      notify.error(
        t('reader.description_drawer.generation_error_title', 'Generation error'),
        errorMessage
      );
    }
  }, [taskStatus, taskId, description?.id, bookId, queryClient, t, description]);

  const [activeSnap, setActiveSnap] = useState<number | string | null>(SNAP_POINTS[0]);

  // Reset snap point when opening
  useEffect(() => {
    if (isOpen) {
      setActiveSnap(SNAP_POINTS[0]);
    }
  }, [isOpen]);

  if (!description) return null;

  const handleGenerate = useCallback(async () => {
    if (!description) return;
    setGenStatus('generating');
    setGenError(null);
    try {
      const result = await imagesAPI.generateAsync(description.id, {});
      setTaskId(result.task_id);
    } catch (error: unknown) {
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
        // Image already exists -- just invalidate TQ cache to refetch
        const userId = getCurrentUserId();
        queryClient.invalidateQueries({
          queryKey: imageKeys.byDescription(userId, description.id),
        });
        setGenStatus('idle');
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        setGenError(errorMessage);
        setGenStatus('error');
        notify.error(
          t('reader.description_drawer.generation_error_title', 'Generation error'),
          errorMessage
        );
      }
    }
  }, [description, queryClient, t]);

  const renderImageButton = () => {
    const isRegenerating = regenerateMutation.isPending;

    // Loading image from TQ cache
    if (isImageLoading) {
      return (
        <div className="mt-4 w-full py-2.5 min-h-[44px] rounded-lg bg-primary/10 text-primary/50 text-sm font-medium flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      );
    }

    // Image exists — show "View" + "Regenerate" buttons
    if (image?.status === 'completed') {
      return (
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => onOpenImage(description!, image)}
            className="flex-1 py-2.5 min-h-[44px] rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
          >
            {t('reader.description_drawer.view_image')}
          </button>
          <button
            onClick={() => {
              regenerateMutation.mutate(
                { imageId: image.id, bookId },
                {
                  onError: (error: unknown) => {
                    notify.error(
                      t('reader.description_drawer.regeneration_error', 'Ошибка регенерации'),
                      error instanceof Error ? error.message : String(error)
                    );
                  },
                }
              );
            }}
            disabled={isRegenerating}
            className="py-2.5 px-3 min-h-[44px] rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {isRegenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </button>
        </div>
      );
    }

    // Generation in progress
    if (genStatus === 'generating') {
      return (
        <button
          disabled
          className="mt-4 w-full py-2.5 min-h-[44px] rounded-lg bg-primary/10 text-primary/50 text-sm font-medium flex items-center justify-center gap-2"
        >
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('reader.description_drawer.generating')}
        </button>
      );
    }

    // Generation error — show retry button with error text
    if (genStatus === 'error') {
      return (
        <div className="mt-4 space-y-2">
          <button
            onClick={handleGenerate}
            className="w-full py-2.5 min-h-[44px] rounded-lg bg-destructive/10 text-destructive text-sm font-medium hover:bg-destructive/20 transition-colors"
          >
            {t('reader.description_drawer.retry', 'Retry')}
          </button>
          {genError && <p className="text-xs text-destructive/70 px-1">{genError}</p>}
        </div>
      );
    }

    // Default: "Generate" button
    return (
      <button
        onClick={handleGenerate}
        className="mt-4 w-full py-2.5 min-h-[44px] rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
      >
        {t('reader.description_drawer.generate')}
      </button>
    );
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      snapPoints={SNAP_POINTS}
      activeSnapPoint={activeSnap}
      setActiveSnapPoint={setActiveSnap}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 bg-[var(--color-bg-base)] rounded-t-xl z-50 h-[95dvh] outline-hidden focus-visible:ring-2 focus-visible:ring-primary">
          {/* Handle bar */}
          <div className="mx-auto w-10 h-1 rounded-full bg-muted-foreground/30 my-3 flex-shrink-0" />

          {/* Scrollable content */}
          <div className="overflow-y-auto px-5 pb-6 pb-safe">
            {/* Type badge */}
            <Drawer.Title className="sr-only">
              {t(`reader.description_drawer.type.${description.type}`)}
            </Drawer.Title>
            <span className="inline-block text-xs text-[var(--color-text-muted)] px-2 py-1 bg-[var(--color-bg-subtle)] rounded mb-3">
              {t(`reader.description_drawer.type.${description.type}`)}
            </span>

            {/* Full description text */}
            <p className="text-sm text-[var(--color-text-default)] leading-relaxed whitespace-pre-line">
              {description.content}
            </p>

            {/* Image button: always visible */}
            {renderImageButton()}

            {/* Image preview: from TQ query (SSoT after async generation + invalidation) */}
            {image?.status === 'completed' && (
              <button
                onClick={() => onOpenImage(description!, image)}
                className="mt-3 w-full rounded-lg overflow-hidden relative"
              >
                <img
                  src={image.image_url}
                  alt={description.content.slice(0, 80)}
                  className="w-full h-auto rounded-lg"
                />
                {/* Overlay spinner during regeneration */}
                {regenerateMutation.isPending && (
                  <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-white" />
                  </div>
                )}
              </button>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
};
