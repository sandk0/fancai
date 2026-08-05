/**
 * Tests for BookmarksList component
 *
 * Verifies READ-01: bookmarks grouped by chapter, navigation on click,
 * delete callback, and empty state rendering.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BookmarksList } from '../BookmarksList';
import type { BookmarkResponse } from '@/hooks/api/useSync';

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>
    ) => {
      // Handle t(key, defaultValue) pattern
      if (typeof fallback === 'string') {
        // Interpolate {{number}} if opts provided
        if (opts && typeof opts === 'object') {
          return fallback.replace(/\{\{(\w+)\}\}/g, (_, k) =>
            String((opts as Record<string, unknown>)[k] ?? k)
          );
        }
        return fallback;
      }
      // Handle t(key, { interpolations }) pattern
      if (typeof fallback === 'object' && fallback !== null) {
        return key;
      }
      return key;
    },
  }),
}));

const makeBookmark = (overrides: Partial<BookmarkResponse> = {}): BookmarkResponse => ({
  id: 'bm-1',
  cfi_range: 'epubcfi(/6/4!/4/2/1:0,/6/4!/4/2/1:50)',
  chapter_number: 1,
  text: 'Sample text',
  color: null,
  text_color: null,
  style: 'none',
  note: null,
  created_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
  ...overrides,
});

describe('BookmarksList', () => {
  const defaultProps = {
    onNavigate: vi.fn(),
    onDelete: vi.fn(),
    onUpdateNote: vi.fn(),
  };

  it('should render empty state when no bookmarks exist', () => {
    render(<BookmarksList bookmarks={[]} {...defaultProps} />);

    expect(screen.getByText('No notes')).toBeInTheDocument();
  });

  it('should render bookmarks grouped by chapter', () => {
    const bookmarks = [
      makeBookmark({ id: 'bm-1', chapter_number: 1, text: 'Chapter 1 note' }),
      makeBookmark({ id: 'bm-2', chapter_number: 1, text: 'Another chapter 1 note' }),
      makeBookmark({ id: 'bm-3', chapter_number: 3, text: 'Chapter 3 note' }),
    ];

    render(<BookmarksList bookmarks={bookmarks} {...defaultProps} />);

    // Should have chapter headings
    expect(screen.getByText('Chapter 1')).toBeInTheDocument();
    expect(screen.getByText('Chapter 3')).toBeInTheDocument();

    // Should show bookmark texts
    expect(screen.getByText('Chapter 1 note')).toBeInTheDocument();
    expect(screen.getByText('Another chapter 1 note')).toBeInTheDocument();
    expect(screen.getByText('Chapter 3 note')).toBeInTheDocument();
  });

  it('should call onNavigate when a bookmark is clicked', () => {
    const onNavigate = vi.fn();
    const bookmarks = [
      makeBookmark({
        id: 'bm-1',
        cfi_range: 'epubcfi(/6/4!/4/2/1:0)',
        text: 'Click me',
      }),
    ];

    render(<BookmarksList bookmarks={bookmarks} {...defaultProps} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText('Click me'));

    expect(onNavigate).toHaveBeenCalledWith('epubcfi(/6/4!/4/2/1:0)', 'bm-1');
  });

  it('should call onDelete when delete button is clicked', () => {
    const onDelete = vi.fn();
    const bookmarks = [
      makeBookmark({ id: 'bm-del', cfi_range: 'epubcfi(/test)', text: 'Delete me' }),
    ];

    render(<BookmarksList bookmarks={bookmarks} {...defaultProps} onDelete={onDelete} />);

    // Find delete button by aria-label
    const deleteButton = screen.getByLabelText('Delete bookmark');
    fireEvent.click(deleteButton);

    expect(onDelete).toHaveBeenCalledWith('bm-del', 'epubcfi(/test)');
  });

  it('should display color indicator for colored bookmarks', () => {
    const bookmarks = [makeBookmark({ id: 'bm-color', color: '#fbbf24', text: 'Yellow note' })];

    const { container } = render(<BookmarksList bookmarks={bookmarks} {...defaultProps} />);

    // Check for the colored circle span
    const colorCircle = container.querySelector('span[style*="background-color"]');
    expect(colorCircle).toBeTruthy();
  });

  it('should display note text when bookmark has a note', () => {
    const bookmarks = [
      makeBookmark({ id: 'bm-note', text: 'Highlighted text', note: 'My important note' }),
    ];

    render(<BookmarksList bookmarks={bookmarks} {...defaultProps} />);

    expect(screen.getByText('My important note')).toBeInTheDocument();
  });
});
