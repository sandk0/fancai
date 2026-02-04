import React, { useEffect, useRef, useState, useCallback } from 'react';
import { m } from 'motion/react';
import { X, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { booksAPI } from '@/api/books';
import { useBookProgressWS } from '@/hooks/useBookProgressWS';
import { logger } from '@/lib/logger';

interface ParsingOverlayProps {
  bookId: string;
  onParsingComplete?: () => void;
  onCancel?: () => void;  // NEW: callback для отмены обработки
  forceBlock?: boolean;
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
  const { t } = useTranslation();
  const [progress, setProgress] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [usePollingFallback, setUsePollingFallback] = useState(!useWebSocket);
  const [etr, setEtr] = useState<string | null>(null);

  const referenceTimeRef = useRef<number | null>(null);
  const referenceProgressRef = useRef<number | null>(null);
  const progressRef = useRef(progress);

  useEffect(() => {
    progressRef.current = progress;

    if (referenceTimeRef.current === null && progress >= 0) {
      referenceTimeRef.current = Date.now();
      referenceProgressRef.current = progress;
    } else if (progress < (referenceProgressRef.current || 0)) {
      referenceTimeRef.current = Date.now();
      referenceProgressRef.current = progress;
    }
  }, [progress]);

  useEffect(() => {
    const computeEtr = () => {
      const currentProgress = progressRef.current;
      const referenceTime = referenceTimeRef.current;
      const referenceProgress = referenceProgressRef.current;
      if (!referenceTime || referenceProgress === null || currentProgress >= 100) {
        return null;
      }

      const elapsed = Date.now() - referenceTime;
      const progressDelta = currentProgress - referenceProgress;

      if (elapsed < 2000 || progressDelta <= 0) {
        return null;
      }

      const rate = progressDelta / elapsed;
      const remainingProgress = 100 - currentProgress;
      const remainingTimeMs = remainingProgress / rate;

      if (remainingTimeMs > 0 && isFinite(remainingTimeMs)) {
        const seconds = Math.max(0, Math.ceil(remainingTimeMs / 1000));
        if (seconds < 60) {
          return `${seconds} ${t('ui.parsing.seconds')}`;
        } else {
          const minutes = Math.ceil(seconds / 60);
          return `~${minutes} ${t('ui.parsing.minutes')}`;
        }
      }
      return null;
    };

    const interval = setInterval(() => {
      setEtr(computeEtr());
    }, 1000);

    return () => clearInterval(interval);
  }, [t]);

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
      toast.success(t('ui.parsing.complete_success'));
      setTimeout(() => onParsingComplete?.(), 1000);
    },
    onError: (error) => {
      logger.warn('[ParsingOverlay] WebSocket error, falling back to polling:', error);
      toast.error(t('ui.parsing.connection_error'));
      setUsePollingFallback(true);
    },
    maxReconnectAttempts: 2,
  });

  const [prevWsProgress, setPrevWsProgress] = useState(wsProgress);
  if (prevWsProgress !== wsProgress) {
    setPrevWsProgress(wsProgress);
    if (!usePollingFallback && wsStatus === 'connected') {
      setProgress(wsProgress);
    }
  }

  // Fallback to polling if WebSocket fails after 3 seconds of disconnect
  useEffect(() => {
    if (wsStatus === 'error' || wsStatus === 'disconnected') {
      // Give WebSocket 3 seconds to reconnect before falling back
      const fallbackTimer = setTimeout(() => {
        logger.debug('[ParsingOverlay] WebSocket unavailable, using polling');
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
        logger.error('[ParsingOverlay] Polling failed:', error);
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
      <div className="relative">
        <svg className="w-20 h-20 transform -rotate-90">
          <circle
            cx="40"
            cy="40"
            r="36"
            stroke="rgba(255, 255, 255, 0.2)"
            strokeWidth="8"
            fill="none"
          />
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
          <span>{t('ui.parsing.remaining', { time: etr })}</span>
        </m.div>
      )}

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
          <span>{t('ui.parsing.cancel')}</span>
        </m.button>
      )}
    </m.div>
  );
};