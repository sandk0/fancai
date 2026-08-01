import { useSyncExternalStore } from 'react';

/**
 * useIsMobile - Reactive mobile device detection via matchMedia
 *
 * Uses matchMedia API instead of window.innerWidth for better
 * reactivity and consistency with CSS media queries.
 *
 * Breakpoint: 768px (md) -- matches Tailwind md breakpoint.
 *
 * Реализован через useSyncExternalStore: matchMedia — внешний источник,
 * подписка и снимок разделены, синхронный setState в эффекте не нужен.
 *
 * @returns true if viewport is below 768px
 *
 * @module hooks/shared/useIsMobile
 */

const MOBILE_BREAKPOINT = '(max-width: 767px)';

const subscribe = (onStoreChange: () => void): (() => void) => {
  const mql = window.matchMedia(MOBILE_BREAKPOINT);
  mql.addEventListener('change', onStoreChange);
  return () => mql.removeEventListener('change', onStoreChange);
};

const getSnapshot = (): boolean => window.matchMedia(MOBILE_BREAKPOINT).matches;

// SSR/pre-hydration: считаем десктопом, как и прежний ленивый инициализатор
const getServerSnapshot = (): boolean => false;

export const useIsMobile = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
