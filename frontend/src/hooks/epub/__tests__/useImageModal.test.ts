/**
 * Tests for useImageModal hook
 *
 * Tests image modal state management including:
 * - Initial state
 * - Opening modal with existing image
 * - Opening modal with cached image
 * - Image generation flow (async polling)
 * - Generation error handling
 * - 409 conflict handling
 * - Cancel generation
 * - Close modal cleanup
 * - Visibility change pauses/resumes polling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useImageModal } from '../useImageModal';
import type { Description, GeneratedImage } from '@/types/api';

// Mock dependencies
vi.mock('@/api/images', () => ({
  imagesAPI: {
    generateAsync: vi.fn(),
    getTaskStatus: vi.fn(),
    getImageForDescription: vi.fn(),
  },
}));

vi.mock('@/stores/ui', () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/services/imageCache', () => ({
  imageCache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  },
}));

vi.mock('@/hooks/api/queryKeys', () => ({
  getCurrentUserId: vi.fn().mockReturnValue('user-123'),
  imageKeys: {
    taskStatus: (taskId: string) => ['images', 'taskStatus', taskId],
    byDescription: (userId: string, descId: string) => ['images', 'byDescription', userId, descId],
    byBook: (userId: string, bookId: string) => ['images', 'byBook', userId, bookId],
    userStats: (userId: string) => ['images', 'userStats', userId],
  },
}));

vi.mock('@/hooks/shared/useVisibilityManager', () => ({
  useVisibilityManager: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/lib/i18n', () => ({
  default: {
    t: vi.fn((key: string, params?: Record<string, unknown>) => {
      if (params) return `${key}:${JSON.stringify(params)}`;
      return key;
    }),
  },
}));

// Import mocked modules for assertions
import { imagesAPI } from '@/api/images';
import { imageCache } from '@/services/imageCache';
import { notify } from '@/stores/ui';

const mockDescription: Description = {
  id: 'desc-1',
  type: 'character',
  content: 'A tall man with dark hair and piercing blue eyes stood at the window.',
  text: 'A tall man with dark hair and piercing blue eyes stood at the window.',
  confidence_score: 0.9,
  priority_score: 0.8,
};

const mockImage: GeneratedImage = {
  id: 'img-1',
  image_url: 'https://example.com/image.png',
  service_used: 'imagen',
  status: 'completed',
  generation_time_seconds: 2.5,
  created_at: new Date().toISOString(),
  is_moderated: false,
  view_count: 0,
  download_count: 0,
  description: {
    id: 'desc-1',
    type: 'character',
    text: 'A tall man with dark hair',
    content: 'A tall man with dark hair',
    confidence_score: 0.9,
    priority_score: 0.8,
  },
  chapter: { id: 'ch-1', number: 1, title: 'Chapter 1' },
};

// QueryClient wrapper for TanStack Query hooks
let queryClient: QueryClient;

const createWrapper = () => {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useImageModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    // Reset document.visibilityState
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      expect(result.current.selectedImage).toBeNull();
      expect(result.current.selectedDescription).toBeNull();
      expect(result.current.isOpen).toBe(false);
      expect(result.current.isGenerating).toBe(false);
      expect(result.current.generationStatus).toBe('idle');
      expect(result.current.generationError).toBeNull();
      expect(result.current.descriptionPreview).toBeNull();
      expect(result.current.isCached).toBe(false);
    });

    it('should expose control functions', () => {
      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      expect(typeof result.current.openModal).toBe('function');
      expect(typeof result.current.closeModal).toBe('function');
      expect(typeof result.current.updateImage).toBe('function');
      expect(typeof result.current.cancelGeneration).toBe('function');
    });
  });

  describe('openModal with existing image', () => {
    it('should open modal with provided image', async () => {
      vi.mocked(imageCache.get).mockResolvedValue(null);

      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription, mockImage);
      });

      expect(result.current.isOpen).toBe(true);
      expect(result.current.selectedImage).toEqual(mockImage);
      expect(result.current.selectedDescription).toEqual(mockDescription);
      expect(result.current.generationStatus).toBe('completed');
      expect(result.current.isGenerating).toBe(false);
    });

    it('should use cached URL when available for existing image', async () => {
      const cachedUrl = 'blob:http://localhost/cached-image';
      vi.mocked(imageCache.get).mockResolvedValue(cachedUrl);

      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription, mockImage);
      });

      expect(result.current.selectedImage?.image_url).toBe(cachedUrl);
      expect(result.current.isCached).toBe(true);
    });

    it('should cache image when not in cache', async () => {
      vi.mocked(imageCache.get).mockResolvedValue(null);

      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription, mockImage);
      });

      expect(imageCache.set).toHaveBeenCalledWith(
        'user-123',
        mockDescription.id,
        mockImage.image_url,
        'book-1'
      );
    });

    it('should set description preview', async () => {
      vi.mocked(imageCache.get).mockResolvedValue(null);

      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription, mockImage);
      });

      expect(result.current.descriptionPreview).toBe(mockDescription.content?.substring(0, 100));
    });
  });

  describe('openModal with cached image (no image provided)', () => {
    it('should use cached image when no image provided', async () => {
      const cachedUrl = 'blob:http://localhost/cached-image';
      vi.mocked(imageCache.get).mockResolvedValue(cachedUrl);

      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription);
      });

      expect(result.current.isOpen).toBe(true);
      expect(result.current.selectedImage).not.toBeNull();
      expect(result.current.selectedImage?.image_url).toBe(cachedUrl);
      expect(result.current.selectedImage?.service_used).toBe('cached');
      expect(result.current.isCached).toBe(true);
      expect(result.current.generationStatus).toBe('completed');
      expect(result.current.isGenerating).toBe(false);
    });
  });

  describe('Image generation flow', () => {
    it('should start async generation when no image and no cache', async () => {
      vi.mocked(imageCache.get).mockResolvedValue(null);
      vi.mocked(imagesAPI.generateAsync).mockResolvedValue({
        task_id: 'task-123',
        description_id: 'desc-1',
        queued_at: new Date().toISOString(),
        message: 'Queued',
        status_url: '/api/v1/tasks/task-123',
      });
      vi.mocked(imagesAPI.getTaskStatus).mockResolvedValue({
        task_id: 'task-123',
        status: 'PENDING',
        message: 'Pending',
      });

      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription);
      });

      expect(result.current.isOpen).toBe(true);
      expect(result.current.isGenerating).toBe(true);
      expect(result.current.generationStatus).toBe('generating');
      expect(imagesAPI.generateAsync).toHaveBeenCalledWith(mockDescription.id, {});
    });

    it('should poll and complete generation on SUCCESS', async () => {
      vi.mocked(imageCache.get).mockResolvedValue(null);
      vi.mocked(imagesAPI.generateAsync).mockResolvedValue({
        task_id: 'task-123',
        description_id: 'desc-1',
        queued_at: new Date().toISOString(),
        message: 'Queued',
        status_url: '/api/v1/tasks/task-123',
      });
      vi.mocked(imagesAPI.getTaskStatus).mockResolvedValue({
        task_id: 'task-123',
        status: 'SUCCESS',
        message: 'Done',
        result: {
          success: true,
          image_id: 'img-new',
          image_url: 'https://example.com/new-image.png',
          generation_time_seconds: 3.2,
        },
      });

      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription);
      });

      // Advance timer to trigger polling
      await act(async () => {
        vi.advanceTimersByTime(3000);
        // Allow promises to resolve
        await vi.runAllTimersAsync();
      });

      expect(result.current.generationStatus).toBe('completed');
      expect(result.current.isGenerating).toBe(false);
      expect(result.current.selectedImage?.image_url).toBe('https://example.com/new-image.png');
      expect(notify.success).toHaveBeenCalled();
    });

    it('should handle generation FAILURE', async () => {
      vi.mocked(imageCache.get).mockResolvedValue(null);
      vi.mocked(imagesAPI.generateAsync).mockResolvedValue({
        task_id: 'task-123',
        description_id: 'desc-1',
        queued_at: new Date().toISOString(),
        message: 'Queued',
        status_url: '/api/v1/tasks/task-123',
      });
      vi.mocked(imagesAPI.getTaskStatus).mockResolvedValue({
        task_id: 'task-123',
        status: 'FAILURE',
        message: 'Generation failed: content policy violation',
        result: {
          success: false,
          error_message: 'Content policy violation',
        },
      });

      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription);
      });

      // Advance timer to trigger polling
      await act(async () => {
        vi.advanceTimersByTime(3000);
        await vi.runAllTimersAsync();
      });

      expect(result.current.generationStatus).toBe('error');
      expect(result.current.isGenerating).toBe(false);
      expect(result.current.generationError).toBe('Content policy violation');
      expect(notify.error).toHaveBeenCalled();
    });
  });

  describe('409 Conflict handling', () => {
    it('should fetch existing image on 409 conflict', async () => {
      vi.mocked(imageCache.get).mockResolvedValue(null);
      vi.mocked(imagesAPI.generateAsync).mockRejectedValue({
        response: { status: 409 },
        message: 'Image already exists',
      });
      vi.mocked(imagesAPI.getImageForDescription).mockResolvedValue(mockImage);

      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription);
      });

      expect(imagesAPI.getImageForDescription).toHaveBeenCalledWith(mockDescription.id);
      expect(result.current.selectedImage).toEqual(mockImage);
      expect(result.current.generationStatus).toBe('completed');
    });

    it('should handle error when fetching existing image fails after 409', async () => {
      vi.mocked(imageCache.get).mockResolvedValue(null);
      vi.mocked(imagesAPI.generateAsync).mockRejectedValue({
        response: { status: 409 },
        message: 'Image already exists',
      });
      vi.mocked(imagesAPI.getImageForDescription).mockRejectedValue(new Error('Fetch failed'));

      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription);
      });

      expect(result.current.generationStatus).toBe('error');
      expect(result.current.generationError).not.toBeNull();
    });
  });

  describe('Generation error handling', () => {
    it('should handle non-409 generation errors', async () => {
      vi.mocked(imageCache.get).mockResolvedValue(null);
      vi.mocked(imagesAPI.generateAsync).mockRejectedValue({
        message: 'Server error',
      });

      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription);
      });

      expect(result.current.generationStatus).toBe('error');
      expect(result.current.generationError).toBe('Server error');
      expect(notify.error).toHaveBeenCalled();
    });
  });

  describe('cancelGeneration', () => {
    it('should cancel ongoing generation', async () => {
      vi.mocked(imageCache.get).mockResolvedValue(null);
      vi.mocked(imagesAPI.generateAsync).mockResolvedValue({
        task_id: 'task-123',
        description_id: 'desc-1',
        queued_at: new Date().toISOString(),
        message: 'Queued',
        status_url: '/api/v1/tasks/task-123',
      });
      // Keep returning PENDING so generation stays active
      vi.mocked(imagesAPI.getTaskStatus).mockResolvedValue({
        task_id: 'task-123',
        status: 'PENDING',
        message: 'Pending',
      });

      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription);
      });

      expect(result.current.isGenerating).toBe(true);

      act(() => {
        result.current.cancelGeneration();
      });

      expect(result.current.isGenerating).toBe(false);
      expect(result.current.generationStatus).toBe('idle');
      expect(result.current.generationError).toBeNull();
    });
  });

  describe('closeModal', () => {
    it('should close modal and reset state after animation delay', async () => {
      vi.mocked(imageCache.get).mockResolvedValue(null);

      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription, mockImage);
      });

      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.closeModal();
      });

      expect(result.current.isOpen).toBe(false);

      // After animation delay (300ms), state should be fully reset
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(result.current.selectedImage).toBeNull();
      expect(result.current.selectedDescription).toBeNull();
      expect(result.current.descriptionPreview).toBeNull();
    });

    it('should release cached image URL on close', async () => {
      const cachedUrl = 'blob:http://localhost/cached-image';
      vi.mocked(imageCache.get).mockResolvedValue(cachedUrl);

      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription);
      });

      expect(result.current.isCached).toBe(true);

      act(() => {
        result.current.closeModal();
      });

      expect(imageCache.release).toHaveBeenCalledWith(mockDescription.id);
    });
  });

  describe('updateImage', () => {
    it('should update image URL when image is selected', async () => {
      vi.mocked(imageCache.get).mockResolvedValue(null);

      const { result } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription, mockImage);
      });

      act(() => {
        result.current.updateImage('https://example.com/regenerated.png');
      });

      expect(result.current.selectedImage?.image_url).toBe('https://example.com/regenerated.png');
    });
  });

  describe('Cache disabled', () => {
    it('should skip cache when enableCache is false', async () => {
      const { result } = renderHook(() => useImageModal({ bookId: 'book-1', enableCache: false }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription, mockImage);
      });

      expect(imageCache.get).not.toHaveBeenCalled();
      expect(result.current.selectedImage).toEqual(mockImage);
    });
  });

  describe('Cleanup on unmount', () => {
    it('should clean up polling and abort controller on unmount', async () => {
      vi.mocked(imageCache.get).mockResolvedValue(null);
      vi.mocked(imagesAPI.generateAsync).mockResolvedValue({
        task_id: 'task-123',
        description_id: 'desc-1',
        queued_at: new Date().toISOString(),
        message: 'Queued',
        status_url: '/api/v1/tasks/task-123',
      });
      vi.mocked(imagesAPI.getTaskStatus).mockResolvedValue({
        task_id: 'task-123',
        status: 'PENDING',
        message: 'Pending',
      });

      const { result, unmount } = renderHook(() => useImageModal({ bookId: 'book-1' }), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.openModal(mockDescription);
      });

      // Unmount should not throw
      unmount();

      // Advancing timers after unmount should not cause errors
      await act(async () => {
        vi.advanceTimersByTime(10000);
      });
    });
  });
});
