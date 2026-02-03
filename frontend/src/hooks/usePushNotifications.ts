/**
 * usePushNotifications - Hook for managing Web Push notifications
 *
 * Provides reactive state management for push notification subscriptions
 * with TanStack Query mutations and automatic status checking.
 *
 * Features:
 * - Permission state tracking
 * - Subscription status management
 * - Subscribe/unsubscribe mutations
 * - iOS Safari standalone mode detection
 * - Graceful degradation when Push API unavailable
 *
 * @module hooks/usePushNotifications
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pushManager } from '@/services/pushNotifications';
import type { PushPermissionState } from '@/types/push';
import { logger } from '@/lib/logger';

// =============================================================================
// Query Keys
// =============================================================================

export const pushKeys = {
  /** Base key for all push-related queries */
  all: ['push'] as const,
  /** Subscription status query key */
  subscription: () => [...pushKeys.all, 'subscription'] as const,
  /** Permission state query key */
  permission: () => [...pushKeys.all, 'permission'] as const,
} as const;

// =============================================================================
// Hook Return Type
// =============================================================================

export interface UsePushNotificationsReturn {
  /** Whether Push API is supported in the current browser */
  isSupported: boolean;
  /** Whether push can be used (accounts for iOS standalone requirement) */
  canUsePush: boolean;
  /** Reason why push is unavailable (for UI feedback) */
  unavailableReason: string | null;
  /** Current permission state ('granted' | 'denied' | 'default' | 'loading') */
  permissionState: PushPermissionState;
  /** Whether user is currently subscribed to push notifications */
  isSubscribed: boolean;
  /** Whether any push operation is in progress */
  isLoading: boolean;
  /** Whether subscription check is in progress */
  isCheckingSubscription: boolean;
  /** Error message (if any) */
  error: string | null;
  /** Subscribe to push notifications */
  subscribe: () => Promise<void>;
  /** Unsubscribe from push notifications */
  unsubscribe: () => Promise<void>;
  /** Check current subscription status */
  checkSubscription: () => Promise<void>;
  /** Test push notification (for debugging) */
  testNotification: () => Promise<void>;
  /** Whether running on iOS Safari */
  isIOSSafari: boolean;
  /** Whether app is in standalone (PWA) mode */
  isStandalone: boolean;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for managing push notification subscriptions
 *
 * @example
 * ```tsx
 * function PushSettings() {
 *   const {
 *     isSupported,
 *     canUsePush,
 *     unavailableReason,
 *     permissionState,
 *     isSubscribed,
 *     isLoading,
 *     error,
 *     subscribe,
 *     unsubscribe,
 *   } = usePushNotifications();
 *
 *   // Don't show UI if push is not supported
 *   if (!isSupported) {
 *     return null;
 *   }
 *
 *   // Show reason if can't use push (e.g., iOS not in standalone)
 *   if (!canUsePush) {
 *     return <p className="text-muted">{unavailableReason}</p>;
 *   }
 *
 *   // Show permission denied message
 *   if (permissionState === 'denied') {
 *     return <p className="text-destructive">Notifications blocked. Enable in browser settings.</p>;
 *   }
 *
 *   return (
 *     <Switch
 *       checked={isSubscribed}
 *       disabled={isLoading}
 *       onCheckedChange={(checked) => checked ? subscribe() : unsubscribe()}
 *     />
 *   );
 * }
 * ```
 */
export function usePushNotifications(): UsePushNotificationsReturn {
  // Local state for error handling
  const [error, setError] = useState<string | null>(null);

  // Query client for cache invalidation
  const queryClient = useQueryClient();

  // Check support once on mount
  const isSupported = pushManager.isSupported();
  const canUsePush = pushManager.canUsePush();
  const unavailableReason = pushManager.getUnavailableReason();
  const isIOSSafari = pushManager.isIOSSafari();
  const isStandalone = pushManager.isStandalone();

  // =========================================================================
  // Permission State Query
  // =========================================================================

  const {
    data: permissionState = 'loading' as PushPermissionState,
    isLoading: isLoadingPermission,
  } = useQuery({
    queryKey: pushKeys.permission(),
    queryFn: async (): Promise<PushPermissionState> => {
      if (!isSupported) {
        return 'denied';
      }
      return pushManager.getPermissionState();
    },
    staleTime: Infinity, // Permission doesn't change unless user acts
    enabled: isSupported,
    // Update when permission changes via browser UI
    refetchOnWindowFocus: true,
  });

  // =========================================================================
  // Subscription Status Query
  // =========================================================================

  const {
    data: subscription = null,
    isLoading: isCheckingSubscription,
    refetch: refetchSubscription,
  } = useQuery({
    queryKey: pushKeys.subscription(),
    queryFn: async () => {
      if (!canUsePush) {
        return null;
      }
      return pushManager.getSubscription();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: canUsePush,
    // Update when window regains focus (subscription might have changed)
    refetchOnWindowFocus: true,
  });

  const isSubscribed = subscription !== null;

  // =========================================================================
  // Subscribe Mutation
  // =========================================================================

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      setError(null);
      return pushManager.subscribe();
    },
    onSuccess: () => {
      logger.debug('[usePushNotifications] Subscribed successfully');
      // Invalidate both queries to refresh state
      queryClient.invalidateQueries({ queryKey: pushKeys.subscription() });
      queryClient.invalidateQueries({ queryKey: pushKeys.permission() });
    },
    onError: (err: Error) => {
      logger.error('[usePushNotifications] Subscribe error:', err);
      setError(err.message);
    },
  });

  // =========================================================================
  // Unsubscribe Mutation
  // =========================================================================

  const unsubscribeMutation = useMutation({
    mutationFn: async () => {
      setError(null);
      return pushManager.unsubscribe();
    },
    onSuccess: () => {
      logger.debug('[usePushNotifications] Unsubscribed successfully');
      // Invalidate subscription query
      queryClient.invalidateQueries({ queryKey: pushKeys.subscription() });
    },
    onError: (err: Error) => {
      logger.error('[usePushNotifications] Unsubscribe error:', err);
      setError(err.message);
    },
  });

  // =========================================================================
  // Test Notification Mutation
  // =========================================================================

  const testNotificationMutation = useMutation({
    mutationFn: async () => {
      setError(null);
      return pushManager.testNotification();
    },
    onError: (err: Error) => {
      logger.error('[usePushNotifications] Test notification error:', err);
      setError(err.message);
    },
  });

  // =========================================================================
  // Actions
  // =========================================================================

  const subscribe = useCallback(async () => {
    await subscribeMutation.mutateAsync();
  }, [subscribeMutation]);

  const unsubscribe = useCallback(async () => {
    await unsubscribeMutation.mutateAsync();
  }, [unsubscribeMutation]);

  const checkSubscription = useCallback(async () => {
    await refetchSubscription();
  }, [refetchSubscription]);

  const testNotification = useCallback(async () => {
    await testNotificationMutation.mutateAsync();
  }, [testNotificationMutation]);

  // =========================================================================
  // Permission Change Listener
  // =========================================================================

  useEffect(() => {
    if (!isSupported) return;

    // Listen for permission changes via Permissions API (if available)
    // This catches when user changes permission in browser settings
    const checkPermissionChange = async () => {
      if ('permissions' in navigator) {
        try {
          const status = await navigator.permissions.query({
            name: 'notifications',
          });

          const handleChange = () => {
            logger.debug('[usePushNotifications] Permission changed:', status.state);
            queryClient.invalidateQueries({ queryKey: pushKeys.permission() });
            queryClient.invalidateQueries({ queryKey: pushKeys.subscription() });
          };

          status.addEventListener('change', handleChange);
          return () => status.removeEventListener('change', handleChange);
        } catch {
          // Permissions API not available or notifications not supported
          return undefined;
        }
      }
      return undefined;
    };

    let cleanup: (() => void) | undefined;
    checkPermissionChange().then((c) => {
      cleanup = c;
    });

    return () => cleanup?.();
  }, [isSupported, queryClient]);

  // =========================================================================
  // Return Value
  // =========================================================================

  const isLoading =
    isLoadingPermission ||
    isCheckingSubscription ||
    subscribeMutation.isPending ||
    unsubscribeMutation.isPending ||
    testNotificationMutation.isPending;

  return {
    // Support flags
    isSupported,
    canUsePush,
    unavailableReason,
    isIOSSafari,
    isStandalone,

    // State
    permissionState,
    isSubscribed,
    isLoading,
    isCheckingSubscription,
    error,

    // Actions
    subscribe,
    unsubscribe,
    checkSubscription,
    testNotification,
  };
}

// =============================================================================
// Type Exports
// =============================================================================

export type { PushPermissionState };
