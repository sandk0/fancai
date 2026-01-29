/**
 * PushNotificationManager - Service for Web Push API integration
 *
 * Manages push notification subscriptions, permissions, and communication
 * with the backend push service.
 *
 * Features:
 * - Push API support detection
 * - Permission state management
 * - VAPID key fetching and conversion
 * - Subscription/unsubscription to push service
 * - iOS Safari standalone mode detection
 *
 * @module services/pushNotifications
 */

import type {
  PushSubscriptionPayload,
  PushSubscriptionKeys,
  VapidPublicKeyResponse,
  PushSubscribeResponse,
  PushUnsubscribeResponse,
} from '@/types/push';

// =============================================================================
// Constants
// =============================================================================

const API_BASE = '/api/v1/push';

// =============================================================================
// Auth Helper
// =============================================================================

function getAuthHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

// =============================================================================
// PushNotificationManager Class
// =============================================================================

class PushNotificationManager {
  private vapidPublicKey: string | null = null;
  private serviceWorkerRegistration: ServiceWorkerRegistration | null = null;

  // ===========================================================================
  // Support Detection
  // ===========================================================================

  /**
   * Check if Push API is supported in the current browser
   *
   * @returns {boolean} True if Push API is supported
   */
  isSupported(): boolean {
    return (
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  /**
   * Check if running on iOS Safari
   *
   * iOS Safari requires special handling for push notifications
   * - Only works in standalone (PWA) mode on iOS 16.4+
   * - Does not support background sync
   *
   * @returns {boolean} True if running on iOS Safari
   */
  isIOSSafari(): boolean {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS/.test(ua);
    const notMSStream = !('MSStream' in window);

    return isIOS && isSafari && notMSStream;
  }

  /**
   * Check if running in standalone (PWA) mode
   *
   * Required for push notifications on iOS
   *
   * @returns {boolean} True if in standalone mode
   */
  isStandalone(): boolean {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari standalone detection
      ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true)
    );
  }

  /**
   * Check if push notifications can be used
   *
   * On iOS, push only works in standalone mode (PWA installed)
   *
   * @returns {boolean} True if push can be used
   */
  canUsePush(): boolean {
    if (!this.isSupported()) {
      return false;
    }

    // On iOS Safari, push only works in standalone mode
    if (this.isIOSSafari()) {
      return this.isStandalone();
    }

    return true;
  }

  /**
   * Get reason why push is not available (for UI feedback)
   *
   * @returns {string | null} Reason message or null if available
   */
  getUnavailableReason(): string | null {
    if (!('serviceWorker' in navigator)) {
      return 'Service Worker not supported';
    }

    if (!('PushManager' in window)) {
      return 'Push API not supported';
    }

    if (!('Notification' in window)) {
      return 'Notification API not supported';
    }

    if (this.isIOSSafari() && !this.isStandalone()) {
      return 'Install the app to enable push notifications on iOS';
    }

    return null;
  }

  // ===========================================================================
  // Permission Management
  // ===========================================================================

  /**
   * Get current notification permission state
   *
   * @returns {Promise<NotificationPermission>} Current permission state
   */
  async getPermissionState(): Promise<'granted' | 'denied' | 'default'> {
    if (!this.isSupported()) {
      return 'denied';
    }

    return Notification.permission as 'granted' | 'denied' | 'default';
  }

