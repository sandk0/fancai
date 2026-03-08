/**
 * Tests for EntityPopup component
 *
 * Verifies READ-05: renders entity name and description,
 * "More" link calls onOpenDrawer, click outside closes popup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { EntityPopup } from '../EntityPopup';
import type { EntityDetail } from '@/types/entity';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

// Mock motion/react to render children immediately
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  m: {
    div: React.forwardRef(
      (
        { children, ...props }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>,
        ref: React.Ref<HTMLDivElement>
      ) => {
        // Filter out motion-specific props
        const { initial, animate, exit, transition, ...domProps } = props as Record<
          string,
          unknown
        >;
        return React.createElement('div', { ...domProps, ref }, children);
      }
    ),
  },
}));

const mockEntity: EntityDetail = {
  id: 'entity-1',
  name: 'Harry Potter',
  type: 'character',
  biography: 'A young wizard who attends Hogwarts School of Witchcraft and Wizardry.',
  aliases: ['The Boy Who Lived'],
} as EntityDetail;

describe('EntityPopup', () => {
  const defaultProps = {
    entity: mockEntity,
    position: { x: 200, y: 300 },
    onClose: vi.fn(),
    onOpenDrawer: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should render entity name', () => {
    render(<EntityPopup {...defaultProps} />);

    expect(screen.getByText('Harry Potter')).toBeInTheDocument();
  });

  it('should render entity description (truncated to 100 chars)', () => {
    render(<EntityPopup {...defaultProps} />);

    // The biography is less than 100 chars, so it should be shown in full
    expect(
      screen.getByText('A young wizard who attends Hogwarts School of Witchcraft and Wizardry.')
    ).toBeInTheDocument();
  });

  it('should truncate long descriptions', () => {
    const longDescription = 'A'.repeat(150);
    const entityWithLongDesc = {
      ...mockEntity,
      biography: longDescription,
    };

    render(<EntityPopup {...defaultProps} entity={entityWithLongDesc} />);

    // Should be truncated at 100 chars + "..."
    const truncated = longDescription.slice(0, 100) + '...';
    expect(screen.getByText(truncated)).toBeInTheDocument();
  });

  it('should call onOpenDrawer when "More" link is clicked', () => {
    const onOpenDrawer = vi.fn();

    render(<EntityPopup {...defaultProps} onOpenDrawer={onOpenDrawer} />);

    // Find the details link — it uses t('reader.entity_popup.details')
    const detailsButton = screen.getByText('reader.entity_popup.details');
    fireEvent.click(detailsButton);

    expect(onOpenDrawer).toHaveBeenCalledWith('entity-1');
  });

  it('should call onClose when clicking outside the popup', async () => {
    const onClose = vi.fn();

    render(
      <div>
        <div data-testid="outside">Outside</div>
        <EntityPopup {...defaultProps} onClose={onClose} />
      </div>
    );

    // The popup registers click-outside listener after a 100ms delay
    act(() => {
      vi.advanceTimersByTime(150);
    });

    // Click outside the popup
    fireEvent.mouseDown(screen.getByTestId('outside'));

    expect(onClose).toHaveBeenCalled();
  });

  it('should call onClose on Escape key press', () => {
    const onClose = vi.fn();

    render(<EntityPopup {...defaultProps} onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('should not render when entity is null', () => {
    const { container } = render(<EntityPopup {...defaultProps} entity={null} position={null} />);

    // Should not render the popup content
    expect(screen.queryByText('Harry Potter')).not.toBeInTheDocument();
  });

  it('should show entity type', () => {
    render(<EntityPopup {...defaultProps} />);

    // The type is rendered via t(`entities.types.${entity.type}`, entity.type)
    // With our mock t(key, fallback) returns fallback when it's a string, so 'character'
    expect(screen.getByText('character')).toBeInTheDocument();
  });
});
