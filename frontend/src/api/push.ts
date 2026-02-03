// Push Notifications API methods

import { apiClient } from './client';

/**
 * VAPID public key response
 */
interface VAPIDPublicKeyResponse {
  publicKey: string;
}

/**
 * Push subscription keys
 */
interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

/**
 * Push subscription create request
 */
interface PushSubscriptionCreate {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

/**
 * Push subscription response
 */
interface PushSubscriptionResponse {
  id: string;
  endpoint: string;
  created_at: string;
  is_active: boolean;
}

/**
 * Push subscription create response
 */
interface PushSubscriptionCreateResponse {
  subscription: PushSubscriptionResponse;
  message: string;
}

/**
 * Push subscription delete response
 */
interface PushSubscriptionDeleteResponse {
  deleted: boolean;
  message: string;
}

/**
 * Push subscription list response
 */
interface PushSubscriptionListResponse {
  subscriptions: PushSubscriptionResponse[];
  total: number;
}

/**
 * Test notification request
 */
interface TestNotificationRequest {
  title?: string;
  body?: string;
}

/**
 * Test notification response
 */
interface TestNotificationResponse {
  sent: number;
  failed: number;
  message: string;
}

export const pushAPI = {
  /**
   * Get VAPID public key for push subscription.
   * This endpoint does not require authentication.
   * 
   * @returns VAPID public key
   */
  async getVAPIDPublicKey(): Promise<VAPIDPublicKeyResponse> {
    return apiClient.get('/push/vapid-public-key');
  },

  /**
   * Subscribe to push notifications.
   * Creates a push subscription for the current user's device.
   * 
   * @param subscriptionData - Push subscription info from browser's PushManager
   * @returns Created subscription info
   */
  async subscribe(
    subscriptionData: PushSubscriptionCreate
  ): Promise<PushSubscriptionCreateResponse> {
    return apiClient.post('/push/subscribe', subscriptionData);
  },

  /**
   * Unsubscribe from push notifications.
   * Removes a push subscription for the current user's device.
   * 
   * @param endpoint - The endpoint to unsubscribe
   * @returns Confirmation of deletion
   */
  async unsubscribe(
    endpoint: string
  ): Promise<PushSubscriptionDeleteResponse> {
    return apiClient.delete('/push/unsubscribe', {
      data: { endpoint },
    });
  },

  /**
   * Get all push subscriptions for the current user.
   * 
   * @returns List of user's push subscriptions
   */
  async getSubscriptions(): Promise<PushSubscriptionListResponse> {
    return apiClient.get('/push/subscriptions');
  },

  /**
   * Send a test push notification to all of the current user's devices.
   * Useful for verifying that push notifications are working correctly.
   * 
   * @param request - Optional custom title and body for the notification
   * @returns Results of the notification send attempt
   */
  async sendTestNotification(
    request?: TestNotificationRequest
  ): Promise<TestNotificationResponse> {
    return apiClient.post('/push/test', request || {});
  },
};
