import { useEffect, useRef, useState } from 'react';

interface UseIntersectionObserverOptions {
  /** Threshold for intersection (0.0 - 1.0). Default: 0.1 */
  threshold?: number;
  /** Margin around root element. Default: '100px' (preload before visible) */
  rootMargin?: string;
  /** Only trigger once when element becomes visible. Default: true */
  triggerOnce?: boolean;
  /** Root element for intersection. Default: null (viewport) */
  root?: Element | null;
}

/**
 * Hook for detecting when an element enters the viewport using IntersectionObserver.
 *
 * @example
 * ```tsx
 * const { ref, isVisible } = useIntersectionObserver<HTMLDivElement>();
 *
 * return (
 *   <div ref={ref}>
 *     {isVisible && <img src={imageSrc} />}
 *   </div>
 * );
 * ```
 */
export function useIntersectionObserver<T extends HTMLElement>(
  options: UseIntersectionObserverOptions = {}
) {
  const {
    threshold = 0.1,
    rootMargin = '100px',
    triggerOnce = true,
    root = null
  } = options;

  const ref = useRef<T>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Skip if already visible and triggerOnce is true
    if (isVisible && triggerOnce) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (triggerOnce) {
            observer.unobserve(element);
          }
        } else if (!triggerOnce) {
          setIsVisible(false);
        }
      },
      { threshold, rootMargin, root }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [threshold, rootMargin, triggerOnce, root, isVisible]);

  return { ref, isVisible };
}

export default useIntersectionObserver;
