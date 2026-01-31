/**
 * useReadingSession - Custom hook for automatic reading session tracking
 *
 * Features:
 * - Auto-start session on mount
 * - Periodic position updates (every 30s)
 * - Auto-end session on unmount
 * - Graceful handling of page close (beforeunload)
 * - Offline support (localStorage fallback)
 * - React Query integration for caching
 * - Debounced updates to reduce API calls
 *
 * @param bookId - Book ID to track
 * @param currentPosition - Current reading position (0-100%)
 * @param enabled - Enable/disable tracking
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { readingSessionsAPI } from '@/api/readingSessions';
import { sessionKeys, getCurrentUserId } from '@/hooks/api/queryKeys';
import { visibilityManager } from '@/services/visibilityManager';
import { QUERY_RETRY_PRESETS } from '@/lib/queryClient';
import { notify } from '@/stores/ui';
import type { ReadingSession } from '@/types/api';

interface UseReadingSessionOptions {
  bookId: string;
  currentPosition: number;
  enabled?: boolean;
  updateInterval?: number; // milliseconds, default 30000 (30s)
  onSessionStart?: (session: ReadingSession) => void;
  onSessionEnd?: (session: ReadingSession) => void;
  onError?: (error: Error) => void;
}

interface UseReadingSessionReturn {
  session: ReadingSession | null;
  isLoading: boolean;
  error: Error | null;
  updatePosition: (position: number) => void;
  endSession: () => Promise<void>;
}

const UPDATE_DEBOUNCE_MS = 5000; // 5 seconds debounce for position updates
const UPDATE_INTERVAL_MS = 30000; // 30 seconds interval for forced updates

export function useReadingSession({
  bookId,
  currentPosition,
  enabled = true,
  updateInterval = UPDATE_INTERVAL_MS,
  onSessionStart,
  onSessionEnd,
  onError,
}: UseReadingSessionOptions): UseReadingSessionReturn {
  const queryClient = useQueryClient();
  const userId = getCurrentUserId();
  const [session, setSession] = useState<ReadingSession | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isEndingRef = useRef(false);
  const hasStartedRef = useRef(false);

  // Ref to track current position without causing re-renders in interval callbacks
  const positionRef = useRef(currentPosition);

  // Keep positionRef in sync with currentPosition
  useEffect(() => {
    positionRef.current = currentPosition;
  }, [currentPosition]);

  // Query for active session (check if there's an existing session)
  const { data: activeSession, isLoading: isLoadingActive } = useQuery({
    queryKey: sessionKeys.active(userId),
    queryFn: readingSessionsAPI.getActiveSession,
    enabled: enabled && !hasStartedRef.current,
    staleTime: 0, // Always refetch to prevent reading closed session from cache
  });

  // Mutation to start session
  const startMutation = useMutation({
    mutationFn: ({ bookId, position, force }: { bookId: string; position: number; force?: boolean }) =>
      readingSessionsAPI.startSession(bookId, position, undefined, force),
    onSuccess: (newSession) => {
      console.log('✅ [useReadingSession] Session started:', newSession.id);
      setSession(newSession);
      sessionIdRef.current = newSession.id;
      hasStartedRef.current = true;
      queryClient.setQueryData(sessionKeys.active(userId), newSession);
      queryClient.setQueryData(sessionKeys.detail(userId, newSession.id), newSession);
      onSessionStart?.(newSession);
    },
    onError: (error: any) => {
      console.error('❌ [useReadingSession] Failed to start session:', error);
      
      // Handle Split Brain (409 Conflict)
      if (error?.response?.status === 409) {
        const detail = error.response.data.detail;
        console.warn('⚠️ [useReadingSession] Split brain detected:', detail);
        
        notify.warning(
          'Session Conflict',
          `This book is open on another device (started ${new Date(detail.started_at).toLocaleTimeString()}).`,
          {
            label: 'Take Control Here',
            onClick: () => {
              startMutation.mutate({ bookId, position: positionRef.current, force: true });
            }
          }
        );
        return;
      }

      onError?.(error as Error);
    },
  });

  // Mutation to update session position
  const updateMutation = useMutation({
    mutationFn: ({ sessionId, position }: { sessionId: string; position: number }) =>
      readingSessionsAPI.updateSession(sessionId, position),
    ...QUERY_RETRY_PRESETS.api, // Retry on network errors
    onSuccess: (updatedSession) => {
      console.log('✅ [useReadingSession] Position updated:', updatedSession.end_position);
      setSession(updatedSession);
      queryClient.setQueryData(sessionKeys.detail(userId, updatedSession.id), updatedSession);
      lastUpdateRef.current = Date.now();
    },
    onError: (error: any) => {
      console.error('❌ [useReadingSession] Failed to update session:', error);
      
      const status = error?.response?.status;
      const detail = error?.response?.data?.detail || '';
      
      if (status === 400) {
        if (detail.includes('inactive') || detail.includes('ended')) {
          console.warn('[useReadingSession] Session inactive/ended, stopping updates');
          
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          
          queryClient.invalidateQueries({ queryKey: sessionKeys.active(userId) });
          
          if (enabled && bookId) {
            console.log('[useReadingSession] Attempting to restart session...');
            startMutation.mutate({ bookId, position: positionRef.current });
          }
          return;
        }
        
        console.warn('[useReadingSession] Validation error:', detail);
        return;
      }
    },
  });

  // Mutation to end session
  const endMutation = useMutation({
    mutationFn: ({ sessionId, position }: { sessionId: string; position: number }) =>
      readingSessionsAPI.endSession(sessionId, position),
    ...QUERY_RETRY_PRESETS.critical, // Retry aggressively to ensure session ends
    onSuccess: (endedSession) => {
      console.log('✅ [useReadingSession] Session ended:', {
        id: endedSession.id,
        duration: endedSession.duration_minutes,
        pages_read: endedSession.pages_read,
      });
      setSession(endedSession);
      queryClient.setQueryData(sessionKeys.detail(userId, endedSession.id), endedSession);
      queryClient.setQueryData(sessionKeys.active(userId), null);
      onSessionEnd?.(endedSession);
      isEndingRef.current = false;
    },
    onError: (error) => {
      console.error('❌ [useReadingSession] Failed to end session:', error);
      isEndingRef.current = false;
      onError?.(error as Error);
    },
  });

  /**
   * Debounced position update
   */
  const updatePosition = useCallback(
    (position: number) => {
      if (!enabled || !sessionIdRef.current || isEndingRef.current) {
        return;
      }

      // Clear previous timeout
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }

      // Debounce update
      updateTimeoutRef.current = setTimeout(() => {
        const now = Date.now();
        const timeSinceLastUpdate = now - lastUpdateRef.current;

        // Only update if enough time has passed or position changed significantly
        if (
          timeSinceLastUpdate >= UPDATE_DEBOUNCE_MS &&
          sessionIdRef.current &&
          !isEndingRef.current
        ) {
          console.log('🔄 [useReadingSession] Updating position:', position.toFixed(2) + '%');
          updateMutation.mutate({
            sessionId: sessionIdRef.current,
            position,
          });
        }
      }, UPDATE_DEBOUNCE_MS);
    },
    [enabled, updateMutation]
  );

  /**
   * End current session
   */
  const endSession = useCallback(async () => {
    if (!sessionIdRef.current || isEndingRef.current) {
      return;
    }

    isEndingRef.current = true;

    // Clear any pending updates
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }

    // Clear interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    console.log('🛑 [useReadingSession] Ending session:', sessionIdRef.current);

    try {
      await endMutation.mutateAsync({
        sessionId: sessionIdRef.current,
        position: positionRef.current,
      });
    } catch (error) {
      console.error('❌ [useReadingSession] Error ending session:', error);
    } finally {
      sessionIdRef.current = null;
      hasStartedRef.current = false;
    }
  }, [endMutation]);

  /**
   * Effect 1: Start or continue session on mount
   *
   * CRITICAL FIX: Removed currentPosition and startMutation from dependencies
   * to prevent infinite loop when user scrolls.
   *
   * Dependencies explained:
   * - enabled: User can enable/disable tracking
   * - bookId: New book = new session
   * - activeSession: Need to check if session exists
   * - isLoadingActive: Wait for active session check to complete
   */
  useEffect(() => {
    if (!enabled || hasStartedRef.current) {
      return;
    }

    console.log('🚀 [useReadingSession] Initializing session for book:', bookId);

    // Check if there's an active session
    if (activeSession && activeSession.book_id === bookId) {
      console.log('✅ [useReadingSession] Continuing existing session:', activeSession.id);
      setSession(activeSession);
      sessionIdRef.current = activeSession.id;
      hasStartedRef.current = true;
    } else if (!isLoadingActive) {
      // Start new session only if:
      // - No active session exists
      // - Not already starting a session
      // - Haven't started a session yet
      if (!startMutation.isPending && !hasStartedRef.current) {
        console.log('✅ [useReadingSession] Starting new session');
        startMutation.mutate({ bookId, position: currentPosition });
      }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    bookId,
    activeSession,
    isLoadingActive,
    // Intentionally omitted: currentPosition (causes infinite loop on scroll),
    // startMutation (object reference changes on every render)
  ]);

  /**
   * Effect 2: Periodic position updates
   * Uses positionRef.current to avoid re-running effect on every position change
   */
  useEffect(() => {
    if (!enabled || !sessionIdRef.current || isEndingRef.current) {
      return;
    }

    const startInterval = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      intervalRef.current = setInterval(() => {
        if (sessionIdRef.current && !isEndingRef.current) {
          if (import.meta.env.DEV) {
            console.log('[useReadingSession] Periodic update triggered');
          }
          updatePosition(positionRef.current);
        }
      }, updateInterval);
    };

    // Start interval initially
    startInterval();

    // Register with visibility manager
    visibilityManager.register({
      id: 'reading-session-manager',
      priority: 2, // Medium priority (after guards)
      delay: 300, // Debounce interval resume
      onHidden: () => {
        // Stop interval when app goes to background
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
          if (import.meta.env.DEV) {
            console.log('[useReadingSession] Interval paused (background)');
          }
        }
      },
      onVisible: () => {
        // Restart interval when app resumes
        if (enabled && sessionIdRef.current && !isEndingRef.current) {
          startInterval();
          if (import.meta.env.DEV) {
            console.log('[useReadingSession] Interval resumed');
          }
        }
      },
      shouldRun: () => enabled && !!sessionIdRef.current && !isEndingRef.current,
    });

    return () => {
      visibilityManager.unregister('reading-session-manager');
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, updateInterval, updatePosition]);

  /**
   * Effect 3: Update position when it changes
   *
   * NOTE: This effect is intentionally commented out to prevent excessive API calls.
   * Position updates are now handled ONLY by:
   * 1. Periodic interval (every 30s) - Effect 2
   * 2. Manual calls to updatePosition() from parent component
   *
   * RATIONALE: currentPosition changes on every scroll event (potentially 60 times/second).
   * Even with debouncing, this creates unnecessary effect re-runs.
   * The periodic interval is sufficient for tracking reading progress.
   */
  // useEffect(() => {
  //   if (!enabled || !sessionIdRef.current || isEndingRef.current) {
  //     return;
  //   }
  //
  //   updatePosition(currentPosition);
  // }, [enabled, currentPosition, updatePosition]);

  /**
   * Effect 4: End session on unmount
   * Uses refs to access current values without adding dependencies
   */
  /**
   * Effect 4: End session on unmount
   * Uses refs to access current values without adding dependencies
   */
  // Destructure mutate to get a stable function reference
  const { mutate: endSessionMutate } = endMutation;

  useEffect(() => {
    return () => {
      // End session on component unmount
      if (sessionIdRef.current && !isEndingRef.current) {
        console.log('🧹 [useReadingSession] Component unmounting, ending session');
        // Use beacon API for guaranteed delivery even if page is closing
        const sessionId = sessionIdRef.current;
        const position = positionRef.current;

        // Try to end session gracefully
        endSessionMutate(
          { sessionId, position },
          {
            onError: () => {
              // If graceful end fails, use beacon API as fallback
              try {
                const apiUrl = import.meta.env.VITE_API_URL || '/api/v1';
                navigator.sendBeacon(
                  `${apiUrl}/reading-sessions/${sessionId}/end`,
                  JSON.stringify({
                    end_position: Math.round(position),
                    _beacon: true,
                  })
                );
              } catch (err) {
                console.error('❌ [useReadingSession] Beacon fallback failed:', err);
              }
            },
          }
        );
      }

      // Clear timeouts
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [endSessionMutate]);

  /**
   * Effect 5: beforeunload handler for graceful page close
   * Uses positionRef.current to get latest position without dependency on currentPosition
   */
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleBeforeUnload = () => {
      if (sessionIdRef.current && !isEndingRef.current) {
        console.log('🚪 [useReadingSession] Page closing, ending session');

        // Try beacon API first (works even when page is closing)
        try {
          const apiUrl = import.meta.env.VITE_API_URL || '/api/v1';

          const beaconData = new Blob(
            [
              JSON.stringify({
                end_position: Math.round(positionRef.current),
              }),
            ],
            { type: 'application/json' }
          );

          navigator.sendBeacon(
            `${apiUrl}/reading-sessions/${sessionIdRef.current}/end-beacon`,
            beaconData
          );
        } catch (error) {
          console.error('❌ [useReadingSession] Beacon API failed:', error);
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [enabled]);

  return {
    session,
    isLoading: isLoadingActive || startMutation.isPending,
    error: startMutation.error || updateMutation.error || endMutation.error,
    updatePosition,
    endSession,
  };
}
