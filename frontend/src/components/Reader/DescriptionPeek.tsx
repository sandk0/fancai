import React, { useEffect, useRef, useState } from 'react';
import { m, AnimatePresence } from 'motion/react';
import { fetchImageWithAuth } from '@/utils/fetchWithTokenRefresh';
import { Z_INDEX } from '@/lib/zIndex';
import type { Description, GeneratedImage } from '@/types/api';

interface DescriptionPeekProps {
  description: Description | null;
  image?: GeneratedImage;
  position: { x: number; y: number } | null;
  onClose: () => void;
  onOpenFull: (description: Description, image?: GeneratedImage) => void;
}

export const DescriptionPeek: React.FC<DescriptionPeekProps> = ({
  description,
  image,
  position,
  onClose,
  onOpenFull,
}) => {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const peekRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!image?.image_url) {
      setThumbUrl(null);
      return;
    }

    let cancelled = false;
    fetchImageWithAuth(image.image_url).then((url) => {
      if (!cancelled && url) setThumbUrl(url);
    });

    return () => {
      cancelled = true;
      if (thumbUrl && thumbUrl !== image.image_url) {
        URL.revokeObjectURL(thumbUrl);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.image_url]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (peekRef.current && !peekRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, [onClose]);

  if (!description || !position) return null;

  const bookText = description.text || description.content;
  const truncated = bookText.length > 120 ? `${bookText.slice(0, 120)}...` : bookText;

  const handleTap = () => {
    onOpenFull(description, image);
    onClose();
  };

  // Position the peek relative to click, clamped to viewport
  const peekStyle: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(position.x, window.innerWidth - 200),
    top: Math.max(8, position.y - 180),
    zIndex: Z_INDEX.tooltip ?? 9000,
  };

  return (
    <AnimatePresence>
      <m.div
        ref={peekRef}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        style={peekStyle}
        className="w-48 rounded-lg overflow-hidden shadow-xl border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] cursor-pointer"
        onClick={handleTap}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            className="w-full h-32 object-cover"
          />
        ) : (
          <div className="p-3">
            <p className="text-xs text-[var(--color-text-muted)] italic leading-relaxed">
              {truncated}
            </p>
          </div>
        )}
        <div className="px-2 py-1.5 text-[10px] text-[var(--color-text-subtle)] text-center">
          {description.type}
        </div>
      </m.div>
    </AnimatePresence>
  );
};
