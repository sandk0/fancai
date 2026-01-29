// Reading Sessions API methods

import { apiClient } from './client';
import type {
  ReadingSession,
  StartSessionRequest,
  UpdateSessionRequest,
  EndSessionRequest,
  ReadingSessionHistory,
  PaginationParams,
} from '@/types/api';

/**
 * Reading Sessions API Client
 *
 * Provides methods for tracking user reading sessions:
 * - Start session when user opens a book
 * - Update session position periodically
 * - End session when user closes the book
 * - Retrieve session history
 *
 * Features:
 * - Automatic position tracking
 * - Duration calculation
 * - Device type detection
 * - Offline support (localStorage fallback)
 */
export const readingSessionsAPI = {
  /**
   * Start a new reading session
   *
   * @param bookId - Book ID
   * @param startPosition - Starting position (0-100%)
   * @param deviceType - Device type (desktop, mobile, tablet)
   * @returns Created session
   */
  async startSession(
    bookId: string,
    startPosition: number,
    deviceType?: string
  ): Promise<ReadingSession> {
    const data: StartSessionRequest = {
      book_id: bookId,
      start_position: Math.round(Math.max(0, Math.min(100, startPosition))),
      device_type: deviceType || detectDeviceType(),
    };

    try {
      // Use any to handle both wrapped and unwrapped responses
      const response = await apiClient.post<any>(
        '/reading-sessions/start',
        data
      );

      // Handle both { session: ... } and flat ReadingSession
      const session = response.session || response;

      if (!session || !session.id) {
        throw new Error('Invalid session response from server');
      }

      return session;
    } catch (error) {
      console.error('❌ [ReadingSessions] Failed to start session:', error);

      // Fallback: save to localStorage for later sync
      savePendingSession('start', data);

      // Return mock session for offline mode
      return createMockSession(bookId, startPosition, deviceType);
    }
  },

  /**
   * Update current session position
   *
   * @param sessionId - Session ID
   * @param currentPosition - Current position (0-100%)
   * @returns Updated session
   */
  async updateSession(
    sessionId: string,
    currentPosition: number
  ): Promise<ReadingSession> {
    const data: UpdateSessionRequest = {
      current_position: Math.round(Math.max(0, Math.min(100, currentPosition))),
    };

    try {
      const response = await apiClient.put<any>(
        `/reading-sessions/${sessionId}/update`,
        data
      );

      const session = response.session || response;

      if (!session || !session.id) {
        throw new Error('Invalid session response from server');
      }

      return session;
    } catch (error) {
      console.error('❌ [ReadingSessions] Failed to update session:', error);

      // Fallback: save to localStorage
      savePendingSession('update', { session_id: sessionId, ...data });

      throw error;
    }
  },

  /**
   * End active reading session
   *
   * @param sessionId - Session ID
   * @param endPosition - End position (0-100%)
   * @returns Ended session with duration
   */
  async endSession(
    sessionId: string,
    endPosition: number
  ): Promise<ReadingSession> {
    const data: EndSessionRequest = {
      end_position: Math.round(Math.max(0, Math.min(100, endPosition))),
    };

    try {
      const response = await apiClient.put<any>(
        `/reading-sessions/${sessionId}/end`,
        data
      );

      const session = response.session || response;

      if (!session || !session.id) {
        throw new Error('Invalid session response from server');
      }

      return session;
    } catch (error) {
      console.error('❌ [ReadingSessions] Failed to end session:', error);

      // Fallback: save to localStorage
      savePendingSession('end', { session_id: sessionId, ...data });

      throw error;
    }
  },

  /**
   * Get active reading session for current user
   *
   * @returns Active session or null
   */
  async getActiveSession(): Promise<ReadingSession | null> {
    try {
      const response = await apiClient.get<any>('/reading-sessions/active');

      if (!response) return null;

      const session = response.session || response;

      // If response was empty object or null
      if (!session || Object.keys(session).length === 0) return null;

      return session;
    } catch (error) {
      console.error('❌ [ReadingSessions] Failed to get active session:', error);
      return null;
    }
  },

  /**
   * Get reading session history
   *
   * @param skip - Number of sessions to skip
   * @param limit - Max sessions to return
   * @returns Session history with pagination
   */
  async getHistory(
    params?: PaginationParams
  ): Promise<ReadingSessionHistory> {
    const searchParams = new URLSearchParams();
    if (params?.skip) searchParams.append('skip', params.skip.toString());
    if (params?.limit) searchParams.append('limit', params.limit.toString());

    const url = `/reading-sessions/history${searchParams.toString() ? '?' + searchParams.toString() : ''}`;

    try {
      return await apiClient.get<ReadingSessionHistory>(url);
    } catch (error) {
      console.error('❌ [ReadingSessions] Failed to get history:', error);
      return {
        sessions: [],
        total: 0,
        skip: params?.skip || 0,
        limit: params?.limit || 20,
      };
    }
  },

  /**
   * Sync pending sessions from localStorage
   * Called when network connection is restored
   */
  async syncPendingSessions(): Promise<void> {
    const pending = getPendingSessions();
    if (pending.length === 0) return;

    console.log('🔄 [ReadingSessions] Syncing pending sessions:', pending.length);

    for (const item of pending) {
      try {
        switch (item.type) {
          case 'start':
            if (item.data.book_id && item.data.start_position !== undefined) {
              await this.startSession(
                item.data.book_id,
                item.data.start_position,
                item.data.device_type
              );
            }
            break;
          case 'update':
            if (item.data.session_id && item.data.current_position !== undefined) {
              await this.updateSession(
                item.data.session_id,
                item.data.current_position
              );
            }
            break;
          case 'end':
            if (item.data.session_id && item.data.end_position !== undefined) {
              await this.endSession(
                item.data.session_id,
                item.data.end_position
              );
            }
            break;
        }
      } catch (error) {
        console.error('❌ [ReadingSessions] Failed to sync session:', error);
      }
    }

    clearPendingSessions();
    console.log('✅ [ReadingSessions] Pending sessions synced');
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

const PENDING_SESSIONS_KEY = 'bookreader_pending_sessions';

interface PendingSession {
  type: 'start' | 'update' | 'end';
  data: {
    book_id?: string;
    start_position?: number;
    session_id?: string;
    end_position?: number;
    current_position?: number;
    device_type?: string;
  };
  timestamp: string;
}

/**
 * Detect device type based on user agent
 */
function detectDeviceType(): string {
  const ua = navigator.userAgent.toLowerCase();

  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
    return 'tablet';
  }

  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) {
    return 'mobile';
  }

  return 'desktop';
}

