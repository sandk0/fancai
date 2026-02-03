// Descriptions API methods

import { apiClient } from './client';
import type {
  Description,
  ChapterInfo,
  NLPAnalysis,
} from '@/types/api';

/**
 * Response from getting chapter descriptions
 */
interface ChapterDescriptionsResponse {
  chapter_info: ChapterInfo;
  nlp_analysis: NLPAnalysis;
  message: string;
}

/**
 * Response from getting a single description by ID
 */
interface DescriptionResponse {
  description: Description;
}

/**
 * Response for batch descriptions
 */
interface BatchDescriptionsResponse {
  book_id: string;
  chapters: Array<{
    chapter_number: number;
    success: boolean;
    data?: ChapterDescriptionsResponse;
    error?: string;
  }>;
  total_requested: number;
  total_success: number;
  total_descriptions: number;
}

/**
 * Response from triggering background extraction
 */
interface BackgroundExtractionResponse {
  status: 'extraction_started' | 'already_extracted' | 'skipped' | 'unavailable';
  chapter_number: number;
  reason?: string | null;
}

export const descriptionsAPI = {
  /**
   * Get descriptions from a specific chapter.
   * 
   * @param bookId - Book ID
   * @param chapterNumber - Chapter number
   * @param extractNew - Whether to trigger new LLM extraction (default: false)
   * @returns Chapter descriptions with NLP analysis
   */
  async getChapterDescriptions(
    bookId: string,
    chapterNumber: number,
    extractNew: boolean = false
  ): Promise<ChapterDescriptionsResponse> {
    const params = new URLSearchParams();
    if (extractNew) params.append('extract_new', 'true');

    const url = `/books/${bookId}/chapters/${chapterNumber}/descriptions${params.toString() ? '?' + params.toString() : ''}`;
    return apiClient.get(url);
  },

  /**
   * Get a specific description by its ID.
   * 
   * @param descriptionId - Description ID
   * @returns Description details
   */
  async getDescription(descriptionId: string): Promise<DescriptionResponse> {
    return apiClient.get(`/descriptions/${descriptionId}`);
  },

  /**
   * Get descriptions for multiple chapters in a single request.
   * Does NOT trigger LLM extraction - only returns existing descriptions.
   * 
   * @param bookId - Book ID
   * @param chapterNumbers - Array of chapter numbers to fetch
   * @returns Batch response with descriptions for each chapter
   */
  async getBatchDescriptions(
    bookId: string,
    chapterNumbers: number[]
  ): Promise<BatchDescriptionsResponse> {
    return apiClient.post(`/books/${bookId}/chapters/batch`, {
      chapter_numbers: chapterNumbers,
    });
  },

  /**
   * Trigger background LLM extraction for a chapter.
   * This is a fire-and-forget operation - returns immediately.
   * 
   * @param bookId - Book ID
   * @param chapterNumber - Chapter number to extract descriptions for
   * @returns Status of the background extraction request
   */
  async triggerBackgroundExtraction(
    bookId: string,
    chapterNumber: number
  ): Promise<BackgroundExtractionResponse> {
    return apiClient.post(
      `/books/${bookId}/chapters/${chapterNumber}/extract-background`
    );
  },
};
