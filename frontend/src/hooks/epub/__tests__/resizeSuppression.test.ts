/**
 * Tests for resizeSuppression utility
 *
 * Verifies the disconnect/reconnect ResizeObserver pattern used to
 * prevent epub.js resize cascade when DOM mutations are performed
 * (span wrapping for annotations, descriptions, entities).
 *
 * BUG-4: ResizeObserver in epub.js contents.js detects size changes
 * after span wrapping and triggers a full cascade (RESIZE -> expand ->
 * layout.format -> clear -> display), destroying all custom spans.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  withResizeSuppression,
  disconnectResizeObserver,
  reconnectResizeObserver,
} from '../resizeSuppression';

describe('withResizeSuppression', () => {
  let mockObserver: { disconnect: ReturnType<typeof vi.fn>; observe: ReturnType<typeof vi.fn> };
  let mockDocumentElement: HTMLElement;
  let mockContents: {
    observer: typeof mockObserver;
    _size: { width: number; height: number };
    textWidth: ReturnType<typeof vi.fn>;
    textHeight: ReturnType<typeof vi.fn>;
    document: { documentElement: HTMLElement };
  };
  let mockRendition: {
    getContents: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockObserver = {
      disconnect: vi.fn(),
      observe: vi.fn(),
    };

    mockDocumentElement = document.createElement('html');

    mockContents = {
      observer: mockObserver,
      _size: { width: 100, height: 200 },
      textWidth: vi.fn(() => 110),
      textHeight: vi.fn(() => 220),
      document: { documentElement: mockDocumentElement },
    };

    mockRendition = {
      getContents: vi.fn(() => [mockContents]),
    };
  });

  it('calls observer.disconnect() before mutation callback', () => {
    const callOrder: string[] = [];
    mockObserver.disconnect.mockImplementation(() => callOrder.push('disconnect'));
    const mutation = vi.fn(() => callOrder.push('mutation'));

    withResizeSuppression(mockRendition as any, mutation);

    expect(callOrder[0]).toBe('disconnect');
    expect(callOrder[1]).toBe('mutation');
  });

  it('calls observer.observe() after mutation callback with documentElement', () => {
    const callOrder: string[] = [];
    const mutation = vi.fn(() => callOrder.push('mutation'));
    mockObserver.observe.mockImplementation(() => callOrder.push('observe'));

    withResizeSuppression(mockRendition as any, mutation);

    expect(callOrder.indexOf('mutation')).toBeLessThan(callOrder.indexOf('observe'));
    expect(mockObserver.observe).toHaveBeenCalledWith(mockDocumentElement);
  });

  it('updates _size to current textWidth/textHeight after mutation', () => {
    withResizeSuppression(mockRendition as any, () => {});

    expect(mockContents._size).toEqual({ width: 110, height: 220 });
    expect(mockContents.textWidth).toHaveBeenCalled();
    expect(mockContents.textHeight).toHaveBeenCalled();
  });

  it('executes mutation gracefully when contents array is empty', () => {
    mockRendition.getContents.mockReturnValue([]);
    const mutation = vi.fn();

    expect(() => withResizeSuppression(mockRendition as any, mutation)).not.toThrow();
    expect(mutation).toHaveBeenCalled();
  });

  it('executes mutation gracefully when getContents returns null', () => {
    mockRendition.getContents.mockReturnValue(null);
    const mutation = vi.fn();

    expect(() => withResizeSuppression(mockRendition as any, mutation)).not.toThrow();
    expect(mutation).toHaveBeenCalled();
  });

  it('reconnects observer even if mutation throws', () => {
    const mutation = vi.fn(() => {
      throw new Error('mutation failed');
    });

    expect(() => withResizeSuppression(mockRendition as any, mutation)).toThrow('mutation failed');
    expect(mockObserver.observe).toHaveBeenCalledWith(mockDocumentElement);
  });

  it('handles contents without observer gracefully', () => {
    const contentsNoObserver = {
      ...mockContents,
      observer: undefined,
    };
    mockRendition.getContents.mockReturnValue([contentsNoObserver]);
    const mutation = vi.fn();

    expect(() => withResizeSuppression(mockRendition as any, mutation)).not.toThrow();
    expect(mutation).toHaveBeenCalled();
  });
});

describe('disconnectResizeObserver / reconnectResizeObserver (async pattern)', () => {
  let mockObserver: { disconnect: ReturnType<typeof vi.fn>; observe: ReturnType<typeof vi.fn> };
  let mockDocumentElement: HTMLElement;
  let mockContents: {
    observer: typeof mockObserver;
    _size: { width: number; height: number };
    textWidth: ReturnType<typeof vi.fn>;
    textHeight: ReturnType<typeof vi.fn>;
    document: { documentElement: HTMLElement };
  };
  let mockRendition: {
    getContents: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockObserver = {
      disconnect: vi.fn(),
      observe: vi.fn(),
    };

    mockDocumentElement = document.createElement('html');

    mockContents = {
      observer: mockObserver,
      _size: { width: 100, height: 200 },
      textWidth: vi.fn(() => 150),
      textHeight: vi.fn(() => 250),
      document: { documentElement: mockDocumentElement },
    };

    mockRendition = {
      getContents: vi.fn(() => [mockContents]),
    };
  });

  it('disconnectResizeObserver disconnects the observer', () => {
    disconnectResizeObserver(mockRendition as any);
    expect(mockObserver.disconnect).toHaveBeenCalled();
  });

  it('reconnectResizeObserver reconnects observer and updates _size', () => {
    reconnectResizeObserver(mockRendition as any);

    expect(mockContents._size).toEqual({ width: 150, height: 250 });
    expect(mockObserver.observe).toHaveBeenCalledWith(mockDocumentElement);
  });

  it('disconnectResizeObserver handles empty contents gracefully', () => {
    mockRendition.getContents.mockReturnValue([]);
    expect(() => disconnectResizeObserver(mockRendition as any)).not.toThrow();
  });

  it('reconnectResizeObserver handles empty contents gracefully', () => {
    mockRendition.getContents.mockReturnValue([]);
    expect(() => reconnectResizeObserver(mockRendition as any)).not.toThrow();
  });
});
