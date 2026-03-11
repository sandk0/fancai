/**
 * Tests for DescriptionDrawer component
 *
 * Verifies ENT-01: renders type badge, full text, generate/view buttons,
 * spinner during generation, image preview after generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DescriptionDrawer } from '../DescriptionDrawer';
import type { Description, GeneratedImage } from '@/types/api';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'reader.description_drawer.generate': 'Generate',
        'reader.description_drawer.generating': 'Generating...',
        'reader.description_drawer.view_image': 'View image',
        'reader.description_drawer.type.location': 'Location',
        'reader.description_drawer.type.character': 'Character',
        'reader.description_drawer.type.atmosphere': 'Atmosphere',
        'reader.description_drawer.type.object': 'Object',
        'reader.description_drawer.type.action': 'Action',
      };
      return translations[key] || key;
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

// Track generateImage mock state
const mockMutate = vi.fn();
let mockMutationState = {
  isPending: false,
  data: null as { image_url: string; description_id: string } | null,
  mutate: mockMutate,
};

// Mock useGenerateImage
vi.mock('@/hooks/api/useImages/useImageMutations', () => ({
  useGenerateImage: () => mockMutationState,
}));

const mockDescription: Description = {
  id: 'desc-1',
  content: 'A grand hall with marble columns and golden chandeliers.',
  type: 'location',
  chapter_number: 3,
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
    mockMutationState = {
      isPending: false,
      data: null,
      mutate: mockMutate,
    };
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

  it('shows "View image" button when image with status=completed', () => {
    render(<DescriptionDrawer {...defaultProps} image={mockCompletedImage} />);

    expect(screen.getByText('View image')).toBeInTheDocument();
  });

  it('shows spinner and "Generating..." when isPending', () => {
    mockMutationState = {
      isPending: true,
      data: null,
      mutate: mockMutate,
    };

    render(<DescriptionDrawer {...defaultProps} />);

    const btn = screen.getByText('Generating...');
    expect(btn).toBeInTheDocument();
    // Button should be disabled
    expect(btn.closest('button')).toBeDisabled();
  });

  it('shows image preview after successful generation', () => {
    mockMutationState = {
      isPending: false,
      data: { image_url: 'https://example.com/generated.jpg', description_id: 'desc-1' },
      mutate: mockMutate,
    };

    render(<DescriptionDrawer {...defaultProps} />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/generated.jpg');
  });

  it('clicking preview calls onOpenImage', () => {
    const onOpenImage = vi.fn();
    mockMutationState = {
      isPending: false,
      data: { image_url: 'https://example.com/generated.jpg', description_id: 'desc-1' },
      mutate: mockMutate,
    };

    render(<DescriptionDrawer {...defaultProps} onOpenImage={onOpenImage} />);

    const img = screen.getByRole('img');
    fireEvent.click(img.closest('button')!);

    expect(onOpenImage).toHaveBeenCalledWith(mockDescription, undefined);
  });

  it('does not render when description is null', () => {
    const { container } = render(<DescriptionDrawer {...defaultProps} description={null} />);

    expect(screen.queryByTestId('drawer-root')).not.toBeInTheDocument();
  });

  it('calls mutate with correct params when Generate is clicked', () => {
    render(<DescriptionDrawer {...defaultProps} />);

    const btn = screen.getByText('Generate');
    fireEvent.click(btn);

    expect(mockMutate).toHaveBeenCalledWith({
      descriptionId: 'desc-1',
      bookId: 'book-1',
    });
  });

  it('clicking "View image" calls onOpenImage with description and image', () => {
    const onOpenImage = vi.fn();

    render(
      <DescriptionDrawer {...defaultProps} image={mockCompletedImage} onOpenImage={onOpenImage} />
    );

    fireEvent.click(screen.getByText('View image'));

    expect(onOpenImage).toHaveBeenCalledWith(mockDescription, mockCompletedImage);
  });
});
