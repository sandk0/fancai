/**
 * Library Page Object Model
 */

import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class LibraryPage extends BasePage {
  // Selectors
  private readonly uploadButton = '[data-testid="upload-book-button"]';
  private readonly fileInput = 'input[type="file"]';
  private readonly searchInput = '[data-testid="book-search-input"]';
  private readonly genreFilter = '[data-testid="genre-filter"]';
  private readonly uploadProgress = '[data-testid="upload-progress"]';
  private readonly emptyState = '[data-testid="library-empty-state"]';
  private readonly loadingState = '[data-testid="library-loading"]';

  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to library page
   */
  async navigate(): Promise<void> {
    await this.goto('/library');
  }

  /**
   * Upload a book file
   */
  async uploadBook(filePath: string): Promise<void> {
    await this.click(this.uploadButton);

    const fileInputElement = await this.page.locator(this.fileInput);
    await fileInputElement.setInputFiles(filePath);

    // Wait for upload to complete
    await this.page.waitForSelector(this.uploadProgress, {
      state: 'hidden',
      timeout: 30000
    });
  }

  /**
   * Search for books
   */
  async search(query: string): Promise<void> {
    await this.fill(this.searchInput, query);
    await this.wait(500); // Debounce
  }

  /**
   * Filter by genre.
   *
   * Жанр в приложении — нативный `<select>`: его `<option>` кликнуть нельзя
   * (браузер открывает системный попап, недоступный Playwright), поэтому
   * значение выбирается `selectOption`, а не двумя кликами.
   */
  async filterByGenre(genre: string): Promise<void> {
    await this.page.selectOption(this.genreFilter, genre);
  }

  /**
   * Get book card by ID
   */
  getBookCard(bookId: string) {
    return this.page.locator(`[data-testid="book-card-${bookId}"]`);
  }

  /**
   * Open book
   */
  async openBook(bookId: string): Promise<void> {
    await this.click(`[data-testid="book-card-${bookId}"]`);
  }

  /**
   * Delete book
   */
  async deleteBook(bookId: string): Promise<void> {
    // На desktop карточка показывает кнопки по hover (DesktopHoverOverlay),
    // на мобильных — через `book-menu-*` (сам триггер под `md:hidden`).
    // Пробуем мобильный триггер, если он видим; иначе наводимся на карточку.
    const menu = this.page.locator(`[data-testid="book-menu-${bookId}"]`);
    if (await menu.isVisible()) {
      await menu.click();
    } else {
      await this.page.locator(`[data-testid="book-card-${bookId}"]`).hover();
    }
    await this.click(`[data-testid="delete-book-${bookId}"]`);
    await this.click('[data-testid="confirm-delete"]');

    // Wait for book to disappear
    await this.page.waitForSelector(`[data-testid="book-card-${bookId}"]`, {
      state: 'hidden',
      timeout: 5000
    });
  }

  /**
   * Get book count
   */
  async getBookCount(): Promise<number> {
    return await this.page.locator('[data-testid^="book-card-"]').count();
  }

  /**
   * Check if book exists
   */
  async bookExists(bookId: string): Promise<boolean> {
    return await this.isVisible(`[data-testid="book-card-${bookId}"]`);
  }

  /**
   * Check if library is empty
   */
  async isEmpty(): Promise<boolean> {
    return await this.isVisible(this.emptyState);
  }

  /**
   * Wait for books to load
   */
  async waitForBooksToLoad(): Promise<void> {
    await this.page.waitForSelector(this.loadingState, {
      state: 'hidden',
      timeout: 10000
    });
  }

  /**
   * Get book parsing progress
   */
  async getParsingProgress(bookId: string): Promise<number> {
    const progressElement = await this.page.locator(`[data-testid="parsing-progress-${bookId}"]`);
    const progressText = await progressElement.textContent();

    if (!progressText) return 0;

    const match = progressText.match(/(\d+)%/);
    return match ? parseInt(match[1], 10) : 0;
  }
}
