/**
 * Book management helper utilities for E2E tests
 */

import { Page } from '@playwright/test';

/**
 * Upload a book file
 */
export async function uploadBook(page: Page, filePath: string): Promise<void> {
  // Navigate to library if not already there
  const currentUrl = page.url();
  if (!currentUrl.includes('/library')) {
    await page.goto('/library');
  }

  // Click upload button
  await page.click('[data-testid="upload-book-button"]');

  // Wait for file input to be visible
  const fileInput = await page.locator('input[type="file"]');

  // Upload file
  await fileInput.setInputFiles(filePath);

  // Wait for upload to complete (progress indicator disappears)
  await page.waitForSelector('[data-testid="upload-progress"]', {
    state: 'hidden',
    timeout: 30000
  });
}

/**
 * Wait for book parsing to complete
 */
export async function waitForBookParsing(
  page: Page,
  bookId: string,
  timeout = 60000
): Promise<void> {
  await page.waitForSelector(
    `[data-testid="book-${bookId}"][data-parsing-status="completed"]`,
    { timeout }
  );
}

/**
 * Open book reader
 */
export async function openBookReader(page: Page, bookId: string): Promise<void> {
  await page.click(`[data-testid="book-card-${bookId}"]`);

  // Wait for reader to load
  await page.waitForSelector('[data-testid="epub-reader"]', { timeout: 10000 });
}

/**
 * Delete a book
 */
export async function deleteBook(page: Page, bookId: string): Promise<void> {
  // Open book menu
  await page.click(`[data-testid="book-menu-${bookId}"]`);

  // Click delete
  await page.click(`[data-testid="delete-book-${bookId}"]`);

  // Confirm deletion
  await page.click('[data-testid="confirm-delete"]');

  // Wait for book to disappear
  await page.waitForSelector(`[data-testid="book-card-${bookId}"]`, {
    state: 'hidden',
    timeout: 5000
  });
}

/**
 * Search for books
 */
export async function searchBooks(page: Page, query: string): Promise<void> {
  await page.fill('[data-testid="book-search-input"]', query);

  // Wait for search results to update
  await page.waitForTimeout(500);
}

/**
 * Filter books by genre
 */
export async function filterBooksByGenre(page: Page, genre: string): Promise<void> {
  // Нативный <select>: его <option> кликнуть нельзя — браузер открывает
  // системный попап, недоступный Playwright.
  await page.selectOption('[data-testid="genre-filter"]', genre);

  // Wait for filter to apply
  await page.waitForTimeout(500);
}

/**
 * Get book count in library
 */
export async function getBookCount(page: Page): Promise<number> {
  const books = await page.locator('[data-testid^="book-card-"]').count();
  return books;
}

/**
 * Check if book exists in library
 */
export async function bookExists(page: Page, bookId: string): Promise<boolean> {
  try {
    await page.waitForSelector(`[data-testid="book-card-${bookId}"]`, { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get book parsing progress
 */
export async function getBookParsingProgress(page: Page, bookId: string): Promise<number> {
  const progressElement = await page.locator(`[data-testid="parsing-progress-${bookId}"]`);
  const progressText = await progressElement.textContent();

  if (!progressText) return 0;

  const match = progressText.match(/(\d+)%/);
  return match ? parseInt(match[1], 10) : 0;
}
