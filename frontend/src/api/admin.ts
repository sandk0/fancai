/**
 * Admin API methods
 *
 * NLP REMOVAL (December 2025):
 * - MultiNLPSettings interface deprecated (kept for backwards compatibility)
 * - getMultiNLPSettings/updateMultiNLPSettings return mock data
 * - Description extraction now via LLM API
 */

import { apiClient } from './client';

export interface SystemStats {
  total_users: number;
  total_books: number;
  total_descriptions: number; // DEPRECATED - always 0
  total_images: number;
  processing_rate: number;
  generation_rate: number;
  active_parsing_tasks: number;
  queue_size: number;
}

/**
 * @deprecated NLP system removed December 2025.
 * This interface is kept for backwards compatibility only.
 */
export interface MultiNLPSettings {
  processing_mode: string;
  default_processor: string;
  max_parallel_processors: number;
  ensemble_voting_threshold: number;
  adaptive_text_analysis: boolean;
  quality_monitoring: boolean;
  auto_processor_selection: boolean;
  spacy_settings: {
    enabled: boolean;
    weight: number;
    confidence_threshold: number;
    model_name: string;
    literary_patterns: boolean;
    character_detection_boost: number;
    location_detection_boost: number;
  };
  natasha_settings: {
    enabled: boolean;
    weight: number;
    confidence_threshold: number;
    literary_boost: number;
    enable_morphology: boolean;
    enable_syntax: boolean;
    enable_ner: boolean;
  };
  stanza_settings: {
    enabled: boolean;
    weight: number;
    confidence_threshold: number;
  };
  processor_type: string;
  available_processors: string[];
  available_spacy_models: string[];
}

export interface ParsingSettings {
  max_concurrent_parsing: number;
  queue_priority_weights: {
    free: number;
    premium: number;
    ultimate: number;
  };
  timeout_minutes: number;
  retry_attempts: number;
}

export interface ImageGenerationSettings {
  primary_service: string;
  fallback_services: string[];
  enable_caching: boolean;
  image_quality: string;
  max_generation_time: number;
}

export interface SystemSettings {
  maintenance_mode: boolean;
  max_upload_size_mb: number;
  supported_book_formats: string[];
  enable_debug_mode: boolean;
}

/**
 * Default mock settings for deprecated NLP system.
 * Used when backend NLP endpoints are removed.
 */
const MOCK_NLP_SETTINGS: MultiNLPSettings = {
  processing_mode: 'llm',
  default_processor: 'gemini',
  max_parallel_processors: 1,
  ensemble_voting_threshold: 0.5,
  adaptive_text_analysis: false,
  quality_monitoring: false,
  auto_processor_selection: false,
  spacy_settings: {
    enabled: false,
    weight: 0,
    confidence_threshold: 0,
    model_name: 'removed',
    literary_patterns: false,
    character_detection_boost: 0,
    location_detection_boost: 0,
  },
  natasha_settings: {
    enabled: false,
    weight: 0,
    confidence_threshold: 0,
    literary_boost: 0,
    enable_morphology: false,
    enable_syntax: false,
    enable_ner: false,
  },
  stanza_settings: {
    enabled: false,
    weight: 0,
    confidence_threshold: 0,
  },
  processor_type: 'llm',
  available_processors: ['gemini'],
  available_spacy_models: [],
};

