import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useVisualViewportHandler } from '../useVisualViewportHandler';

describe('useVisualViewportHandler', () => {
  let originalVisualViewport: VisualViewport | null;
  let resizeListeners: Array<EventListener>;
  let scrollListeners: Array<EventListener>;

  const createMockVisualViewport = (height: number, offsetTop = 0) => {
    resizeListeners = [];
    scrollListeners = [];

    return {
      height,
      width: 375,
      offsetTop,
      offsetLeft: 0,
      pageTop: 0,
      pageLeft: 0,
      scale: 1,
      addEventListener: vi.fn((event: string, listener: EventListener) => {
        if (event === 'resize') resizeListeners.push(listener);
        if (event === 'scroll') scrollListeners.push(listener);
      }),
      removeEventListener: vi.fn((event: string, listener: EventListener) => {
        if (event === 'resize') {
          resizeListeners = resizeListeners.filter((l) => l !== listener);
        }
        if (event === 'scroll') {
          scrollListeners = scrollListeners.filter((l) => l !== listener);
        }
      }),
      dispatchEvent: vi.fn(),
    };
  };

  const triggerResize = (
    mockVV: ReturnType<typeof createMockVisualViewport>,
    newHeight: number
  ) => {
    mockVV.height = newHeight;
    resizeListeners.forEach((listener) => listener(new Event('resize')));
  };

  beforeEach(() => {
    originalVisualViewport = window.visualViewport;
    // Spy on documentElement.style methods
    vi.spyOn(document.documentElement.style, 'setProperty');
    vi.spyOn(document.documentElement.style, 'removeProperty');
  });

  afterEach(() => {
    // Restore original visualViewport
    Object.defineProperty(window, 'visualViewport', {
      value: originalVisualViewport,
      writable: true,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('returns default state when window.visualViewport is not available', () => {
    Object.defineProperty(window, 'visualViewport', {
      value: null,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useVisualViewportHandler());

    expect(result.current.isKeyboardVisible).toBe(false);
    expect(result.current.keyboardHeight).toBe(0);
  });

  it('detects keyboard visible when height decreases by more than 150px', () => {
    const mockVV = createMockVisualViewport(812); // iPhone X full height
    Object.defineProperty(window, 'visualViewport', {
      value: mockVV,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useVisualViewportHandler());

    // Initial state
    expect(result.current.isKeyboardVisible).toBe(false);

    // Simulate keyboard appearing (height drops by 300px)
    act(() => {
      triggerResize(mockVV, 512);
    });

    expect(result.current.isKeyboardVisible).toBe(true);
    expect(result.current.keyboardHeight).toBe(300);
  });

  it('ignores small height changes below 150px threshold (address bar)', () => {
    const mockVV = createMockVisualViewport(812);
    Object.defineProperty(window, 'visualViewport', {
      value: mockVV,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useVisualViewportHandler());

    // Simulate address bar change (only ~70px)
    act(() => {
      triggerResize(mockVV, 742);
    });

    expect(result.current.isKeyboardVisible).toBe(false);
    expect(result.current.keyboardHeight).toBe(0);
  });

  it('resets state when height returns to initial value', () => {
    const mockVV = createMockVisualViewport(812);
    Object.defineProperty(window, 'visualViewport', {
      value: mockVV,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useVisualViewportHandler());

    // Keyboard appears
    act(() => {
      triggerResize(mockVV, 512);
    });
    expect(result.current.isKeyboardVisible).toBe(true);
    expect(result.current.keyboardHeight).toBe(300);

    // Keyboard disappears
    act(() => {
      triggerResize(mockVV, 812);
    });
    expect(result.current.isKeyboardVisible).toBe(false);
    expect(result.current.keyboardHeight).toBe(0);
  });

  it('sets --keyboard-height CSS variable when keyboard is visible', () => {
    const mockVV = createMockVisualViewport(812);
    Object.defineProperty(window, 'visualViewport', {
      value: mockVV,
      writable: true,
      configurable: true,
    });

    renderHook(() => useVisualViewportHandler());

    // Simulate keyboard appearing
    act(() => {
      triggerResize(mockVV, 512);
    });

    expect(document.documentElement.style.setProperty).toHaveBeenCalledWith(
      '--keyboard-height',
      '300px'
    );
  });

  it('removes --keyboard-height CSS variable on cleanup (unmount)', () => {
    const mockVV = createMockVisualViewport(812);
    Object.defineProperty(window, 'visualViewport', {
      value: mockVV,
      writable: true,
      configurable: true,
    });

    const { unmount } = renderHook(() => useVisualViewportHandler());

    // Simulate keyboard appearing
    act(() => {
      triggerResize(mockVV, 512);
    });

    // Unmount the hook
    unmount();

    expect(document.documentElement.style.removeProperty).toHaveBeenCalledWith('--keyboard-height');
  });
});
