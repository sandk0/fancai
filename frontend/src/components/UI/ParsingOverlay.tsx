import React, { useEffect, useState } from 'react';
import { m } from 'framer-motion';
import { X } from 'lucide-react';
import { booksAPI } from '@/api/books';

interface ParsingOverlayProps {
  bookId: string;
  onParsingComplete?: () => void;
  onCancel?: () => void;  // NEW: callback для отмены обработки
  forceBlock?: boolean;
}

export const ParsingOverlay: React.FC<ParsingOverlayProps> = ({
  bookId,
  onParsingComplete,
  onCancel,
  forceBlock = false
}) => {
  const [progress, setProgress] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    let isMounted = true; // Флаг для отслеживания размонтирования компонента

    const checkProgress = async () => {
      // КРИТИЧЕСКИ ВАЖНО: Прерываем polling если уже завершено
      if (!isMounted || isComplete) {
        console.log(`[ParsingOverlay] Stopping polling: isMounted=${isMounted}, isComplete=${isComplete}`);
        return;
      }

      try {
        const status = await booksAPI.getParsingStatus(bookId);
        console.log(`[ParsingOverlay] API response for ${bookId}:`, status);

        // Проверяем снова после async операции
        if (!isMounted || isComplete) {
          console.log(`[ParsingOverlay] Stopping polling after API call`);
          return;
        }

        // Обновляем прогресс
        const statusData = status as { progress?: number; status?: string };
        const currentProgress = statusData.progress || 0;
        console.log(`[ParsingOverlay] Updating progress: ${progress}% -> ${currentProgress}%`);
        setProgress(currentProgress);

        if (statusData.status === 'completed' || currentProgress >= 100) {
          console.log(`[ParsingOverlay] Parsing completed! Stopping polling.`);
          setIsComplete(true);
          setProgress(100);

          // Вызываем callback через 1 секунду, но НЕ планируем новый checkProgress
          if (onParsingComplete) {
            setTimeout(() => {
              if (isMounted) {
                onParsingComplete();
              }
            }, 1000);
          }

          // КРИТИЧЕСКИ ВАЖНО: НЕ планируем новый setTimeout - polling останавливается!
          return;
        } else if (statusData.status === 'not_started') {
          // Если еще не запущен, ждем автоматического запуска с backend
          setProgress(0);
          intervalId = setTimeout(checkProgress, 500);
        } else {
          // Продолжаем проверку прогресса чаще для лучшего UX
          intervalId = setTimeout(checkProgress, 300);
        }
      } catch (error) {
        console.error('[ParsingOverlay] Failed to check progress:', error);

        // Повторяем попытку только если еще не завершено
        if (isMounted && !isComplete) {
          intervalId = setTimeout(checkProgress, 1000);
        }
      }
    };

    // Начинаем проверку прогресса только если еще не завершено
    if (!isComplete) {
      console.log(`[ParsingOverlay] Starting polling for book ${bookId}`);
      checkProgress();
    }

    return () => {
      console.log(`[ParsingOverlay] Cleanup: clearing timeout and marking unmounted`);
      isMounted = false;
      if (intervalId) {
        clearTimeout(intervalId);
        intervalId = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- progress in deps causes infinite re-renders
  }, [bookId, onParsingComplete, isComplete]);

  // Скрываем overlay если парсинг завершен
  if (isComplete && !forceBlock) {
    return null;
  }

  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 bg-black bg-opacity-70 backdrop-blur-sm flex flex-col items-center justify-center z-[100] rounded-lg gap-4"
    >
      {/* Круговой прогресс */}
      <div className="relative">
        {/* Фон круга */}
        <svg className="w-20 h-20 transform -rotate-90">
          <circle
            cx="40"
            cy="40"
            r="36"
            stroke="rgba(255, 255, 255, 0.2)"
            strokeWidth="8"
            fill="none"
          />
          {/* Прогресс */}
          <m.circle
            cx="40"
            cy="40"
            r="36"
            stroke="white"
            strokeWidth="8"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={226.2} // 2 * PI * r
            initial={{ strokeDashoffset: 226.2 }}
            animate={{
              strokeDashoffset: 226.2 - (226.2 * progress) / 100
            }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
          />
        </svg>

        {/* Процент в центре */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white font-bold text-lg">
            {Math.round(progress)}%
          </span>
        </div>
      </div>

      {/* Кнопка отмены */}
      {onCancel && (
        <m.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-sm font-medium transition-all duration-200 min-h-[40px]"
        >
          <X className="w-4 h-4" />
          <span>Отменить</span>
        </m.button>
      )}
    </m.div>
  );
};