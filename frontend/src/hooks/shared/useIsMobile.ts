import { useState, useEffect } from 'react';

/**
 * useIsMobile - Reactive mobile device detection via matchMedia
 *
 * Uses matchMedia API instead of window.innerWidth for better
 * reactivity and consistency with CSS media queries.
 *
 * Breakpoint: 768px (md) -- matches Tailwind md breakpoint.
 *
 * @returns true if viewport is below 768px
 *
 * @module hooks/shared/useIsMobile
 */

const MOBILE_BREAKPOINT = '(max-width: 767px)';

export const useIsMobile = (): boolean => {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(MOBILE_BREAKPOINT).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);

    // Modern API
    mql.addEventListener('change', handler);
    // Sync initial value
    setIsMobile(mql.matches);

    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
};
