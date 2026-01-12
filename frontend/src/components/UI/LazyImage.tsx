import { useState, useCallback } from 'react';
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver';
import { cn } from '@/lib/utils';
import { ImageOff } from 'lucide-react';

interface LazyImageProps {
  /** Image source URL */
  src: string;
  /** Alt text for accessibility */
  alt: string;
  /** Additional CSS classes for the container */
  className?: string;
  /** Additional CSS classes for the skeleton placeholder */
  placeholderClassName?: string;
  /** Additional CSS classes for the image element */
  imageClassName?: string;
  /** Margin before image starts loading (default: '100px') */
  rootMargin?: string;
  /** Callback when image loads successfully */
  onLoad?: () => void;
  /** Callback when image fails to load */
  onError?: () => void;
  /** Click handler for the image */
  onClick?: () => void;
}

/**
 * Lazy-loaded image component with IntersectionObserver.
 *
 * Features:
 * - Only loads image when entering viewport
 * - Shows skeleton placeholder while loading
 * - Fade-in animation on load
 * - Error state with fallback UI
 * - Configurable preload margin
 *
 * @example
 * ```tsx
 * <LazyImage
 *   src="/path/to/image.jpg"
 *   alt="Description"
 *   className="aspect-square"
 *   onClick={() => openModal()}
 * />
 * ```
 */
export function LazyImage({
  src,
  alt,
  className,
  placeholderClassName,
  imageClassName,
  rootMargin = '100px',
  onLoad,
  onError,
  onClick,
}: LazyImageProps) {
  const { ref, isVisible } = useIntersectionObserver<HTMLDivElement>({
    rootMargin,
    triggerOnce: true,
  });

  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
    onLoad?.();
  }, [onLoad]);

  const handleError = useCallback(() => {
    setHasError(true);
    onError?.();
  }, [onError]);

  return (
    <div
      ref={ref}
      className={cn('relative overflow-hidden', className)}
      onClick={onClick}
    >
      {/* Skeleton placeholder - shows while not loaded and no error */}
      {!isLoaded && !hasError && (
        <div
          className={cn(
            'absolute inset-0 bg-muted animate-pulse',
            placeholderClassName
          )}
          aria-hidden="true"
        />
      )}

      {/* Actual image - only render when visible in viewport */}
      {isVisible && !hasError && (
        <img
          src={src}
          alt={alt}
          className={cn(
            'w-full h-full object-cover transition-opacity duration-300 ease-out',
            isLoaded ? 'opacity-100' : 'opacity-0',
            imageClassName
          )}
          onLoad={handleLoad}
          onError={handleError}
        />
      )}

      {/* Error state */}
      {hasError && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center bg-muted"
          role="alert"
        >
          <ImageOff className="w-8 h-8 text-muted-foreground mb-2" />
          <span className="text-muted-foreground text-sm text-center px-2">
            Ошибка загрузки
          </span>
        </div>
      )}
    </div>
  );
}

export default LazyImage;
