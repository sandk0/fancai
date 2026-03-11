/**
 * Tests for HighlightTooltip component
 *
 * Verifies SEL-02: renders compact tooltip on highlight tap,
 * shows note text, Edit/Delete callbacks, click outside closes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { HighlightTooltip } from '../HighlightTooltip';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
  }),
}));

const mockPopup = {
  bookmarkId: 'bm-1',
  cfiRange: 'epubcfi(/6/2!/4/2)',
  note: 'Test note text',
  color: '#fef08a',
  text_color: null,
  style: 'none',
  position: { x: 200, y: 300 },
};

describe('HighlightTooltip', () => {
  const defaultProps = {
    popup: mockPopup,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders null when popup === null', () => {
    const { container } = render(<HighlightTooltip {...defaultProps} popup={null} />);

    expect(container.innerHTML).toBe('');
  });

  it('renders note text when popup.note is provided', () => {
    render(<HighlightTooltip {...defaultProps} />);

    expect(screen.getByText('Test note text')).toBeInTheDocument();
  });

  it('does not render note block when note is null', () => {
    const popupNoNote = { ...mockPopup, note: null };
    render(<HighlightTooltip {...defaultProps} popup={popupNoNote} />);

    expect(screen.queryByText('Test note text')).not.toBeInTheDocument();
  });

  it('calls onEdit with bookmarkId when Edit button is clicked', () => {
    const onEdit = vi.fn();
    render(<HighlightTooltip {...defaultProps} onEdit={onEdit} />);

    const editButton = screen.getByLabelText('Edit');
    fireEvent.click(editButton);

    expect(onEdit).toHaveBeenCalledWith('bm-1');
  });

  it('calls onDelete with bookmarkId when Delete button is clicked', () => {
    const onDelete = vi.fn();
    render(<HighlightTooltip {...defaultProps} onDelete={onDelete} />);

    const deleteButton = screen.getByLabelText('Delete');
    fireEvent.click(deleteButton);

    expect(onDelete).toHaveBeenCalledWith('bm-1');
  });

  it('calls onClose when clicking outside the tooltip', () => {
    const onClose = vi.fn();

    render(
      <div>
        <div data-testid="outside">Outside</div>
        <HighlightTooltip {...defaultProps} onClose={onClose} />
      </div>
    );

    // The tooltip registers pointerdown listener after a 100ms delay
    act(() => {
      vi.advanceTimersByTime(150);
    });

    fireEvent.pointerDown(screen.getByTestId('outside'));

    expect(onClose).toHaveBeenCalled();
  });
});
