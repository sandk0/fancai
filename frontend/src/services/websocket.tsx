/**
 * WebSocket Service
 * 
 * @deprecated DISABLED - Backend doesn't support cookie authentication for WebSocket yet.
 * All methods are no-ops until backend implements WS cookie auth.
 * 
 * TODO: Re-enable when backend adds WebSocket cookie authentication support.
 * Previous implementation preserved in git history (commit before 2026-01-29).
 */

import React from 'react';

export type WebSocketEventType = 
  | 'book_processing_started'
  | 'book_processing_completed'
  | 'book_processing_failed'
  | 'image_generation_started'
  | 'image_generation_completed'
  | 'image_generation_failed'
  | 'chapter_descriptions_extracted'
  | 'entities_updated'
  | 'user_notification';

export interface WebSocketMessage {
  type: WebSocketEventType;
  data: unknown;
  timestamp: string;
  user_id?: string;
}

class WebSocketService {
  /**
   * @deprecated WebSocket disabled - backend doesn't support cookie auth
   */
  connect(): Promise<void> {
    if (import.meta.env.DEV) {
      console.warn('[WebSocket] connect() called but WebSocket is disabled. Backend cookie auth not implemented.');
    }
    return Promise.resolve();
  }

  send(_message: unknown): void {
    if (import.meta.env.DEV) {
      console.warn('[WebSocket] send() called but WebSocket is disabled.');
    }
  }

  disconnect(): void {}

  getConnectionState(): string {
    return 'DISABLED';
  }

  isWebSocketConnected(): boolean {
    return false;
  }
}

export const websocketService = new WebSocketService();

export const useWebSocket = () => {
  return {
    connect: () => websocketService.connect(),
    disconnect: () => websocketService.disconnect(),
    send: (message: unknown) => websocketService.send(message),
    isConnected: false,
    connectionState: 'DISABLED',
  };
};

/**
 * @deprecated WebSocket is disabled until backend implements cookie authentication
 */
export const useAutoWebSocket = () => {
  return useWebSocket();
};

export const WebSocketStatus: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <div className="w-2 h-2 rounded-full bg-gray-500" />
      <span className="text-xs text-muted-foreground">Disabled</span>
    </div>
  );
};
