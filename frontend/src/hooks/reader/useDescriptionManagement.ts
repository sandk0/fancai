/**
import { getErrorMessage } from "@/utils/errors";
 * useDescriptionManagement - Custom hook for description highlighting and interaction
 *
 * Manages description highlighting in text content and handles click interactions.
 * Prevents highlight nesting and supports HTML content.
 *
 * @param descriptions - Array of descriptions to highlight
 * @param onDescriptionClick - Callback when description is clicked
 * @returns Highlight utilities and highlighted descriptions state
 *
 * @example
 * const { highlightedText, handleDescriptionClick } = useDescriptionManagement(
 *   descriptions,
 *   async (desc) => { ... }
 * );
 */

import { useState, useCallback } from 'react';
import { imagesAPI } from '@/api/images';
import { notify } from '@/stores/ui';
import { useTranslation } from '@/hooks/useTranslation';
import type { Description } from '@/types/api';

interface UseDescriptionManagementOptions {
  descriptions: Description[];
  onImageGenerated?: (description: Description, imageUrl: string, imageId: string) => void;
}

interface UseDescriptionManagementReturn {
  highlightedDescriptions: Description[];
  setHighlightedDescriptions: (descriptions: Description[]) => void;
  highlightDescription: (text: string, descriptions: Description[]) => string;
  handleDescriptionClick: (descriptionId: string) => Promise<void>;
  cleanExistingHighlights: (text: string) => string;
}

export const useDescriptionManagement = ({
  descriptions,
  onImageGenerated,
}: UseDescriptionManagementOptions): UseDescriptionManagementReturn => {
  const { t } = useTranslation();
  const [highlightedDescriptions, setHighlightedDescriptions] = useState<Description[]>(descriptions);

  /**
   * Remove existing highlights to prevent nesting
   */
  const cleanExistingHighlights = useCallback((text: string): string => {
    return text.replace(/<span[^>]*class="[^"]*description-highlight[^"]*"[^>]*>/gi, '')
               .replace(/<\/span>/gi, '');
  }, []);

  /**
   * Highlight descriptions in text
   */
  const highlightDescription = useCallback((text: string, descs: Description[]): string => {
    if (!descs || descs.length === 0) {
      return text;
    }

    // Clean existing highlights
    let highlightedText = cleanExistingHighlights(text);

    // Sort by length (longest first)
    const sortedDescriptions = [...descs].sort((a, b) => {
      const aText = a.content || '';
      const bText = b.content || '';
      return bText.length - aText.length;
    });

    sortedDescriptions.forEach((desc) => {
      const descText = desc.content;
      if (!descText || descText.length < 10) return; // Skip very short descriptions

      // Escape regex special characters
      const escapedText = descText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?<!<[^>]*>)${escapedText}(?![^<]*>)`, 'gi');

      // Replace with highlighted span
      highlightedText = highlightedText.replace(regex, (match) => {
        // Check we're not inside an existing highlight
        const beforeMatch = highlightedText.substring(0, highlightedText.indexOf(match));
        const openHighlights = (beforeMatch.match(/<span[^>]*class="[^"]*description-highlight[^"]*"[^>]*>/g) || []).length;
        const closeHighlights = (beforeMatch.match(/<\/span>/g) || []).length;

        // Skip if inside highlight span
        if (openHighlights > closeHighlights) {
          return match;
        }

        return `<span class="description-highlight" data-description-id="${desc.id}">${match}</span>`;
      });
    });

    return highlightedText;
  }, [cleanExistingHighlights]);

  /**
   * Handle description click - show image or generate if missing
   */
  const handleDescriptionClick = useCallback(async (descriptionId: string) => {
    console.log('🖱️ [useDescriptionManagement] Description clicked:', descriptionId);
    const description = highlightedDescriptions.find(d => d.id === descriptionId);
    console.log('📋 [useDescriptionManagement] Found:', description);

    if (!description) {
      console.log('❌ [useDescriptionManagement] Description not found:', descriptionId);
      notify.error(t('common.error'), t('reader.descriptionNotFound'));
      return;
    }

    if (description.generated_image) {
      console.log('🖼️ [useDescriptionManagement] Has image, opening modal');
      onImageGenerated?.(
        description,
        description.generated_image.image_url,
        description.generated_image.id
      );
    } else {
      console.log('🎨 [useDescriptionManagement] No image, generating...');
      try {
        notify.info(t('reader.imageGeneration'), t('reader.generatingImageDesc'));
        const result = await imagesAPI.generateImageForDescription(descriptionId);

        // Update description with new image
        const updatedDescriptions = highlightedDescriptions.map(d => {
          if (d.id === descriptionId) {
            return {
              ...d,
              generated_image: {
                id: result.image_id,
                description_id: descriptionId,
                image_url: result.image_url,
                service_used: 'pollinations',
                status: (result.status === 'pending' || result.status === 'generating' ||
                         result.status === 'completed' || result.status === 'failed' ||
                         result.status === 'moderated') ? result.status : 'completed' as const,
                is_moderated: false,
                view_count: 0,
                download_count: 0,
                generation_time_seconds: result.generation_time,
                created_at: result.created_at,
                description: {
                  id: descriptionId,
                  type: d.type,
                  text: d.content,
                  content: d.content,
                  confidence_score: d.confidence_score,
                  priority_score: d.priority_score,
                },
                chapter: {
                  id: '',
                  number: 0,
                  title: '',
                }
              } as any
            };
          }
          return d;
        });

        setHighlightedDescriptions(updatedDescriptions as any);
        onImageGenerated?.(description, result.image_url, result.image_id);

        notify.success(
          t('reader.imageGenerated'),
          t('reader.imageCreated').replace('{time}', result.generation_time.toFixed(1))
        );
      } catch (error) {
        console.error('[useDescriptionManagement] Image generation failed:', error);
        const axiosError = error as { response?: { status?: number } };
        if (axiosError.response?.status === 409) {
          notify.warning(t('reader.imageExists'), t('reader.imageExistsDesc'));
        } else {
          notify.error(t('reader.generationFailed'), t('reader.generationFailedDesc'));
        }
      }
    }
  }, [highlightedDescriptions, onImageGenerated, t]);

  return {
    highlightedDescriptions,
    setHighlightedDescriptions,
    highlightDescription,
    handleDescriptionClick,
    cleanExistingHighlights,
  };
};
