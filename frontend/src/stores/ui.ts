// UI State Store

import { create } from 'zustand';
import type { UIState, Notification, NotificationAction } from '@/types/state';

// Track notification auto-dismiss timers to prevent memory leaks
const notificationTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useUIStore = create<UIState>((set, get) => ({
  // Initial state
  isLoading: false,
  loadingMessage: '',
  sidebarOpen: false,
  mobileMenuOpen: false,
  
  // Modals
  showUploadModal: false,
  showSettingsModal: false,
  showImageModal: false,
  showProfileModal: false,
  currentImageModal: null,
  
  // Notifications
  notifications: [],
  
  // Notification helpers
  notify: {
    success: (title: string, message?: string) => {
      get().addNotification({
        type: 'success',
        title,
        message,
      });
    },

    error: (title: string, message?: string, action?: NotificationAction) => {
      get().addNotification({
        type: 'error',
        title,
        message,
        duration: action ? undefined : 10000, // Persistent if action required
        action,
      });
    },

    warning: (title: string, message?: string, action?: NotificationAction) => {
      get().addNotification({
        type: 'warning',
        title,
        message,
        duration: action ? undefined : 7000,
        action,
      });
    },

    info: (title: string, message?: string) => {
      get().addNotification({
        type: 'info',
        title,
        message,
      });
    },
  },

  // Actions
  setLoading: (loading, message = '') => {
    set({ isLoading: loading, loadingMessage: message });
  },

  setSidebarOpen: (open) => {
    set({ sidebarOpen: open });
  },

  setMobileMenuOpen: (open) => {
    set({ mobileMenuOpen: open });
    
    // Close sidebar when mobile menu opens
    if (open) {
      set({ sidebarOpen: false });
    }
  },

  setShowUploadModal: (show) => {
    set({ showUploadModal: show });
  },

  setShowSettingsModal: (show) => {
    set({ showSettingsModal: show });
  },

  setShowImageModal: (show, image = null) => {
    set({ showImageModal: show, currentImageModal: image });
  },

  setShowProfileModal: (show) => {
    set({ showProfileModal: show });
  },

  addNotification: (notificationData) => {
    const notification: Notification = {
      id: `notification-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      duration: 5000,
      ...notificationData,
    };

    set({ notifications: [notification, ...get().notifications] });

    if (notification.duration) {
      const timerId = setTimeout(() => {
        notificationTimers.delete(notification.id);
        get().removeNotification(notification.id);
      }, notification.duration);
      notificationTimers.set(notification.id, timerId);
    }
  },

  removeNotification: (id) => {
    const timerId = notificationTimers.get(id);
    if (timerId) {
      clearTimeout(timerId);
      notificationTimers.delete(id);
    }
    set({ 
      notifications: get().notifications.filter(n => n.id !== id) 
    });
  },

  clearNotifications: () => {
    notificationTimers.forEach(clearTimeout);
    notificationTimers.clear();
    set({ notifications: [] });
  },
}));

// Utility functions for common notification types
export const notify = {
  success: (title: string, message?: string) => {
    useUIStore.getState().addNotification({
      type: 'success',
      title,
      message,
    });
  },

  error: (title: string, message?: string, action?: NotificationAction) => {
    useUIStore.getState().addNotification({
      type: 'error',
      title,
      message,
      duration: action ? undefined : 10000,
      action,
    });
  },

  warning: (title: string, message?: string, action?: NotificationAction) => {
    useUIStore.getState().addNotification({
      type: 'warning',
      title,
      message,
      duration: action ? undefined : 7000,
      action,
    });
  },

  info: (title: string, message?: string) => {
    useUIStore.getState().addNotification({
      type: 'info',
      title,
      message,
    });
  },

  loading: (title: string, message?: string) => {
    const { setLoading, addNotification } = useUIStore.getState();
    setLoading(true, message);
    addNotification({
      type: 'info',
      title,
      message,
      duration: undefined, // Persistent until manually removed
    });
  },

  stopLoading: () => {
    useUIStore.getState().setLoading(false);
  },
};