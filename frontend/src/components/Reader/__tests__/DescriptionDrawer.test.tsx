/**
 * Tests for DescriptionDrawer component
 *
 * Verifies: renders type badge, full text, generate/view buttons,
 * spinner during generation, error state display, 409 conflict handling.
 * Updated for async generation flow with TQ polling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { DescriptionDrawer } from '../DescriptionDrawer';
import type { Description, GeneratedImage } from '@/types/api';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => {
      const translations: Record<string, string> = {
        'reader.description_drawer.generate': 'Generate',
        'reader.description_drawer.generating': 'Generating...',
        'reader.description_drawer.view_image': 'View image',
        'reader.description_drawer.retry': 'Retry',
        'reader.description_drawer.type.location': 'Location',
        'reader.description_drawer.type.character': 'Character',
        'reader.description_drawer.type.atmosphere': 'Atmosphere',
        'reader.description_drawer.type.object': 'Object',
        'reader.description_drawer.type.action': 'Action',
        'reader.description_drawer.regeneration_error': 'Regeneration error',
        'reader.description_drawer.generation_error_title': 'Generation error',
      };
      return translations[key] || fallback || key;
    },
  }),
}));

// Mock vaul
vi.mock('vaul', () => ({
  Drawer: {
    Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
      open ? React.createElement('div', { 'data-testid': 'drawer-root' }, children) : null,
    Portal: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'drawer-portal' }, children),
    Overlay: ({ className }: { className: string }) =>
      React.createElement('div', { 'data-testid': 'drawer-overlay', className }),
    Content: ({ children, className }: { children: React.ReactNode; className: string }) =>
      React.createElement('div', { 'data-testid': 'drawer-content', className }, children),
    Title: ({ children, className }: { children: React.ReactNode; className?: string }) =>
      React.createElement('div', { 'data-testid': 'drawer-title', className }, children),
  },
}));

// --- TanStack Query mocks ---
const mockInvalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({ data: undefined })),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

// --- Images API mocks ---
const mockGenerateAsync = vi.fn();
const mockGetTaskStatus = vi.fn();
vi.mock('@/api/images', () => ({
  imagesAPI: {
    generateAsync: (...args: unknown[]) => mockGenerateAsync(...args),
    getTaskStatus: (...args: unknown[]) => mockGetTaskStatus(...args),
  },
}));

// --- imageCache mock ---
vi.mock('@/services/imageCache', () => ({
  imageCache: {
    set: vi.fn().mockResolvedValue(true),
  },
}));

// --- queryKeys mock ---
vi.mock('@/hooks/api/queryKeys', () => ({
  imageKeys: {
    taskStatus: (id: string) => ['images', 'task', id],
    byDescription: (uid: string, did: string) => ['images', 'desc', uid, did],
    byBook: (uid: string, bid: string) => ['images', 'book', uid, bid],
    userStats: (uid: string) => ['images', 'stats', uid],
  },
  getCurrentUserId: () => 'test-user',
}));

// Track regenerateImage mock state
const mockRegenMutate = vi.fn();
const mockRegenReset = vi.fn();
let mockRegenMutationState = {
  isPending: false,
  isError: false,
  data: null as { image_url: string; description_id: string } | null,
  mutate: mockRegenMutate,
  reset: mockRegenReset,
};

// Track useImageForDescription mock state
let mockImageQueryState = {
  data: undefined as GeneratedImage | undefined,
  isLoading: false,
};

// Mock useRegenerateImage (useGenerateImage is no longer used)
vi.mock('@/hooks/api/useImages/useImageMutations', () => ({
  useRegenerateImage: () => mockRegenMutationState,
}));

// Mock useImageForDescription
vi.mock('@/hooks/api/useImages/useImageQueries', () => ({
  useImageForDescription: () => mockImageQueryState,
}));

// Mock notify
const mockNotifyError = vi.fn();
vi.mock('@/stores/ui', () => ({
  notify: {
    error: (...args: unknown[]) => mockNotifyError(...args),
    success: vi.fn(),
  },
}));

const mockDescription = {
  id: 'desc-1',
  content: 'A grand hall with marble columns and golden chandeliers.',
  type: 'location',
  chapter_number: 3,
  confidence_score: 0.9,
  priority_score: 0.8,
} as Description;

const mockCompletedImage: GeneratedImage = {
  id: 'img-1',
  description_id: 'desc-1',
  image_url: 'https://example.com/image.jpg',
  status: 'completed',
} as GeneratedImage;

describe('DescriptionDrawer', () => {
  const defaultProps = {
    description: mockDescription,
    isOpen: true,
    onClose: vi.fn(),
    onOpenImage: vi.fn(),
    bookId: 'book-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRegenMutationState = {
      isPending: false,
      isError: false,
      data: null,
      mutate: mockRegenMutate,
      reset: mockRegenReset,
    };
    mockImageQueryState = {
      data: undefined,
      isLoading: false,
    };
    mockGenerateAsync.mockReset();
    mockGetTaskStatus.mockReset();
  });

  it('renders type badge via i18n', () => {
    render(<DescriptionDrawer {...defaultProps} />);

    // Two "Location" elements: sr-only title + visible badge
    const elements = screen.getAllByText('Location');
    expect(elements.length).toBeGreaterThanOrEqual(1);
    // The visible badge should be a span
    const badge = elements.find((el) => el.tagName === 'SPAN');
    expect(badge).toBeInTheDocument();
  });

  it('renders full description text', () => {
    render(<DescriptionDrawer {...defaultProps} />);

    expect(
      screen.getByText('A grand hall with marble columns and golden chandeliers.')
    ).toBeInTheDocument();
  });

  it('shows "Generate" button when no image', () => {
    render(<DescriptionDrawer {...defaultProps} />);

    const btn = screen.getByText('Generate');
    expect(btn).toBeInTheDocument();
  });

  it('shows "View image" button when TQ query returns completed image', () => {
    mockImageQueryState = {
      data: mockCompletedImage,
      isLoading: false,
    };

    render(<DescriptionDrawer {...defaultProps} />);

    expect(screen.getByText('View image')).toBeInTheDocument();
  });

  it('shows spinner and "Generating..." after clicking Generate', async () => {
    // generateAsync returns a promise that doesn't resolve immediately
    mockGenerateAsync.mockReturnValue(new Promise(() => {}));

    render(<DescriptionDrawer {...defaultProps} />);

    const btn = screen.getByText('Generate');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText('Generating...')).toBeInTheDocument();
    });
    // Button should be disabled
    expect(screen.getByText('Generating...').closest('button')).toBeDisabled();
  });

  it('calls generateAsync with description id when Generate is clicked', async () => {
    mockGenerateAsync.mockResolvedValue({ task_id: 'task-1' });

    render(<DescriptionDrawer {...defaultProps} />);

    const btn = screen.getByText('Generate');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockGenerateAsync).toHaveBeenCalledWith('desc-1', {});
    });
  });

  it('shows error message when generation fails', async () => {
    mockGenerateAsync.mockRejectedValue(new Error('OpenRouter timeout'));

    render(<DescriptionDrawer {...defaultProps} />);

    const btn = screen.getByText('Generate');
    fireEvent.click(btn);

    // Wait for error state
    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
    expect(screen.getByText('OpenRouter timeout')).toBeInTheDocument();
    expect(mockNotifyError).toHaveBeenCalledWith('Generation error', 'OpenRouter timeout');
  });

  it('handles 409 conflict by invalidating query cache', async () => {
    mockGenerateAsync.mockRejectedValue({
      response: { status: 409 },
      message: 'already exists',
    });

    render(<DescriptionDrawer {...defaultProps} />);

    const btn = screen.getByText('Generate');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockInvalidateQueries).toHaveBeenCalled();
    });
    // Should not show error state -- back to idle
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
    // Generate button should be back (idle state)
    expect(screen.getByText('Generate')).toBeInTheDocument();
  });

  it('clicking "View image" calls onOpenImage with description and image from TQ', () => {
    const onOpenImage = vi.fn();
    mockImageQueryState = {
      data: mockCompletedImage,
      isLoading: false,
    };

    render(<DescriptionDrawer {...defaultProps} onOpenImage={onOpenImage} />);

    fireEvent.click(screen.getByText('View image'));

    expect(onOpenImage).toHaveBeenCalledWith(mockDescription, mockCompletedImage);
  });

  it('does not render when description is null', () => {
    render(<DescriptionDrawer {...defaultProps} description={null} />);

    expect(screen.queryByTestId('drawer-root')).not.toBeInTheDocument();
  });

  it('shows image preview from TQ query when image is completed', () => {
    mockImageQueryState = {
      data: mockCompletedImage,
      isLoading: false,
    };

    render(<DescriptionDrawer {...defaultProps} />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/image.jpg');
  });

  it('clicking preview calls onOpenImage', () => {
    const onOpenImage = vi.fn();
    mockImageQueryState = {
      data: mockCompletedImage,
      isLoading: false,
    };

    render(<DescriptionDrawer {...defaultProps} onOpenImage={onOpenImage} />);

    const img = screen.getByRole('img');
    fireEvent.click(img.closest('button')!);

    expect(onOpenImage).toHaveBeenCalledWith(mockDescription, mockCompletedImage);
  });
});
