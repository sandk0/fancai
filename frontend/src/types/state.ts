// State Management Types for fancai

import { User, Book, Chapter, GeneratedImage, UserProfile, GenerationStatus, Description } from './api';

// Auth Store State
export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<void>;
  updateUser: (user: User) => void;
  loadUserFromStorage: () => void;
}

// Books Store State
export interface BooksState {
  // Books data
  books: Book[];
  currentBook: Book | null;
  currentChapter: Chapter | null;
  isLoading: boolean;
  error: string | null;

  // Pagination
  totalBooks: number;
  currentPage: number;
  booksPerPage: number;
  hasMore: boolean;
  sortBy: string;

  // Actions
  fetchBooks: (page?: number, limit?: number, sortBy?: string) => Promise<void>;
  fetchBook: (bookId: string) => Promise<void>;
  fetchChapter: (bookId: string, chapterNumber: number) => Promise<{
    chapter: Chapter;
    descriptions?: Description[];
    navigation: {
      has_previous: boolean;
      has_next: boolean;
      previous_chapter?: number;
      next_chapter?: number;
    };
  }>;
  uploadBook: (file: File) => Promise<Book>;
  deleteBook: (bookId: string) => Promise<void>;
  updateReadingProgress: (bookId: string, currentPage: number, chapterNumber: number) => Promise<void>;
  setCurrentBook: (book: Book | null) => void;
  setCurrentChapter: (chapter: Chapter | null) => void;
  clearError: () => void;

  // Pagination methods
  refreshBooks: () => Promise<void>;
  goToPage: (page: number) => Promise<void>;
  nextPage: () => Promise<void>;
  prevPage: () => Promise<void>;

  // Sort method
  setSortBy: (sortBy: string) => Promise<void>;
}

// Images Store State
export interface ImagesState {
  // Images data
  images: GeneratedImage[];
  currentBookImages: GeneratedImage[];
  generationStatus: GenerationStatus | null;
  isGenerating: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchGenerationStatus: () => Promise<void>;
  generateImageForDescription: (descriptionId: string, params?: Record<string, unknown>) => Promise<GeneratedImage>;
  generateImagesForChapter: (chapterId: string, params?: Record<string, unknown>) => Promise<GeneratedImage[]>;
  fetchBookImages: (bookId: string) => Promise<void>;
  deleteImage: (imageId: string) => Promise<void>;
  clearError: () => void;
  
  // Additional methods for compatibility
  refreshImages: () => Promise<void>;
}

export type ReaderTheme = 'light' | 'dark' | 'sepia' | 'night' | 'outdoor';
export type NavigationMode = 'swipe' | 'tap';

export interface LocalReadingProgress {
  bookId: string;
  currentChapter: number;
  currentPage: number;
  progress: number;
  lastReadAt: Date;
  totalTimeRead: number;
}

export interface LocalBookmark {
  chapter: number;
  page: number;
  text: string;
  createdAt: Date;
}

export interface LocalHighlight {
  id: string;
  chapter: number;
  text: string;
  color: string;
  createdAt: Date;
}

export interface ReaderState {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  theme: ReaderTheme;
  backgroundColor: string;
  textColor: string;
  maxWidth: number;
  margin: number;
  navigationMode: NavigationMode;

  // Reading state
  readingProgress: Record<string, LocalReadingProgress>;
  bookmarks: Record<string, LocalBookmark[]>;
  highlights: Record<string, LocalHighlight[]>;

  // Actions
  updateFontSize: (size: number) => void;
  updateFontFamily: (family: string) => void;
  updateLineHeight: (height: number) => void;
  updateTheme: (theme: ReaderTheme) => void;
  updateMaxWidth: (width: number) => void;
  updateMargin: (margin: number) => void;
  updateNavigationMode: (mode: NavigationMode) => void;
  updateReadingProgress: (bookId: string, chapter: number, progress: number, page?: number) => void;
  addBookmark: (bookId: string, chapter: number, page: number, text: string) => void;
  removeBookmark: (bookId: string, index: number) => void;
  addHighlight: (bookId: string, chapter: number, text: string, color: string) => void;
  removeHighlight: (bookId: string, highlightId: string) => void;
  resetSettings: () => void;
  reset: () => void;
  getReadingProgress: (bookId: string) => LocalReadingProgress | null;
  getTotalReadingTime: () => number;
}

// UI Store State
export interface UIState {
  // General UI state
  isLoading: boolean;
  loadingMessage: string;
  sidebarOpen: boolean;
  mobileMenuOpen: boolean;
  
  // Modals and dialogs
  showUploadModal: boolean;
  showSettingsModal: boolean;
  showImageModal: boolean;
  showProfileModal: boolean;
  currentImageModal: GeneratedImage | null;
  
  // Notifications
  notifications: Notification[];
  
  // Actions
  setLoading: (loading: boolean, message?: string) => void;
  setSidebarOpen: (open: boolean) => void;
  setMobileMenuOpen: (open: boolean) => void;
  setShowUploadModal: (show: boolean) => void;
  setShowSettingsModal: (show: boolean) => void;
  setShowImageModal: (show: boolean, image?: GeneratedImage | null) => void;
  setShowProfileModal: (show: boolean) => void;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  
  // Notification helpers
  notify: {
    success: (title: string, message?: string) => void;
    error: (title: string, message?: string) => void;
    warning: (title: string, message?: string) => void;
    info: (title: string, message?: string) => void;
  };
}

// Notification Type
export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message?: string;
  timestamp: number;
  duration?: number; // auto-dismiss time in ms, undefined for persistent
}

// Profile Store State
export interface ProfileState {
  // Profile data
  profile: UserProfile | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  fetchProfile: () => Promise<void>;
  updateProfile: (data: { full_name?: string; current_password?: string; new_password?: string }) => Promise<void>;
  clearError: () => void;
}

// Combined App State (for providers/context if needed)
export interface AppState {
  auth: AuthState;
  books: BooksState;
  images: ImagesState;
  reader: ReaderState;
  ui: UIState;
  profile: ProfileState;
}

// Local Storage Keys
export const STORAGE_KEYS = {
  AUTH_TOKEN: 'bookreader_access_token',
  REFRESH_TOKEN: 'bookreader_refresh_token',
  USER_DATA: 'bookreader_user_data',
  READER_SETTINGS: 'bookreader_reader_settings',
  THEME: 'bookreader_theme',
  READING_PROGRESS_BACKUP: 'bookreader_reading_progress_backup',
} as const;

// Route Paths
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  LIBRARY: '/library',
  BOOK: '/book/:bookId',
  CHAPTER: '/book/:bookId/chapter/:chapterNumber',
  PROFILE: '/profile',
  SETTINGS: '/settings',
  ADMIN: '/admin',
} as const;