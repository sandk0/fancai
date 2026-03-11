/**
 * Tests for EntityBottomSheet component
 *
 * Verifies ENT-01: renders entity name, type, truncated description,
 * "Details" button calls onOpenDrawer, placeholder icons by type.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { EntityBottomSheet } from '../EntityBottomSheet';
import type { EntityDetail } from '@/types/entity';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => {
      const translations: Record<string, string> = {
        'entities.type_character': 'Character',
        'entities.type_location': 'Location',
        'entities.type_object': 'Object',
        'reader.entity_popup.details': 'Details',
      };
      return translations[key] || (typeof fallback === 'string' ? fallback : key);
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

const mockEntity: EntityDetail = {
  id: 'entity-1',
  name: 'Harry Potter',
  type: 'character',
  biography: 'A young wizard who attends Hogwarts School of Witchcraft and Wizardry.',
  importance: 10,
  mentions: [1, 2, 3],
  aliases: ['The Boy Who Lived'],
} as EntityDetail;

const mockEntityWithLongBio: EntityDetail = {
  ...mockEntity,
  id: 'entity-2',
  biography: 'A'.repeat(150),
};

const mockLocationEntity: EntityDetail = {
  ...mockEntity,
  id: 'entity-3',
  name: 'Hogwarts Castle',
  type: 'location',
  biography: 'A magical school for witchcraft and wizardry.',
};

const mockObjectEntity: EntityDetail = {
  ...mockEntity,
  id: 'entity-4',
  name: 'Elder Wand',
  type: 'object',
  biography: 'The most powerful wand in existence.',
};

describe('EntityBottomSheet', () => {
  const defaultProps = {
    entity: mockEntity,
    isOpen: true,
    onClose: vi.fn(),
    onOpenDrawer: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders entity name', () => {
    render(<EntityBottomSheet {...defaultProps} />);

    expect(screen.getByText('Harry Potter')).toBeInTheDocument();
  });

  it('renders entity type via i18n', () => {
    render(<EntityBottomSheet {...defaultProps} />);

    expect(screen.getByText('Character')).toBeInTheDocument();
  });

  it('truncates description to 100 characters', () => {
    render(<EntityBottomSheet {...defaultProps} entity={mockEntityWithLongBio} />);

    const truncated = 'A'.repeat(100) + '...';
    expect(screen.getByText(truncated)).toBeInTheDocument();
  });

  it('shows full description when less than 100 chars', () => {
    render(<EntityBottomSheet {...defaultProps} />);

    expect(
      screen.getByText('A young wizard who attends Hogwarts School of Witchcraft and Wizardry.')
    ).toBeInTheDocument();
  });

  it('"Details" button calls onOpenDrawer and onClose', () => {
    const onOpenDrawer = vi.fn();
    const onClose = vi.fn();

    render(<EntityBottomSheet {...defaultProps} onOpenDrawer={onOpenDrawer} onClose={onClose} />);

    const detailsBtn = screen.getByText('Details');
    fireEvent.click(detailsBtn);

    expect(onOpenDrawer).toHaveBeenCalledWith('entity-1');
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render when entity is null', () => {
    render(<EntityBottomSheet {...defaultProps} entity={null} isOpen={false} />);

    expect(screen.queryByText('Harry Potter')).not.toBeInTheDocument();
  });

  it('renders location type label', () => {
    render(<EntityBottomSheet {...defaultProps} entity={mockLocationEntity} />);

    expect(screen.getByText('Location')).toBeInTheDocument();
  });

  it('renders object type label', () => {
    render(<EntityBottomSheet {...defaultProps} entity={mockObjectEntity} />);

    expect(screen.getByText('Object')).toBeInTheDocument();
  });

  it('renders avatar image when avatar_url is present', () => {
    const entityWithAvatar = {
      ...mockEntity,
      avatar_url: 'https://example.com/avatar.jpg',
    };

    render(<EntityBottomSheet {...defaultProps} entity={entityWithAvatar} />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg');
  });
});
