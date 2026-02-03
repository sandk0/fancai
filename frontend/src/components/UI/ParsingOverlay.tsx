import React, { useEffect, useState, useCallback } from 'react';
import { m } from 'framer-motion';
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
  // Track reference point for ETR calculation (to handle page reloads/mid-process joins)
  const [referenceTime, setReferenceTime] = useState<number | null>(null);
  const [referenceProgress, setReferenceProgress] = useState<number | null>(null);
  const [etr, setEtr] = useState<string | null>(null);

  // Initialize reference point on first valid progress update
  useEffect(() => {
    if (referenceTime === null && progress >= 0) {
      setReferenceTime(Date.now());
      setReferenceProgress(progress);
    } else if (progress < (referenceProgress || 0)) {
      // Progress reset (started over)
      setReferenceTime(Date.now());
      setReferenceProgress(progress);
    }
  }, [progress, referenceTime, referenceProgress]);

  // Update ETR based on rate of change since reference point
  useEffect(() => {
    if (!referenceTime || referenceProgress === null || progress >= 100) {
      if (progress >= 100) setEtr(null);
      return;
    }

    const elapsed = Date.now() - referenceTime;
    const progressDelta = progress - referenceProgress;

    // Need minimal time and progress sample to calculate accurate rate
    if (elapsed < 2000 || progressDelta <= 0) {
      return;
    }

    const rate = progressDelta / elapsed; // progress points per ms
    const remainingProgress = 100 - progress;
    const remainingTimeMs = remainingProgress / rate;

    if (remainingTimeMs > 0 && isFinite(remainingTimeMs)) {
      const seconds = Math.max(0, Math.ceil(remainingTimeMs / 1000));
      if (seconds < 60) {
        setEtr(`${seconds} ${t('ui.parsing.seconds')}`);
      } else {
        const minutes = Math.ceil(seconds / 60);
        setEtr(`~${minutes} ${t('ui.parsing.minutes')}`);
      }
    }
  }, [progress, referenceTime, referenceProgress, t]);

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