import React, { useEffect, useState, useCallback } from 'react';
import { m } from 'framer-motion';
import { X, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import { booksAPI } from '@/api/books';
import { useBookProgressWS } from '@/hooks/useBookProgressWS';

interface ParsingOverlayProps {
  bookId: string;
  onParsingComplete?: () => void;
  onCancel?: () => void;  // NEW: callback для отмены обработки
  forceBlock?: boolean;  // eslint-disable-line @typescript-eslint/no-unused-vars -- Reserved for future use
  /** Use WebSocket for real-time updates (Phase 5). Falls back to polling on failure. */
  useWebSocket?: boolean;
}

export const ParsingOverlay: React.FC<ParsingOverlayProps> = ({
  bookId,
  onParsingComplete,
  onCancel,
  useWebSocket = true,  // Enable WebSocket by default (Phase 5)
  // forceBlock is reserved for future use (blocking navigation during parsing)
}) => {
  const [progress, setProgress] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [usePollingFallback, setUsePollingFallback] = useState(!useWebSocket);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [etr, setEtr] = useState<string | null>(null);

  // Initialize start time for ETR calculation
  useEffect(() => {
    setStartTime(Date.now());
  }, []);

  // Update ETR based on progress
  useEffect(() => {
    if (!startTime || progress <= 0 || progress >= 100) {
      if (progress >= 100) setEtr(null);
      return;
    }

    const elapsed = Date.now() - startTime;
    const rate = progress / elapsed; // progress per ms
    const remainingProgress = 100 - progress;
    const remainingTimeMs = remainingProgress / rate;

    // Smooth update: only update if change is significant or enough time passed
    // For simplicity here, just formatting it
    if (remainingTimeMs > 0) {
      const seconds = Math.max(0, Math.ceil(remainingTimeMs / 1000));
      if (seconds < 60) {
        setEtr(`${seconds} сек`);
      } else {
        const minutes = Math.ceil(seconds / 60);
        setEtr(`~${minutes} мин`);
      }
    }
  }, [progress, startTime]);

  // Phase 5: WebSocket connection for real-time updates
  const {
    status: wsStatus,
    progress: wsProgress,
    requestCancel: wsRequestCancel,
  } = useBookProgressWS({
    bookId,
    enabled: useWebSocket && !usePollingFallback && !isComplete,
    onComplete: () => {
      setIsComplete(true);
      setProgress(100);
      toast.success('Обработка завершена успешно!');
      setTimeout(() => onParsingComplete?.(), 1000);
    },
    onError: (error) => {
      console.warn('[ParsingOverlay] WebSocket error, falling back to polling:', error);
      toast.error('Ошибка соединения. Переключаемся на резервный режим...');
      setUsePollingFallback(true);
    },
    maxReconnectAttempts: 2,
  });

  // Update progress from WebSocket
  useEffect(() => {
    if (!usePollingFallback && wsStatus === 'connected') {
      setProgress(wsProgress);
    }
  }, [wsProgress, wsStatus, usePollingFallback]);

  // Fallback to polling if WebSocket fails after 3 seconds of disconnect
  useEffect(() => {
    if (wsStatus === 'error' || wsStatus === 'disconnected') {
      // Give WebSocket 3 seconds to reconnect before falling back
      const fallbackTimer = setTimeout(() => {
        console.log('[ParsingOverlay] WebSocket unavailable, using polling');
        setUsePollingFallback(true);
      }, 3000);
      return () => clearTimeout(fallbackTimer);
    }
  }, [wsStatus]);

  // Polling fallback (same as before Phase 5)
  useEffect(() => {
    if (!usePollingFallback) return;

    let intervalId: NodeJS.Timeout | null = null;
    let isMounted = true;

    const checkProgress = async () => {
      if (!isMounted || isComplete) return;

      try {
        const status = await booksAPI.getParsingStatus(bookId);
        if (!isMounted || isComplete) return;

        const statusData = status as { progress?: number; status?: string };
        const currentProgress = statusData.progress || 0;
        setProgress(currentProgress);

        if (statusData.status === 'completed') {
          setIsComplete(true);
          setProgress(100);
          setTimeout(() => isMounted && onParsingComplete?.(), 1000);
          return;
        }

        intervalId = setTimeout(checkProgress, statusData.status === 'not_started' ? 500 : 300);
      } catch (error) {
        console.error('[ParsingOverlay] Polling failed:', error);
        if (isMounted && !isComplete) {
          intervalId = setTimeout(checkProgress, 1000);
        }
      }
    };

    if (!isComplete) {
      intervalId = setTimeout(checkProgress, 500);
    }

    return () => {
      isMounted = false;
      if (intervalId) clearTimeout(intervalId);
    };
  }, [bookId, onParsingComplete, isComplete, usePollingFallback]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (!usePollingFallback && wsStatus === 'connected') {
      wsRequestCancel();
    }
    onCancel?.();
  }, [onCancel, wsRequestCancel, wsStatus, usePollingFallback]);

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
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-white font-bold text-lg">
            {Math.round(progress)}%
          </span>
        </div>
      </div>

      {/* ETR Badge */}
      {etr && !isComplete && (
        <m.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/40 text-xs text-white/80 font-medium z-50 backdrop-blur-sm"
        >
          <Clock className="w-3 h-3" />
          <span>Осталось: {etr}</span>
        </m.div>
      )}

      {/* Кнопка отмены (скрываем если завершено) */}
      {onCancel && !isComplete && (
        <m.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={(e) => {
            e.stopPropagation();
            handleCancel();
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-white font-medium transition-all duration-200 min-h-[40px] z-50 mt-4 backdrop-blur-md border border-white/10 shadow-lg pointer-events-auto cursor-pointer"
        >
          <X className="w-4 h-4" />
          <span>Отменить</span>
        </m.button>
      )}
    </m.div>
  );
};