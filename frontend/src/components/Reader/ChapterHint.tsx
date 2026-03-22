/**
 * ChapterHint - Shows "Next chapter" / "Previous chapter" hint during rubber-band swipe
 *
 * Appears at the bottom of the screen when the user swipes past the
 * chapter boundary with enough offset. Uses AnimatePresence for
 * smooth enter/exit transitions.
 *
 * @module components/Reader/ChapterHint
 */

import { m, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Z_INDEX } from '@/lib/zIndex';

export interface ChapterHintProps {
  direction: 'next' | 'prev' | null;
  visible: boolean;
}

export const ChapterHint = ({ direction, visible }: ChapterHintProps) => {
  const { t } = useTranslation();

  const text =
    direction === 'next'
      ? t('reader.swipe.next_chapter')
      : direction === 'prev'
        ? t('reader.swipe.prev_chapter')
        : '';

  return (
    <AnimatePresence>
      {visible && direction && (
        <m.div
          key="chapter-hint"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.2 }}
          style={{
            position: 'fixed',
            bottom: '5rem',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: Z_INDEX.dropdown,
            pointerEvents: 'none',
          }}
          className="bg-muted/90 backdrop-blur-sm rounded-full text-sm text-muted-foreground border border-border px-4 py-2"
        >
          {text}
        </m.div>
      )}
    </AnimatePresence>
  );
};

export default ChapterHint;