/**
 * Create mock session for offline mode
 */
function createMockSession(
  bookId: string,
  startPosition: number,
  deviceType?: string
): ReadingSession {
  return {
    id: `offline_${Date.now()}`,
    book_id: bookId,
    user_id: 'offline',
    started_at: new Date().toISOString(),
    duration_minutes: 0,
    start_position: startPosition,
    end_position: startPosition,
    pages_read: 0,
    device_type: deviceType || detectDeviceType(),
    is_active: true,
  };
}

/**
 * Save pending session to localStorage
 */
function savePendingSession(type: 'start' | 'update' | 'end', data: PendingSession['data']): void {
  try {
    const pending = getPendingSessions();
    pending.push({
      type,
      data,
      timestamp: new Date().toISOString(),
    });
    localStorage.setItem(PENDING_SESSIONS_KEY, JSON.stringify(pending));
  } catch (error) {
    console.error('❌ [ReadingSessions] Failed to save pending session:', error);
  }
}

/**
 * Get pending sessions from localStorage
 */
function getPendingSessions(): PendingSession[] {
  try {
    const stored = localStorage.getItem(PENDING_SESSIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('❌ [ReadingSessions] Failed to get pending sessions:', error);
    return [];
  }
}

/**
 * Clear pending sessions from localStorage
 */
function clearPendingSessions(): void {
  try {
    localStorage.removeItem(PENDING_SESSIONS_KEY);
  } catch (error) {
    console.error('❌ [ReadingSessions] Failed to clear pending sessions:', error);
  }
}
