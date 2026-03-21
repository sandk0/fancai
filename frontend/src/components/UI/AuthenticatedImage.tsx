/**
 * AuthenticatedImage - Image component that loads images with JWT authentication
 *
 * Regular <img> tags cannot send Authorization headers, so this component
 * fetches the image with the JWT token and displays it as a blob URL.
 *
 * Now uses fetchWithTokenRefresh for automatic token refresh on 401 errors,
 * solving the issue of images failing to load during long reading sessions.
 *
 * @component
 */

import { useState, useEffect, useRef, memo } from 'react';
import { fetchImageWithAuth } from '@/utils/fetchWithTokenRefresh';
import { logger } from '@/lib/logger';

interface AuthenticatedImageProps {
  src: string | null;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
  onLoad?: () => void;
  onError?: () => void;
  loading?: "eager" | "lazy";
}

/**
 * AuthenticatedImage - Loads images with JWT authentication
 *
 * Optimization rationale:
 * - Memoized to prevent re-renders when parent state changes
 * - Uses useEffect cleanup to revoke blob URLs and prevent memory leaks
 * - Caches blob URL in state to avoid re-fetching on re-renders
 */
export const AuthenticatedImage = memo(function AuthenticatedImage({
  src,
  alt,
  className,
  fallback,
  onLoad,
  onError,
  loading = "lazy",
}: AuthenticatedImageProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Stable refs for callbacks to avoid re-triggering effect
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  onLoadRef.current = onLoad;
  onErrorRef.current = onError;

  useEffect(() => {
    let isMounted = true;
    let currentBlobUrl: string | null = null;

    const loadImage = async () => {
      if (!src) {
        setIsLoading(false);
        setHasError(true);
        return;
      }

      setIsLoading(true);
      setHasError(false);
      setBlobUrl(null);

      try {
        // Use fetchImageWithAuth for automatic token refresh on 401 errors
        const newBlobUrl = await fetchImageWithAuth(src);

        if (isMounted) {
          if (newBlobUrl) {
            // Revoke previous URL before setting new one
            if (currentBlobUrl && currentBlobUrl !== newBlobUrl) {
              URL.revokeObjectURL(currentBlobUrl);
            }
            currentBlobUrl = newBlobUrl;
            setBlobUrl(currentBlobUrl);
            setIsLoading(false);
            onLoadRef.current?.();
          } else {
            // fetchImageWithAuth returns null on failure
            throw new Error('Failed to fetch image');
          }
        } else {
          // Component unmounted during fetch - cleanup the new URL
          if (newBlobUrl) {
            URL.revokeObjectURL(newBlobUrl);
          }
        }
      } catch (error) {
        logger.warn('[AuthenticatedImage] Failed to load image:', src, error);
        if (isMounted) {
          setIsLoading(false);
          setHasError(true);
          onErrorRef.current?.();
        }
      }
    };

    loadImage();

    // Single cleanup: revoke blob URL when component unmounts or src changes
    return () => {
      isMounted = false;
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
      }
    };
  }, [src]);

  if (isLoading) {
    // Show a loading placeholder or the fallback
    return fallback ? <>{fallback}</> : (
      <div className={`${className} bg-muted`} />
    );
  }

  if (hasError || !blobUrl) {
    return fallback ? <>{fallback}</> : null;
  }

  return (
    <img
      src={blobUrl}
      alt={alt}
      className={className}
      loading={loading}
      decoding="async"
    />
  );
});
