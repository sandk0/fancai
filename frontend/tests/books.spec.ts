// @ts-nocheck - E2E tests have different type strictness requirements
/**
 * Book Management E2E Tests
 *
 * Покрытие прежнее: загрузка EPUB и FB2, отказ на чужом формате, индикация
 * загрузки, список библиотеки, удаление с подтверждением, разбор книги,
 * поиск, фильтр по жанру, метаданные.
 *
 * Что изменилось после сверки с приложением:
 *
 * - **Спека больше не трогает книгу фикстуры.** Раньше «should successfully
 *   delete a book» удаляла первую карточку — то есть ровно ту книгу, на
 *   которой стоят спеки читалки и картинок, вместе с файлом на диске.
 *   Каждый разрушающий тест теперь загружает свою книгу и удаляет её же.
 * - `upload-success` / `upload-error` / `upload-progress` в приложении нет:
 *   обратная связь по загрузке идёт тостами `sonner`. Проверяется наблюдаемый
 *   результат — карточка появилась либо не появилась, и виден тост-ошибка.
 * - Атрибута `data-parsing-status` тоже нет. Готовность книги видна
 *   в `GET /api/v1/books/{id}`, по нему и проверяется.
 */

import { test, expect } from './fixtures/worker-user';
import { LibraryPage } from './pages';
import path from 'path';

const SAMPLE_EPUB = path.join(process.cwd(), 'tests/fixtures/files/sample.epub');
const SAMPLE_FB2 = path.join(process.cwd(), 'tests/fixtures/files/sample.fb2');
const INVALID_FILE = path.join(process.cwd(), 'tests/fixtures/files/invalid.txt');

test.beforeEach(async ({ page }) => {
  // Сессия слота уже в контексте (worker-фикстура storageState): вход
  // в каждом тесте упирался бы в лимит 10 логинов в минуту на IP.
  await page.goto('/library');
});

