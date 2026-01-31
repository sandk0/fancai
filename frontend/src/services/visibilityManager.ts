/**
 * Centralized Visibility Manager (January 2026)
 *
 * Single manager for all visibilitychange handlers to prevent race conditions.
 * Handlers are executed in priority order with configurable delays.
 *
 * Problem: 9 separate hooks listening to visibilitychange → race conditions
 * Solution: Centralized priority queue with ordered execution
 *
 * @module services/visibilityManager
 */

export interface VisibilityHandler {
  id: string;
  priority: number;
  delay: number;
  onHidden: () => void | Promise<void>;
  onVisible: () => void | Promise<void>;
  shouldRun?: () => boolean;
}

class VisibilityManager {
  private handlers: Map<string, VisibilityHandler> = new Map();
  private timeouts: Map<string, number> = new Map();
  private isProcessing = false;
  private lastVisibilityState: DocumentVisibilityState = 'visible';

  register(handler: VisibilityHandler): void {
    this.handlers.set(handler.id, handler);
    
    if (import.meta.env.DEV) {
      console.log(`[VisibilityManager] Registered: ${handler.id} (priority ${handler.priority}, delay ${handler.delay}ms)`);
    }
  }

  unregister(id: string): void {
    this.handlers.delete(id);
    
    const timeout = this.timeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(id);
    }
    
    if (import.meta.env.DEV) {
      console.log(`[VisibilityManager] Unregistered: ${id}`);
    }
  }

  private async handleVisibilityChange(): Promise<void> {
    const state = document.visibilityState;
    
    if (state === this.lastVisibilityState) {
      return;
    }
    
    this.lastVisibilityState = state;
    
    if (import.meta.env.DEV) {
      console.log(`[VisibilityManager] State: ${state}, handlers: ${this.handlers.size}`);
    }

    if (this.isProcessing) {
      console.warn('[VisibilityManager] Already processing, skipping');
      return;
    }

    this.isProcessing = true;

    try {
      const sorted = Array.from(this.handlers.values())
        .sort((a, b) => a.priority - b.priority);

      for (const handler of sorted) {
        if (handler.shouldRun && !handler.shouldRun()) {
          if (import.meta.env.DEV) {
            console.log(`[VisibilityManager] Skipping ${handler.id} (precondition failed)`);
          }
          continue;
        }

        const existingTimeout = this.timeouts.get(handler.id);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }

        const timeout = window.setTimeout(async () => {
          try {
            if (state === 'hidden') {
              await handler.onHidden();
            } else {
              await handler.onVisible();
            }
            
            if (import.meta.env.DEV) {
              console.log(`[VisibilityManager] Executed: ${handler.id}`);
            }
          } catch (error) {
            console.error(`[VisibilityManager] Error in ${handler.id}:`, error);
          } finally {
            this.timeouts.delete(handler.id);
          }
        }, handler.delay);

        this.timeouts.set(handler.id, timeout);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  start(): void {
    if (typeof document === 'undefined') {
      console.warn('[VisibilityManager] Document not available, skipping');
      return;
    }

    document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
    this.lastVisibilityState = document.visibilityState;
    
    if (import.meta.env.DEV) {
      console.log('[VisibilityManager] Started');
    }
  }

  stop(): void {
    document.removeEventListener('visibilitychange', () => this.handleVisibilityChange());
    
    this.timeouts.forEach((timeout) => clearTimeout(timeout));
    this.timeouts.clear();
    this.handlers.clear();
    
    if (import.meta.env.DEV) {
      console.log('[VisibilityManager] Stopped');
    }
  }

  getHandlerCount(): number {
    return this.handlers.size;
  }
}

export const visibilityManager = new VisibilityManager();
