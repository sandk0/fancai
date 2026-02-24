/**
 * Тесты для Books API
 *
 * Проверяем все методы booksAPI: получение, загрузка, удаление книг,
 * управление главами и reading progress.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { booksAPI } from '../books';
import { apiClient } from '../client';
import type { BookDetail, Chapter } from '@/types/api';

// Mock apiClient
vi.mock('../client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
    client: {
      post: vi.fn(),
      defaults: {
        baseURL: 'http://localhost:8000/api/v1',
      },
    },
  },
}));

describe('Books API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBooks', () => {
    it('should fetch books without params', async () => {
      const mockResponse = {
        books: [
          { id: '1', title: 'Book 1', author: 'Author 1' },
          { id: '2', title: 'Book 2', author: 'Author 2' },
        ],
        total: 2,
        skip: 0,
        limit: 10,
      };

      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const result = await booksAPI.getBooks();

      expect(apiClient.get).toHaveBeenCalledWith(expect.stringMatching(/\/books\/?$/));
      expect(result).toEqual(mockResponse);
      expect(result.books).toHaveLength(2);
    });

    it('should fetch books with pagination params', async () => {
      const mockResponse = {
        books: [],
        total: 20,
        skip: 10,
        limit: 5,
      };

      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      await booksAPI.getBooks({ skip: 10, limit: 5 });

      expect(apiClient.get).toHaveBeenCalledWith(expect.stringMatching(/\/books\/?.*skip=10&limit=5/));
    });
  });

  describe('getBook', () => {
    it('should fetch single book by id', async () => {
      const mockBook: BookDetail = {
        id: '123',
        title: 'Test Book',
        author: 'Test Author',
        genre: 'fiction',
        language: 'ru',
        total_pages: 300,
        is_parsed: true,
        total_chapters: 25,
        estimated_reading_time_hours: 150,
        chapters_count: 25,
        reading_progress_percent: 0,
        has_cover: false,
        created_at: new Date().toISOString(),
        chapters: [],
        reading_progress: {
          current_chapter: 1,
          current_page: 0,
          current_position: 0,
          progress_percent: 0,
          max_chapter_reached: 1,
        },
        file_format: 'epub',
        file_size_mb: 1.5,
        parsing_progress: 100,
      };

      vi.mocked(apiClient.get).mockResolvedValue(mockBook);

      const result = await booksAPI.getBook('123');

      expect(apiClient.get).toHaveBeenCalledWith('/books/123');
      expect(result).toEqual(mockBook);
      expect(result.id).toBe('123');
    });

    it('should throw error for nonexistent book', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('Book not found'));

      await expect(booksAPI.getBook('nonexistent')).rejects.toThrow('Book not found');
    });
  });

  describe('uploadBook', () => {
    it('should upload book file successfully', async () => {
      const mockFile = new File(['epub content'], 'test.epub', { type: 'application/epub+zip' });
      const formData = new FormData();
      formData.append('file', mockFile);

      const mockResponse = {
        book: {
          id: 'new-book-id',
          title: 'Uploaded Book',
          author: 'Author',
          processing_status: 'processing',
        },
        message: 'Book uploaded successfully',
      };

      vi.mocked(apiClient.client.post).mockResolvedValue({ data: mockResponse });

      const result = await booksAPI.uploadBook(formData);

      expect(apiClient.client.post).toHaveBeenCalledWith(
        '/books/upload',
        formData,
        expect.objectContaining({
          headers: {
            'Content-Type': undefined,
          },
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it('should call onUploadProgress callback', async () => {
      const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
      const formData = new FormData();
      formData.append('file', mockFile);
      const onUploadProgress = vi.fn();

      vi.mocked(apiClient.client.post).mockResolvedValue({ data: {} });

      await booksAPI.uploadBook(formData, { onUploadProgress });

      expect(apiClient.client.post).toHaveBeenCalledWith(
        '/books/upload',
        formData,
        expect.objectContaining({
          onUploadProgress,
        })
      );
    });
  });

  describe('deleteBook', () => {
    it('should delete book by id', async () => {
      const mockResponse = { message: 'Book deleted successfully' };
      vi.mocked(apiClient.delete).mockResolvedValue(mockResponse);

      const result = await booksAPI.deleteBook('123');

      expect(apiClient.delete).toHaveBeenCalledWith('/books/123');
      expect(result.message).toContain('deleted successfully');
    });
  });

  describe('getChapter', () => {
    it('should fetch chapter with descriptions', async () => {
      const mockChapter: Chapter = {
        id: 'ch-1',
        book_id: 'book-1',
        number: 1,
        title: 'Chapter 1',
        content: 'Chapter content',
        word_count: 100,
        estimated_reading_time_minutes: 5,
      };

      const mockResponse = {
        chapter: mockChapter,
        descriptions: [
          {
            text: 'dark forest',
            description_type: 'location',
            priority_score: 0.85,
          },
        ],
        navigation: {
          has_previous: false,
          has_next: true,
          next_chapter: 2,
        },
      };

      vi.mocked(apiClient.get).mockResolvedValue(mockResponse);

      const result = await booksAPI.getChapter('book-1', 1);

      expect(apiClient.get).toHaveBeenCalledWith('/books/book-1/chapters/1');
      expect(result.chapter.number).toBe(1);
      expect(result.navigation.has_next).toBe(true);
    });
  });

  describe('updateReadingProgress', () => {
    it('should update reading progress with CFI', async () => {
      const progressData = {
        current_chapter: 5,
        current_position_percent: 45.5,
        reading_location_cfi: 'epubcfi(/6/4[chap01ref]!/4[body01]/10[para05])',
        scroll_offset_percent: 45.5,
      };

      const mockResponse = {
        progress: {
          book_id: 'book-1',
          current_chapter: 5,
          current_position_percent: 45.5,
          reading_location_cfi: 'epubcfi(/6/4[chap01ref]!/4[body01]/10[para05])',
          scroll_offset_percent: 45.5,
        },
        message: 'Progress updated',
      };

      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await booksAPI.updateReadingProgress('book-1', progressData);

      expect(apiClient.post).toHaveBeenCalledWith('/books/book-1/progress', progressData);
      expect(result.progress.current_chapter).toBe(5);
      expect(result.progress.reading_location_cfi).toContain('epubcfi');
    });

    it('should clamp position percent between 0 and 100', async () => {
      const progressData = {
        chapter_number: 1,
        position_percent_in_chapter: 150, // Over 100%
      };

      vi.mocked(apiClient.post).mockResolvedValue({ progress: {}, message: 'Updated' });

      await booksAPI.updateProgress('book-1', progressData);

      expect(apiClient.post).toHaveBeenCalledWith(
        '/books/book-1/progress',
        expect.objectContaining({
          current_position_percent: 100, // Clamped
        })
      );
    });
  });

  describe('getUserStatistics', () => {
    it('should fetch user reading statistics', async () => {
      const mockStats = {
        statistics: {
          total_books: 25,
          books_in_progress: 3,
          books_completed: 22,
          total_chapters_read: 450,
          total_reading_time_minutes: 12000,
          average_reading_speed_wpm: 250,
          favorite_genres: ['fiction', 'mystery'],
          reading_streak_days: 7,
        },
      };

      vi.mocked(apiClient.get).mockResolvedValue(mockStats);

      const result = await booksAPI.getUserStatistics();

      expect(apiClient.get).toHaveBeenCalledWith('/users/reading-statistics');
      expect(result.statistics.total_books).toBe(25);
      expect(result.statistics.reading_streak_days).toBe(7);
    });
  });

  describe('validateBookFile', () => {
    it('should validate book file', async () => {
      const mockFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });

      const mockResponse = {
        filename: 'test.epub',
        file_size_bytes: 1024,
        file_size_mb: 0.001,
        validation: {
          is_valid: true,
          format: 'epub',
          issues: [],
          warnings: [],
        },
        message: 'File is valid',
      };

      vi.mocked(apiClient.upload).mockResolvedValue(mockResponse);

      const result = await booksAPI.validateBookFile(mockFile);

      expect(apiClient.upload).toHaveBeenCalledWith('/books/validate-file', mockFile);
      expect(result.validation.is_valid).toBe(true);
    });

    it('should return validation errors for invalid file', async () => {
      const mockFile = new File(['invalid'], 'test.txt', { type: 'text/plain' });

      const mockResponse = {
        filename: 'test.txt',
        file_size_bytes: 7,
        file_size_mb: 0.000007,
        validation: {
          is_valid: false,
          format: 'unknown',
          issues: ['Unsupported file format'],
          warnings: [],
        },
        message: 'File validation failed',
      };

      vi.mocked(apiClient.upload).mockResolvedValue(mockResponse);

      const result = await booksAPI.validateBookFile(mockFile);

      expect(result.validation.is_valid).toBe(false);
      expect(result.validation.issues).toContain('Unsupported file format');
    });
  });

  describe('getBookFileUrl', () => {
    it('should construct correct book file URL', () => {
      const url = booksAPI.getBookFileUrl('book-123');

      expect(url).toBe('http://localhost:8000/api/v1/books/book-123/file');
    });
  });

  describe('getParsingStatus', () => {
    it('should fetch parsing status', async () => {
      const mockStatus = {
        status: 'processing',
        progress: 45,
        message: 'Parsing in progress',
      };

      vi.mocked(apiClient.get).mockResolvedValue(mockStatus);

      const result = await booksAPI.getParsingStatus('book-1') as any;

      expect(apiClient.get).toHaveBeenCalledWith('/books/book-1/parsing-status');
      expect(result.progress).toBe(45);
    });
  });

  describe('processBook', () => {
    it('should start book processing', async () => {
      const mockResponse = {
        message: 'Book processing started',
        task_id: 'task-123',
      };

      vi.mocked(apiClient.post).mockResolvedValue(mockResponse);

      const result = await booksAPI.processBook('book-1') as any;

      expect(apiClient.post).toHaveBeenCalledWith('/books/book-1/process');
      expect(result.task_id).toBe('task-123');
    });
  });
});