test.describe('Book Management', () => {
  test.describe('Book Upload', () => {
    test('should successfully upload EPUB file', async ({ page }) => {
      const libraryPage = new LibraryPage(page);
      await libraryPage.waitForBooksToLoad();
      const initialCount = await libraryPage.getBookCount();

      const uploaded = await libraryPage.uploadBook(SAMPLE_EPUB);

      expect(await libraryPage.getBookCount()).toBe(initialCount + 1);
      await expect(libraryPage.getBookCard(uploaded)).toBeVisible();

      // Убираем за собой: книга принадлежит этому тесту, а не фикстуре.
      await libraryPage.deleteBook(uploaded);
    });

    test('should successfully upload FB2 file', async ({ page }) => {
      const libraryPage = new LibraryPage(page);
      await libraryPage.waitForBooksToLoad();
      const initialCount = await libraryPage.getBookCount();

      const uploaded = await libraryPage.uploadBook(SAMPLE_FB2);

      expect(await libraryPage.getBookCount()).toBe(initialCount + 1);
      await libraryPage.deleteBook(uploaded);
    });

    test('should show error for invalid file type', async ({ page }) => {
      const libraryPage = new LibraryPage(page);
      await libraryPage.waitForBooksToLoad();
      const initialCount = await libraryPage.getBookCount();

      await libraryPage.openUploadModal();
      await page.locator('input[type="file"]').setInputFiles(INVALID_FILE);

      // Валидация формата отвечает тостом; отдельного `upload-error` нет.
      await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible({
        timeout: 10000,
      });

      await page.keyboard.press('Escape');
      expect(await libraryPage.getBookCount()).toBe(initialCount);
    });

    test('should show upload modal while uploading', async ({ page }) => {
      const libraryPage = new LibraryPage(page);
      await libraryPage.waitForBooksToLoad();

      // Снимок ДО загрузки: свою книгу тест обязан опознать по разности
      // множеств. Библиотека сортируется created_desc, поэтому «последняя
      // карточка» — самая старая, то есть книга фикстуры.
      const before = new Set(await libraryPage.getBookIds());

      await libraryPage.openUploadModal();
      await expect(page.locator('[data-testid="upload-modal"]')).toBeVisible();

      const uploaded = await libraryPage.submitUpload(SAMPLE_EPUB, before);
      await libraryPage.deleteBook(uploaded);
    });
  });

  test.describe('Library View', () => {
    test('should display all user books in library', async ({ page, fixtureBookId }) => {
      const libraryPage = new LibraryPage(page);
      await libraryPage.waitForBooksToLoad();

      const card = libraryPage.getBookCard(fixtureBookId);
      await expect(card).toBeVisible();
      await expect(card.locator('[data-testid="book-title"]')).toBeVisible();
      await expect(card.locator('[data-testid="book-author"]')).toBeVisible();
    });

    test('should show empty state when a search matches nothing', async ({ page }) => {
      // Полностью пустой библиотеки у слота не бывает — у него есть книга
      // фикстуры. Наблюдаемый аналог пустого состояния — пустая выдача поиска.
      const libraryPage = new LibraryPage(page);
      await libraryPage.waitForBooksToLoad();

      await libraryPage.search('несуществующая книга zzzqqq');
      await expect(page.locator('[data-testid="no-search-results"]')).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test.describe('Book Deletion', () => {
    test('should successfully delete a book', async ({ page }) => {
      const libraryPage = new LibraryPage(page);
      await libraryPage.waitForBooksToLoad();

      // Удаляем свою книгу, а не книгу фикстуры: удаление сносит файл с диска.
      const uploaded = await libraryPage.uploadBook(SAMPLE_EPUB);
      const countWithUpload = await libraryPage.getBookCount();

      await libraryPage.deleteBook(uploaded);

      expect(await libraryPage.getBookCount()).toBe(countWithUpload - 1);
      await expect(libraryPage.getBookCard(uploaded)).toHaveCount(0);
    });

    test('should show confirmation dialog before deleting', async ({ page }) => {
      const libraryPage = new LibraryPage(page);
      await libraryPage.waitForBooksToLoad();

      const uploaded = await libraryPage.uploadBook(SAMPLE_EPUB);

      await libraryPage.openDeleteDialog(uploaded);
      await expect(page.locator('[data-testid="confirm-delete"]')).toBeVisible();

      await page.click('[data-testid="cancel-delete"]');
      expect(await libraryPage.bookExists(uploaded)).toBe(true);

      await libraryPage.deleteBook(uploaded);
    });
  });

  test.describe('Book Parsing', () => {
    test('should parse an uploaded book into chapters', async ({ page }) => {
      const libraryPage = new LibraryPage(page);
      await libraryPage.waitForBooksToLoad();

      const uploaded = await libraryPage.uploadBook(SAMPLE_EPUB);

      // Разбор идёт в Celery; готовность видна в API, а не в атрибуте карточки.
      await expect
        .poll(
          async () => {
            const res = await page.request.get(`/api/v1/books/${uploaded}`);
            if (!res.ok()) return null;
            const body = await res.json();
            return (body.book ?? body).is_parsed ?? null;
          },
          { timeout: 120000, intervals: [2000] }
        )
        .toBe(true);

      await page.reload();
      await libraryPage.waitForBooksToLoad();
      await libraryPage.deleteBook(uploaded);
    });
  });

  test.describe('Book Search and Filter', () => {
    test('should search books by title', async ({ page, fixtureBookId }) => {
      const libraryPage = new LibraryPage(page);
      await libraryPage.waitForBooksToLoad();

      const title = await libraryPage
        .getBookCard(fixtureBookId)
        .locator('[data-testid="book-title"]')
        .textContent();
      const term = (title ?? '').trim().split(/\s+/)[0];
      expect(term.length).toBeGreaterThan(2);

      await libraryPage.search(term);
      await expect(libraryPage.getBookCard(fixtureBookId)).toBeVisible();
    });

    test('should filter books by genre', async ({ page, fixtureBookId }) => {
      const libraryPage = new LibraryPage(page);
      await libraryPage.waitForBooksToLoad();

      const res = await page.request.get(`/api/v1/books/${fixtureBookId}`);
      const genre = ((await res.json()).book ?? (await res.json())).genre;

      await libraryPage.filterByGenre(genre);
      await expect(libraryPage.getBookCard(fixtureBookId)).toBeVisible();
    });

    test('should show no results for non-existent search', async ({ page }) => {
      const libraryPage = new LibraryPage(page);
      await libraryPage.waitForBooksToLoad();

      await libraryPage.search('zzzqqq-нет-такой-книги');
      expect(await libraryPage.getBookCount()).toBe(0);
    });
  });

  test.describe('Book Metadata', () => {
    test('should display book metadata correctly', async ({ page, fixtureBookId }) => {
      const libraryPage = new LibraryPage(page);
      await libraryPage.waitForBooksToLoad();

      const card = libraryPage.getBookCard(fixtureBookId);
      const title = await card.locator('[data-testid="book-title"]').textContent();
      const author = await card.locator('[data-testid="book-author"]').textContent();

      const res = await page.request.get(`/api/v1/books/${fixtureBookId}`);
      expect(res.ok()).toBe(true);
      const book = (await res.json()).book ?? (await res.json());

      expect((title ?? '').trim()).toBe(book.title);
      expect((author ?? '').trim()).toContain(book.author);
    });
  });
});
