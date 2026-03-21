/**
 * useBookProgressWS - WebSocket hook for real-time book processing progress
 *
 * Phase 5: WebSocket Implementation (Updated January 2026)
 *
 * Features:
 * - Automatic connection/reconnection
 * - JWT authentication via HttpOnly cookie (browser sends automatically)
 * - Ping/pong keepalive
 * - Graceful cleanup on unmount
 * - Fallback to polling on connection failure
 *
 * @module hooks/useBookProgressWS
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/stores/auth';
import { booksAPI } from '@/api/books';
import { logger } from '@/lib/logger';
import { STORAGE_KEYS } from '@/types/state';

/** Status of WebSocket connection */
export type WSConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/** Progress update from server */
export interface BookProgressUpdate {
  type: 'progress' | 'completed' | 'error' | 'connected' | 'ping' | 'pong' | 'cancel_ack';
  book_id: string;
  progress?: number;
  chapter?: number;
  total_chapters?: number;
  status?: 'processing' | 'completed' | 'failed';
  message?: string;
}

/** Options for useBookProgressWS hook */
export interface UseBookProgressWSOptions {
  /** Book ID to subscribe to */
  bookId: string;
  /** Whether to enable the connection */
  enabled?: boolean;
  /** Callback when progress updates */
  onProgress?: (update: BookProgressUpdate) => void;
  /** Callback when processing completes */
  onComplete?: () => void;
  /** Callback on error */
  onError?: (error: string) => void;
  /** Reconnect attempts before fallback */
  maxReconnectAttempts?: number;
}

/** Return type of useBookProgressWS hook */
export interface UseBookProgressWSReturn {
  /** Current connection status */
  status: WSConnectionStatus;
  /** Current progress (0-100) */
  progress: number;
  /** Current chapter being processed */
  currentChapter: number;
  /** Total chapters in book */
  totalChapters: number;
  /** Last status message */
  message: string;
  /** Request cancel processing */
  requestCancel: () => void;
  /** Manually disconnect */
  disconnect: () => void;
}

/**
 * Hook for WebSocket connection to book processing progress.
 *
 * Provides real-time updates without polling.
 *
 * @example
 * const { status, progress, currentChapter } = useBookProgressWS({
 *   bookId: 'uuid-here',
 *   enabled: isProcessing,
 *   onComplete: () => refetch()
 * });
 */
