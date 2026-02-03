/**
 * useReaderImageModal - Custom hook for image modal state management
 *
 * Manages image modal visibility and selected image/description state.
 *
 * @returns Modal state and control functions
 *
 * @example
 * const { selectedImage, isOpen, openModal, closeModal } = useReaderImageModal();
 */

import { useState, useCallback } from 'react';
import type { Description } from '@/types/api';
import { logger } from '@/lib/logger';

interface SelectedImageState {
  imageUrl: string;
  description: Description | null;
  imageId: string | null;
}

interface UseReaderImageModalReturn {
  selectedImage: SelectedImageState | null;
  isOpen: boolean;
  openModal: (description: Description, imageUrl: string, imageId: string) => void;
  closeModal: () => void;
  updateImageUrl: (newUrl: string) => void;
}

export const useReaderImageModal = (): UseReaderImageModalReturn => {
  const [selectedImage, setSelectedImage] = useState<SelectedImageState | null>(null);

  const openModal = useCallback((description: Description, imageUrl: string, imageId: string) => {
    logger.debug('🖼️ [useReaderImageModal] Opening modal:', {
      descriptionId: description.id,
      imageId,
    });

    setSelectedImage({
      imageUrl,
      description,
      imageId,
    });
  }, []);

  const closeModal = useCallback(() => {
    logger.debug('🖼️ [useReaderImageModal] Closing modal');
    setSelectedImage(null);
  }, []);

  const updateImageUrl = useCallback((newUrl: string) => {
    logger.debug('🖼️ [useReaderImageModal] Updating image URL');
    setSelectedImage(prev => {
      if (!prev) return null;
      return {
        ...prev,
        imageUrl: newUrl,
      };
    });
  }, []);

  return {
    selectedImage,
    isOpen: selectedImage !== null,
    openModal,
    closeModal,
    updateImageUrl,
  };
};
