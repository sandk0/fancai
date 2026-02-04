// UI State Store

import { create } from 'zustand';
import { toast } from 'sonner';
import type { UIState, NotificationAction } from '@/types/state';

export const useUIStore = create<UIState>((set) => ({
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
}));

// Standalone notify utility using Sonner
export const notify = {
  success: (title: string, message?: string) => {
    toast.success(title, { description: message, duration: 5000 });
  },

  error: (title: string, message?: string, action?: NotificationAction) => {
    toast.error(title, {
      description: message,
      duration: action ? Infinity : 10000,
      action: action ? { label: action.label, onClick: action.onClick } : undefined,
    });
  },

  warning: (title: string, message?: string, action?: NotificationAction) => {
    toast.warning(title, {
      description: message,
      duration: action ? Infinity : 7000,
      action: action ? { label: action.label, onClick: action.onClick } : undefined,
    });
  },

  info: (title: string, message?: string) => {
    toast.info(title, { description: message, duration: 5000 });
  },
};
