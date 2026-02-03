import { logger } from '@/lib/logger';

export type TabSyncMessage =
  | { type: 'logout' }
  | { type: 'auth-change'; authenticated: boolean }
  | { type: 'progress-update'; bookId: string; chapter: number; progress: number; page: number };

interface ChannelPayload {
  tabId: string;
  message: TabSyncMessage;
}

type MessageCallback = (data: TabSyncMessage) => void;

class TabSyncService {
  private channel: BroadcastChannel | null = null;
  private listeners = new Map<string, Set<MessageCallback>>();
  private tabId = Math.random().toString(36).slice(2) + Date.now().toString(36);

  init(): void {
    if (typeof BroadcastChannel === 'undefined') {
      logger.debug('[TabSync] BroadcastChannel not supported, skipping');
      return;
    }

    try {
      this.channel = new BroadcastChannel('fancai-tab-sync');
      this.channel.onmessage = (event: MessageEvent<ChannelPayload>) => {
        const { tabId, message } = event.data;
        if (tabId === this.tabId) return;

        const callbacks = this.listeners.get(message.type);
        if (callbacks) {
          for (const cb of callbacks) {
            cb(message);
          }
        }
      };
      logger.debug('[TabSync] Initialized');
    } catch (error) {
      logger.error('[TabSync] Failed to initialize:', error);
    }
  }

  broadcast(message: TabSyncMessage): void {
    if (!this.channel) return;

    try {
      const payload: ChannelPayload = { tabId: this.tabId, message };
      this.channel.postMessage(payload);
    } catch (error) {
      logger.error('[TabSync] Failed to broadcast:', error);
    }
  }

  subscribe(type: TabSyncMessage['type'], callback: MessageCallback): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(callback);

    return () => {
      this.listeners.get(type)?.delete(callback);
    };
  }

  destroy(): void {
    this.channel?.close();
    this.channel = null;
    this.listeners.clear();
    logger.debug('[TabSync] Destroyed');
  }
}

export const tabSync = new TabSyncService();
