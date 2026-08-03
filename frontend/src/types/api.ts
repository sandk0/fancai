// API Types for fancai Frontend

export interface ApiResponse<T = unknown> {
  data?: T;
  message?: string;
  error?: string;
  timestamp?: string;
}

export interface PaginationParams {
  skip?: number;
  limit?: number;
}

export interface PaginationResponse {
  total: number;
  skip: number;
  limit: number;
  has_more?: boolean;
}

// Auth Types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  full_name?: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface User {
  id: string;
  email: string;
  full_name?: string;
  is_active: boolean;
  is_verified: boolean;
  is_admin: boolean;
  created_at: string;
  last_login?: string;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
  message: string;
}

// Book Types
export interface BookMetadata {
  title: string;
  author: string;
  language?: string;
  genre?: string;
  description?: string;
  publisher?: string;
  publish_date?: string;
  has_cover: boolean;
}

export interface BookStatistics {
  total_chapters: number;
  total_pages: number;
  estimated_reading_time_hours: number;
  file_format: string;
  file_size_mb: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  genre?: string;
  language?: string;
  description?: string;
  publisher?: string;
  rights?: string;
  pubdate?: string;
  total_pages: number;
  estimated_reading_time_hours: number;
  chapters_count: number;
  reading_progress_percent: number;
  has_cover: boolean;
  is_parsed: boolean;
  is_processing?: boolean;
  // Статус обработки описаний (ручной запуск)
  descriptions_extracted?: boolean;  // Описания успешно извлечены?
  descriptions_processing_error?: string | null;  // Ошибка обработки
  created_at: string;
  last_accessed?: string;
}

export interface Chapter {
  id: string;
  book_id: string;
  number: number;
  title: string;
  content: string;
  word_count: number;
  estimated_reading_time_minutes: number;
  html_content?: string;
  descriptions?: Description[];
}

export interface ChapterInfo {
  id: string;
  number: number;
  title: string;
  word_count: number;
  estimated_reading_time_minutes: number;
  is_description_parsed: boolean;
  descriptions_found: number;
}

export interface BookDetail extends Book {
  chapters: ChapterInfo[];
  reading_progress: {
    current_chapter: number;
    current_page: number;
    current_position: number;  // Процент позиции в текущей главе (0-100)
    reading_location_cfi?: string;  // CFI для epub.js (точная позиция в EPUB)
    max_chapter_reached: number;  // Максимальная глава, до которой дочитал (серверная, для защиты от спойлеров)
    progress_percent: number;
  };
  file_format: string;
  file_size_mb: number;
  parsing_progress: number;
  total_chapters: number;
}

export interface BookUploadResponse {
  book: BookDetail;
  task_id: string | null;
  message: string;
}

// Description Types
export type DescriptionType = 'location' | 'character' | 'atmosphere' | 'object' | 'action';

export interface Entity {
  id: string;
  name: string;
  type: 'character' | 'location' | 'object' | 'other';
  importance?: number;
  visual_summary?: string;
  master_portrait_url?: string;
}

export interface Description {
  id: string;
  type: DescriptionType;
  content: string;
  text?: string;
  confidence_score: number;
  priority_score: number;
  generated_image?: GeneratedImage;
}

export interface NLPAnalysis {
  total_descriptions: number;
  by_type: Record<DescriptionType, number>;
  descriptions: Description[];
}

export interface ImageDescription {
  id: string;
  type: DescriptionType;
  text: string;
  content: string;
  confidence_score: number;
  priority_score: number;
}

export interface ImageChapter {
  id: string;
  number: number;
  title: string;
}

export interface GeneratedImage {
  id: string;

  // Генерация
  service_used: string;
  status: 'pending' | 'generating' | 'completed' | 'failed' | 'moderated';
  prompt_used?: string;
  generation_time_seconds?: number;

  // Результат
  image_url: string;
  local_path?: string;

  // Файл
  file_size?: number;
  image_width?: number;
  image_height?: number;
  file_format?: string;

  // Качество
  quality_score?: number;
  is_moderated: boolean;

  // Статистика
  view_count: number;
  download_count: number;

  // Timestamps
  created_at: string;
  updated_at?: string;
  generated_at?: string;

  // Relationships
  description_id?: string;  // ID of the description (alternative to full object)
  description: ImageDescription;
  chapter: ImageChapter;
}

