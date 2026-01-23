/**
 * useBookProgressWS - WebSocket hook for real-time book processing progress
 *
 * Phase 5: WebSocket Implementation
 *
 * Features:
 * - Automatic connection/reconnection
 * - JWT authentication via query param
 * - Ping/pong keepalive
 * - Graceful cleanup on unmount
 * - Fallback to polling on connection failure
 *
 * @module hooks/useBookProgressWS
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/stores/auth';
import { booksAPI } from '@/api/books';

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

    const { accessToken } = useAuthStore();

    /**
     * Build WebSocket URL with proper protocol and auth token
     */
    const buildWsUrl = useCallback(() => {
        const baseUrl = import.meta.env.VITE_WS_URL || window.location.origin;
        const wsProtocol = baseUrl.startsWith('https') ? 'wss' : 'ws';
        const wsHost = baseUrl.replace(/^https?/, wsProtocol);
        return `${wsHost}/ws/book-progress/${bookId}?token=${accessToken}`;
    }, [bookId, accessToken]);

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
        if (!accessToken || !bookId) {
            console.warn('[useBookProgressWS] Missing token or bookId');
            return;
        }

        // Cleanup existing connection
        if (wsRef.current) {
            wsRef.current.close();
        }

        setStatus('connecting');
        const wsUrl = buildWsUrl();
        console.log('[useBookProgressWS] Connecting to:', wsUrl.replace(accessToken, '***'));

        try {
            wsRef.current = new WebSocket(wsUrl);

            wsRef.current.onopen = () => {
                console.log('[useBookProgressWS] Connected');
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
                    console.log('[useBookProgressWS] Message:', data.type, data.progress);

                    switch (data.type) {
                        case 'progress':
                            setProgress(data.progress || 0);
                            setCurrentChapter(data.chapter || 0);
                            setTotalChapters(data.total_chapters || 0);
                            setMessage(data.message || '');
                            onProgress?.(data);
                            break;

                        case 'completed':
                            setProgress(100);
                            setStatus('disconnected');
                            onComplete?.();
                            disconnect();
                            break;

                        case 'error':
                            setMessage(data.message || 'Unknown error');
                            onError?.(data.message || 'Unknown error');
                            break;

                        case 'pong':
                            // Keepalive response, no action needed
                            break;

                        case 'connected':
                            console.log('[useBookProgressWS] Server confirmed connection');
                            break;
                    }
                } catch (e) {
                    console.error('[useBookProgressWS] Failed to parse message:', e);
                }
            };

            wsRef.current.onerror = (error) => {
                console.error('[useBookProgressWS] Error:', error);
                setStatus('error');
            };

            wsRef.current.onclose = (event) => {
                console.log('[useBookProgressWS] Closed:', event.code, event.reason);

                if (pingInterval.current) {
                    clearInterval(pingInterval.current);
                    pingInterval.current = null;
                }

                // Attempt reconnect if not intentional close
                if (enabled && event.code !== 1000 && reconnectAttempts.current < maxReconnectAttempts) {
                    reconnectAttempts.current++;
                    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
                    console.log(`[useBookProgressWS] Reconnecting in ${delay}ms...`);

                    reconnectTimeout.current = setTimeout(() => {
                        connect();
                    }, delay);
                } else {
                    setStatus('disconnected');
                }
            };
        } catch (e) {
            console.error('[useBookProgressWS] Failed to create WebSocket:', e);
            setStatus('error');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bookId, accessToken, buildWsUrl, enabled, maxReconnectAttempts]);

    // Connect/disconnect based on enabled state
    useEffect(() => {
        if (enabled && bookId && accessToken) {
            connect();

            // Initial fetch to get current state immediately (in case WS is silent initially)
            // This prevents the "0% stuck" issue if the backend is between updates
            const fetchInitialStatus = async () => {
                try {
                    const response = await booksAPI.getParsingStatus(bookId);
                    const data = response as any;

                    if (data && typeof data.progress === 'number') {
                        console.log('[useBookProgressWS] Initial status fetched:', data.progress, data.status);
                        setProgress(data.progress);
                        if (data.chapter) setCurrentChapter(data.chapter);
                        if (data.total_chapters) setTotalChapters(data.total_chapters);

                        // CRITICAL FIX: Close overlay if processing is done or not started
                        if (data.status === 'completed' || data.status === 'not_started') {
                            if (data.status === 'completed') setProgress(100);
                            onComplete?.();
                            disconnect();
                        }
                    }
                } catch (e) {
                    console.error('[useBookProgressWS] Failed to fetch initial status:', e);
                }
            };

            const timeoutId = setTimeout(() => {
                fetchInitialStatus();
            }, 1000);

            return () => {
                clearTimeout(timeoutId);
                disconnect();
            };
        } else {
            disconnect();
        }
    }, [enabled, bookId, accessToken, connect, disconnect]);

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