export const adminAPI = {
  // System stats
  async getSystemStats(): Promise<SystemStats> {
    return apiClient.get('/admin/stats');
  },


  /**
   * @deprecated NLP system removed December 2025.
   * Returns mock data for backwards compatibility.
   */
  async getMultiNLPSettings(): Promise<MultiNLPSettings> {
    // NLP removed - return mock settings
    return Promise.resolve(MOCK_NLP_SETTINGS);
  },

  /**
   * @deprecated NLP system removed December 2025.
   * No-op for backwards compatibility.
   */
  async updateMultiNLPSettings(settings: MultiNLPSettings): Promise<{ message: string; settings: MultiNLPSettings }> {
    // NLP removed - return success without making API call
    console.warn('[DEPRECATED] Multi-NLP settings are no longer used. Description extraction is via LLM API.');
    return Promise.resolve({
      message: 'NLP settings are deprecated. Using LLM-based extraction.',
      settings,
    });
  },

  // Parsing settings
  async getParsingSettings(): Promise<ParsingSettings> {
    return apiClient.get('/admin/parsing-settings');
  },

  async updateParsingSettings(settings: ParsingSettings): Promise<{ message: string; settings: ParsingSettings }> {
    return apiClient.put('/admin/parsing-settings', settings);
  },

  // User management
  async getUsers(skip: number = 0, limit: number = 50): Promise<{
    users: Array<{
      id: string;
      email: string;
      username: string;
      subscription_plan: string;
      is_active: boolean;
      is_admin: boolean;
      created_at: string;
      last_login: string | null;
    }>;
    total: number;
    skip: number;
    limit: number;
  }> {
    const params = new URLSearchParams();
    if (skip > 0) params.append('skip', skip.toString());
    if (limit !== 50) params.append('limit', limit.toString());
    
    const url = `/admin/users${params.toString() ? '?' + params.toString() : ''}`;
    return apiClient.get(url);
  },

  // Queue management
  async getQueueStatus(): Promise<{
    is_parsing_active: boolean;
    current_parsing: {
      book_id: string;
      book_title: string;
      started_at: string;
    } | null;
    queue_size: number;
    queue_items: Array<{
      book_id: string;
      book_title: string;
      priority: number;
    }>;
    error?: string;
  }> {
    return apiClient.get('/admin/queue-status');
  },

  async clearQueue(): Promise<{ message: string }> {
    return apiClient.post('/admin/clear-queue');
  },

  async unlockParsing(): Promise<{ message: string }> {
    return apiClient.post('/admin/unlock-parsing');
  },

  // Image generation settings
  async getImageGenerationSettings(): Promise<ImageGenerationSettings> {
    return apiClient.get('/admin/image-generation-settings');
  },

  async updateImageGenerationSettings(settings: ImageGenerationSettings): Promise<{ message: string; settings: ImageGenerationSettings }> {
    return apiClient.put('/admin/image-generation-settings', settings);
  },

  // System settings
  async getSystemSettings(): Promise<SystemSettings> {
    return apiClient.get('/admin/system-settings');
  },

  async updateSystemSettings(settings: SystemSettings): Promise<{ message: string; settings: SystemSettings }> {
    return apiClient.put('/admin/system-settings', settings);
  },

  // Initialize default settings
  async initializeSettings(): Promise<{ message: string }> {
    return apiClient.post('/admin/initialize-settings');
  },

  async getNLPProcessorInfo(): Promise<{
    processor_info: {
      type: string;
      loaded: boolean;
      available: boolean;
      model?: string;
    };
    available_models: Record<string, string[]>;
  }> {
    return apiClient.get('/admin/nlp-processor-info');
  },

  async getEntityDuplicates(bookId?: string): Promise<{
    groups: Array<{
      book_id: string;
      book_title: string;
      normalized_name: string;
      entities: Array<{
        id: string;
        name: string;
        type: string;
        importance: number;
        visual_summary: string | null;
        created_at: string | null;
      }>;
    }>;
    total_duplicates: number;
  }> {
    const params = bookId ? `?book_id=${bookId}` : '';
    return apiClient.get(`/admin/entities/duplicates${params}`);
  },

  async mergeEntities(masterId: string, duplicateIds: string[]): Promise<{
    success: boolean;
    merged_count: number;
    master_id: string;
    message: string;
  }> {
    return apiClient.post('/admin/entities/merge', {
      master_id: masterId,
      duplicate_ids: duplicateIds,
    });
  },
};