export interface ImageGenerationParams {
  style_prompt?: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
}

export interface BatchGenerationRequest {
  chapter_id: string;
  max_images: number;
  style_prompt?: string;
  description_types?: DescriptionType[];
}

export interface GenerationStatus {
  status: string;
  queue_stats: {
    queue_size: number;
    is_processing: boolean;
    supported_types: DescriptionType[];
    api_status: string;
  };
  user_info: {
    id: string;
    can_generate: boolean;
  };
  api_info: {
    provider: string;
    supported_formats: string[];
    max_resolution: string;
    estimated_time_per_image: string;
  };
}

// Subscription Types
export type SubscriptionPlan = 'free' | 'premium' | 'ultimate';
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled' | 'pending';

export interface Subscription {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  start_date: string;
  end_date?: string;
  auto_renewal: boolean;
}

export interface SubscriptionUsage {
  books_uploaded: number;
  images_generated_month: number;
  last_reset_date: string;
}

export interface SubscriptionLimits {
  books: number; // -1 for unlimited
  generations_month: number; // -1 for unlimited
}

export interface UserProfile {
  user: User;
  subscription?: Subscription;
  statistics: {
    total_books: number;
    total_descriptions: number;
  };
}

export interface UserSubscriptionInfo {
  subscription: Subscription;
  usage: SubscriptionUsage;
  limits: SubscriptionLimits;
  within_limits: {
    books: boolean;
    generations: boolean;
  };
}

export interface DatabaseTestResponse {
  status: string;
  message: string;
  connection_info?: Record<string, unknown>;
  error?: string;
}

// Error Types
export interface ApiError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp?: string;
  /**
   * HTTP-статус ответа, если он был.
   *
   * Без него вызывающий не может отличить «доступ запрещён» от «сервер
   * не ответил»: перехватчик оборачивает всё в `ApiError`, и обрыв сети
   * выглядел так же, как 401. На этом хранилище авторизации разлогинивало
   * пользователя при любом сбое проверки сессии.
   */
  status?: number;
}

export interface ValidationError {
  field: string;
  message: string;
}

// Reading Progress Types
export interface ReadingProgress {
  book_id: string;
  current_page: number;
  current_chapter: number;
  current_position: number;  // Процент позиции в текущей главе (0-100)
  reading_location_cfi?: string;  // CFI для epub.js (точная позиция в EPUB)
  scroll_offset_percent?: number;  // Точный % скролла внутри страницы (0-100)
  max_chapter_reached: number;  // Максимальная глава (серверная, монотонно возрастает)
  progress_percent: number;
  last_read_at: string;
}

// User Reading Statistics Types
export interface WeeklyActivityDay {
  date: string;          // "2025-10-26"
  day: string;           // "Вс"
  minutes: number;       // 45
  sessions: number;      // 2
  progress: number;      // 12 (% прогресса за день)
}

export interface FavoriteGenre {
  genre: string;
  count: number;
}

export interface UserReadingStatistics {
  total_books: number;
  books_in_progress: number;
  books_completed: number;
  total_reading_time_minutes: number;
  reading_streak_days: number;
  longest_streak_days: number;
  average_reading_speed_wpm: number;
  favorite_genres: FavoriteGenre[];
  weekly_activity: WeeklyActivityDay[];
  total_pages_read: number;
  total_chapters_read: number;
  avg_minutes_per_day: number;  // Унифицированная метрика: total_minutes / days_with_activity
  // Monthly statistics
  books_this_month: number;           // Количество книг с активностью в этом месяце
  reading_time_this_month: number;    // Минуты чтения за этот месяц
  pages_this_month: number;           // Страницы прочитанные в этом месяце
}

// Reading Session Types
export interface ReadingSession {
  id: string;
  book_id: string;
  user_id: string;
  started_at: string;
  ended_at?: string;
  duration_minutes: number;
  start_position: number;
  end_position: number;
  pages_read: number;
  device_type?: string;
  is_active: boolean;
}

export interface StartSessionRequest {
  book_id: string;
  start_position: number;
  device_type?: string;
}

export interface UpdateSessionRequest {
  current_position: number;
}

export interface EndSessionRequest {
  end_position: number;
}

export interface ReadingSessionHistory {
  sessions: ReadingSession[];
  total: number;
  skip: number;
  limit: number;
}