  /**
   * Request notification permission from user
   *
   * @returns {Promise<NotificationPermission>} Permission result
   */
  async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) {
      throw new Error('Push notifications not supported');
    }

    // Check if already granted/denied
    if (Notification.permission !== 'default') {
      return Notification.permission;
    }

    // Request permission
    const result = await Notification.requestPermission();
    console.log('[PushManager] Permission requested:', result);

    return result;
  }

  // ===========================================================================
  // Service Worker Registration
  // ===========================================================================

  /**
   * Get or wait for Service Worker registration
   *
   * @returns {Promise<ServiceWorkerRegistration>} Active registration
   */
  private async getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
    if (this.serviceWorkerRegistration) {
      return this.serviceWorkerRegistration;
    }

    if (!('serviceWorker' in navigator)) {
      throw new Error('Service Worker not supported');
    }

    const registration = await navigator.serviceWorker.ready;
    this.serviceWorkerRegistration = registration;

    return registration;
  }

  // ===========================================================================
  // VAPID Key Management
  // ===========================================================================

  /**
   * Fetch VAPID public key from backend
   *
   * @returns {Promise<string>} Base64 URL-safe encoded VAPID public key
   */
  async getVapidPublicKey(): Promise<string> {
    if (this.vapidPublicKey) {
      return this.vapidPublicKey;
    }

    const response = await fetch(`${API_BASE}/vapid-public-key`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Failed to get VAPID key: ${response.status}`);
    }

    const data: VapidPublicKeyResponse = await response.json();
    this.vapidPublicKey = data.publicKey;

    console.log('[PushManager] VAPID public key fetched');
    return this.vapidPublicKey;
  }

  /**
   * Convert base64 URL-safe string to Uint8Array
   *
   * Required for applicationServerKey in subscribe options
   *
   * @param {string} base64String - Base64 URL-safe encoded string
   * @returns {Uint8Array} Decoded bytes
   */
  urlBase64ToUint8Array(base64String: string): Uint8Array {
    // Add padding if needed
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
  }

  // ===========================================================================
  // Subscription Management
  // ===========================================================================

  /**
   * Get current push subscription (if any)
   *
   * @returns {Promise<PushSubscription | null>} Current subscription or null
   */
  async getSubscription(): Promise<PushSubscription | null> {
    if (!this.isSupported()) {
      return null;
    }

    try {
      const registration = await this.getServiceWorkerRegistration();
      return await registration.pushManager.getSubscription();
    } catch (error) {
      console.error('[PushManager] Failed to get subscription:', error);
      return null;
    }
  }

  /**
   * Subscribe to push notifications
   *
   * 1. Requests notification permission
   * 2. Subscribes to push manager with VAPID key
   * 3. Sends subscription to backend
   *
   * @returns {Promise<PushSubscription>} New subscription
   * @throws {Error} If permission denied or subscription fails
   */
  async subscribe(): Promise<PushSubscription> {
    if (!this.canUsePush()) {
      const reason = this.getUnavailableReason();
      throw new Error(reason || 'Push notifications not available');
    }

    // Step 1: Request permission
    const permission = await this.requestPermission();
    if (permission !== 'granted') {
      throw new Error('Notification permission denied');
    }

    // Step 2: Get VAPID public key
    const vapidPublicKey = await this.getVapidPublicKey();
    const applicationServerKey = this.urlBase64ToUint8Array(vapidPublicKey);

    // Step 3: Subscribe to push manager
    const registration = await this.getServiceWorkerRegistration();

    // Check if already subscribed
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast to BufferSource for TypeScript compatibility
        applicationServerKey: applicationServerKey.buffer as ArrayBuffer,
      });
      console.log('[PushManager] Created new subscription');
    } else {
      console.log('[PushManager] Using existing subscription');
    }

    // Step 4: Send subscription to backend
    await this.sendSubscriptionToBackend(subscription);

    return subscription;
  }

  /**
   * Unsubscribe from push notifications
   *
   * 1. Unsubscribes from push manager
   * 2. Removes subscription from backend
   *
   * @returns {Promise<boolean>} True if successfully unsubscribed
   */
  async unsubscribe(): Promise<boolean> {
    const subscription = await this.getSubscription();

    if (!subscription) {
      console.log('[PushManager] No subscription to unsubscribe');
      return true;
    }

    // Step 1: Remove from backend
    await this.removeSubscriptionFromBackend(subscription.endpoint);

    // Step 2: Unsubscribe from push manager
    const success = await subscription.unsubscribe();
    console.log('[PushManager] Unsubscribed:', success);

    return success;
  }

  // ===========================================================================
  // Backend Communication
  // ===========================================================================

  /**
   * Send subscription to backend for storage
   *
   * @param {PushSubscription} subscription - Browser push subscription
   */
  private async sendSubscriptionToBackend(subscription: PushSubscription): Promise<void> {
    const json = subscription.toJSON();

    // Extract keys
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;

    if (!p256dh || !auth) {
      throw new Error('Invalid subscription keys');
    }

    const keys: PushSubscriptionKeys = {
      p256dh,
      auth,
    };

    const payload: PushSubscriptionPayload = {
      endpoint: subscription.endpoint,
      keys,
      expirationTime: subscription.expirationTime,
      userAgent: navigator.userAgent,
      deviceType: this.detectDeviceType(),
    };

    const response = await fetch(`${API_BASE}/subscribe`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
      credentials: 'include',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to register subscription: ${response.status} - ${errorText}`);
    }

    const data: PushSubscribeResponse = await response.json();
    console.log('[PushManager] Subscription registered:', data.message);
  }

  /**
   * Remove subscription from backend
   *
   * @param {string} endpoint - Push service endpoint URL
   */
  private async removeSubscriptionFromBackend(endpoint: string): Promise<void> {
    const response = await fetch(`${API_BASE}/unsubscribe`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
      body: JSON.stringify({ endpoint }),
      credentials: 'include',
    });

    if (!response.ok) {
      // Don't throw on 404 - subscription might already be removed
      if (response.status !== 404) {
        const errorText = await response.text();
        throw new Error(`Failed to remove subscription: ${response.status} - ${errorText}`);
      }
    }

    const data: PushUnsubscribeResponse = await response.json();
    console.log('[PushManager] Subscription removed:', data.message);
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  /**
   * Detect device type for analytics
   *
   * @returns {string} Device type
   */
  private detectDeviceType(): 'desktop' | 'mobile' | 'tablet' {
    const ua = navigator.userAgent;

    if (/tablet|ipad|playbook|silk/i.test(ua)) {
      return 'tablet';
    }

    if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) {
      return 'mobile';
    }

    return 'desktop';
  }

  /**
   * Test push notification (for debugging)
   *
   * Shows a local notification to verify notifications are working
   */
  async testNotification(): Promise<void> {
    const permission = await this.getPermissionState();

    if (permission !== 'granted') {
      throw new Error('Notification permission not granted');
    }

    const registration = await this.getServiceWorkerRegistration();

    await registration.showNotification('Test Notification', {
      body: 'Push notifications are working correctly!',
      icon: '/favicon-192.png',
      badge: '/favicon-72.png',
      tag: 'test-notification',
      data: {
        type: 'general',
        url: '/',
        timestamp: Date.now(),
      },
    });

    console.log('[PushManager] Test notification shown');
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const pushManager = new PushNotificationManager();

// =============================================================================
// Type Exports
// =============================================================================

export type { PushNotificationManager };