export function useBookProgressWS({
  bookId,
  enabled = true,
  onProgress,
  onComplete,
  onError,
  maxReconnectAttempts = 3,
}: UseBookProgressWSOptions): UseBookProgressWSReturn {
  const [status, setStatus] = useState<WSConnectionStatus>('disconnected');
  const [progress, setProgress] = useState(0);
  const [currentChapter, setCurrentChapter] = useState(0);
  const [totalChapters, setTotalChapters] = useState(0);
  const [message, setMessage] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const pingInterval = useRef<NodeJS.Timeout | null>(null);
  const noProgressTimeout = useRef<NodeJS.Timeout | null>(null);
  const lastProgressTime = useRef<number>(0);

  const onProgressRef = useRef(onProgress);
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  const connectRef = useRef<() => void>(() => {});

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const { isAuthenticated } = useAuthStore();

  const buildWsUrl = useCallback((): string | null => {
    if (!isAuthenticated) return null;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.port;
    const portSuffix = port ? `:${port}` : '';

    // Pass token as query param — HttpOnly cookies are scoped to /api/ path
    // and not sent on /ws/ WebSocket connections
    const token = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';

    return `${protocol}//${host}${portSuffix}/ws/book-progress/${bookId}${tokenParam}`;
  }, [isAuthenticated, bookId]);

  /**
   * Send message to WebSocket server
   */
  const sendMessage = useCallback((data: Record<string, string>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  /**
   * Request cancel processing
   */
  const requestCancel = useCallback(() => {
    sendMessage({ type: 'cancel' });
  }, [sendMessage]);

  /**
   * Disconnect WebSocket
   */
  const disconnect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }
    if (pingInterval.current) {
      clearInterval(pingInterval.current);
      pingInterval.current = null;
    }
    if (noProgressTimeout.current) {
      clearTimeout(noProgressTimeout.current);
      noProgressTimeout.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  /**
   * Connect to WebSocket server
   */
  const connect = useCallback(() => {
    const wsUrl = buildWsUrl();
    if (!wsUrl || !bookId) {
      return;
    }

    // Cleanup existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    setStatus('connecting');
    if (import.meta.env.DEV) logger.debug('[useBookProgressWS] Connecting to WebSocket...');

    try {
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        logger.debug('[useBookProgressWS] Connected');
        setStatus('connected');
        reconnectAttempts.current = 0;

        // Setup ping interval (every 25s, server expects 30s timeout)
        pingInterval.current = setInterval(() => {
          sendMessage({ type: 'ping' });
        }, 25000);
      };

      wsRef.current.onmessage = async (event) => {
        try {
          // Handle both text and Blob messages
          let rawData = event.data;
          if (event.data instanceof Blob) {
            rawData = await event.data.text();
          }

          const data: BookProgressUpdate = JSON.parse(rawData);
          logger.debug('[useBookProgressWS] Message:', data.type, data.progress);

          switch (data.type) {
            case 'progress':
              setProgress(data.progress || 0);
              setCurrentChapter(data.chapter || 0);
              setTotalChapters(data.total_chapters || 0);
              setMessage(data.message || '');
              lastProgressTime.current = Date.now();
              onProgressRef.current?.(data);
              break;

            case 'completed':
              setProgress(100);
              setStatus('disconnected');
              onCompleteRef.current?.();
              disconnect();
              break;

            case 'error':
              setMessage(data.message || 'Unknown error');
              onErrorRef.current?.(data.message || 'Unknown error');
              break;

            case 'pong':
              // Keepalive response, no action needed
              break;

            case 'connected':
              logger.debug('[useBookProgressWS] Server confirmed connection');
              break;
          }
        } catch (e) {
          logger.error('[useBookProgressWS] Failed to parse message:', e);
        }
      };

      wsRef.current.onerror = (error) => {
        logger.error('[useBookProgressWS] Error:', error);
        setStatus('error');
      };

      wsRef.current.onclose = (event) => {
        logger.debug('[useBookProgressWS] Closed:', event.code, event.reason);

        if (pingInterval.current) {
          clearInterval(pingInterval.current);
          pingInterval.current = null;
        }

        // Attempt reconnect if not intentional close
        if (enabled && event.code !== 1000 && reconnectAttempts.current < maxReconnectAttempts) {
          reconnectAttempts.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
          logger.debug(`[useBookProgressWS] Reconnecting in ${delay}ms...`);

          reconnectTimeout.current = setTimeout(() => {
            connectRef.current();
          }, delay);
        } else {
          setStatus('disconnected');
        }
      };
    } catch (e) {
      logger.error('[useBookProgressWS] Failed to create WebSocket:', e);
      setStatus('error');
    }
  }, [bookId, buildWsUrl, enabled, maxReconnectAttempts, disconnect, sendMessage]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // Connect/disconnect based on enabled state
  useEffect(() => {
    if (enabled && bookId && isAuthenticated) {
      const connectTimer = setTimeout(connect, 0);

      const fetchInitialStatus = async () => {
        try {
          const response = await booksAPI.getParsingStatus(bookId);
          const data = response as {
            progress?: number;
            status?: string;
            chapter?: number;
            total_chapters?: number;
          };

          if (data && typeof data.progress === 'number') {
            logger.debug('[useBookProgressWS] Initial status fetched:', data.progress, data.status);
            setProgress(data.progress);
            if (data.chapter) setCurrentChapter(data.chapter);
            if (data.total_chapters) setTotalChapters(data.total_chapters);

            // Race condition fix: see docs/plans/parsing-overlay-bug-report-2026-02-05.md
            if (data.status === 'completed') {
              setProgress(100);
              onCompleteRef.current?.();
              disconnect();
            } else if (data.progress > 0) {
              lastProgressTime.current = Date.now();
            }
          }
        } catch (e) {
          logger.error('[useBookProgressWS] Failed to fetch initial status:', e);
        }
      };

      const timeoutId = setTimeout(() => {
        fetchInitialStatus();
      }, 1000);

      return () => {
        clearTimeout(connectTimer);
        clearTimeout(timeoutId);
        disconnect();
      };
    } else {
      const disconnectTimer = setTimeout(disconnect, 0);
      return () => clearTimeout(disconnectTimer);
    }
  }, [enabled, bookId, isAuthenticated, connect, disconnect]);

  useEffect(() => {
    if (!enabled) return;

    lastProgressTime.current = Date.now();

    const BASE_TIMEOUT_MS = 180000;
    // Portrait generation for large books (100+ entities) can take 15-20 min.
    // Was 600s — bumped to 1200s to prevent false timeouts during this phase.
    const FINALIZATION_TIMEOUT_MS = 1200000;
    const CHECK_INTERVAL_MS = 10000;

    const checkNoProgress = () => {
      const timeoutMs = progress >= 80 ? FINALIZATION_TIMEOUT_MS : BASE_TIMEOUT_MS;
      const timeSinceLastProgress = Date.now() - lastProgressTime.current;
      if (timeSinceLastProgress > timeoutMs && progress < 100) {
        logger.warn(
          `[useBookProgressWS] No progress for ${timeoutMs / 1000}s (at ${progress}%), closing overlay`
        );
        onErrorRef.current?.('Processing timeout: no progress received');
        disconnect();
      }
    };

    noProgressTimeout.current = setInterval(
      checkNoProgress,
      CHECK_INTERVAL_MS
    ) as unknown as NodeJS.Timeout;

    return () => {
      if (noProgressTimeout.current) {
        clearInterval(noProgressTimeout.current);
        noProgressTimeout.current = null;
      }
    };
  }, [enabled, progress, disconnect]);

  return {
    status,
    progress,
    currentChapter,
    totalChapters,
    message,
    requestCancel,
    disconnect,
  };
}

export default useBookProgressWS;
