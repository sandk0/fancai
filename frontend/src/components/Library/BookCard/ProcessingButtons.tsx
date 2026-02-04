import { m, AnimatePresence } from 'motion/react';
import { Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useHaptics } from '@/hooks/useHaptics';
import type { ProcessingButtonsProps } from './types';

export function ProcessingButtons({
  book,
  processingState,
  isStarting,
  onStartProcessing,
}: ProcessingButtonsProps) {
  const { t } = useTranslation();
  const haptics = useHaptics();

  return (
    <AnimatePresence>
      {processingState === 'not_processed' && !book.is_processing && (
        <m.div
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 md:hidden"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
        >
          <m.button
            className={cn(
              "pointer-events-auto",
              "p-3.5 rounded-full shadow-xl backdrop-blur-md",
              "bg-[var(--color-accent-500)]/95 text-white",
              "hover:bg-[var(--color-accent-600)] hover:scale-110",
              "active:scale-95",
              "min-w-[52px] min-h-[52px]",
              "transition-all duration-200",
              "ring-2 ring-white/20"
            )}
            whileHover={{ scale: 1.1, boxShadow: "0 8px 30px rgba(0,0,0,0.3)" }}
            whileTap={{ scale: 0.95 }}
            onClick={(e) => {
              e.stopPropagation();
              haptics.tap();
              onStartProcessing();
            }}
            disabled={isStarting}
            aria-label={t('bookCard.process_descriptions')}
          >
            {isStarting ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <Sparkles className="w-6 h-6" />
            )}
          </m.button>
        </m.div>
      )}

      {processingState === 'error' && !book.is_processing && (
        <m.div
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 md:hidden"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <m.button
            className={cn(
              "pointer-events-auto",
              "p-3.5 rounded-full shadow-xl backdrop-blur-md",
              "bg-destructive/90 text-white",
              "hover:bg-destructive hover:scale-110",
              "min-w-[52px] min-h-[52px]"
            )}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={(e) => {
              e.stopPropagation();
              haptics.tap();
              onStartProcessing();
            }}
            disabled={isStarting}
            aria-label={t('bookCard.retry_processing')}
          >
            <AlertTriangle className="w-6 h-6" />
          </m.button>
        </m.div>
      )}
    </AnimatePresence>
  );
}
