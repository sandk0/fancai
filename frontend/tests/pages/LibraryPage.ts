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
   * Загрузить книгу и дождаться, что она появилась в библиотеке.
   *
   * Возвращает id новой карточки. Ждать «скрытия индикатора загрузки»
   * нельзя: `upload-progress` в приложении нет, обратная связь идёт тостом,
   * а `waitForSelector(state:'hidden')` по несуществующему селектору
   * выполняется мгновенно — тест шёл дальше до появления книги.
   */
  async uploadBook(filePath: string): Promise<string> {
    const before = new Set(await this.getBookIds());
    await this.openUploadModal();
    return this.submitUpload(filePath, before);
  }

  /**
   * Отправить файл из **уже открытой** модалки и вернуть id новой книги.
   *
   * Идентифицировать загруженную книгу по позиции в списке нельзя:
   * библиотека сортируется `created_desc`, поэтому «последняя карточка» —
   * это самая старая, то есть книга фикстуры. Однажды на этом тест удалил
   * именно её и обрушил все последующие спеки читалки и галереи
   * на том же воркере. Единственный корректный признак — разность множеств.
   */
  async submitUpload(filePath: string, before: Set<string>): Promise<string> {
    await this.page.locator(this.fileInput).setInputFiles(filePath);
    // Выбор файла только кладёт его в очередь; отправку запускает кнопка.
    // На узких вьюпортах она уезжает за нижнюю границу прокручиваемой
    // области модалки, поэтому сначала подтягиваем её в вид.
    const start = this.page.locator('[data-testid="upload-start"]');
    await start.scrollIntoViewIfNeeded();
    await start.click();

    await this.page.waitForFunction(
      (known) =>
        Array.from(document.querySelectorAll('[data-testid^="book-card-"]')).some(
          (el) => !known.includes(el.getAttribute('data-testid') ?? '')
        ),
      Array.from(before).map((id) => `book-card-${id}`),
      { timeout: 60000 }
    );
    const created = (await this.getBookIds()).find((id) => !before.has(id));
    if (!created) throw new Error('Загруженная книга не появилась в библиотеке');
    await this.page.keyboard.press('Escape');
    return created;
  }

  /**
   * Открыть модалку загрузки.
   *
   * Кнопка на странице библиотеки — `hidden md:flex`, поэтому на мобильных
   * вьюпортах она недоступна; там загрузку открывает кнопка в шапке.
   */
  async openUploadModal(): Promise<void> {
    const onPage = this.page.locator(this.uploadButton);
    if (await onPage.isVisible().catch(() => false)) {
      await onPage.click();
    } else {
      await this.click('[data-testid="header-upload-button"]');
    }
    await this.waitForElement('[data-testid="upload-modal"]', 10000);
  }

  /** Идентификаторы книг, видимых в библиотеке. */
  async getBookIds(): Promise<string[]> {
    return this.page
      .locator('[data-testid^="book-card-"]')
      .evaluateAll((els) =>
        els.map((el) => (el.getAttribute('data-testid') ?? '').replace('book-card-', ''))
      );
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
    // Панель фильтров свёрнута по умолчанию — сперва её надо раскрыть.
    if (!(await this.page.locator(this.genreFilter).isVisible().catch(() => false))) {
      await this.click('[data-testid="filters-toggle"]');
      await this.waitForElement(this.genreFilter, 10000);
    }
    await this.page.selectOption(this.genreFilter, genre);
    await this.wait(700);
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
  /**
   * Открыть страницу книги (не читалку).
   *
   * Клик по карточке ведёт на `/book/:id` — экран с описанием и кнопкой
   * чтения (`LibraryPage.tsx:166`). За читалкой — `ReaderPage.navigate`.
   */
  async openBook(bookId: string): Promise<void> {
    await this.click(`[data-testid="book-card-${bookId}"]`);
    await this.page.waitForURL(`**/book/${bookId}`);
  }

  /**
   * Delete book
   */
  /**
   * Довести карточку до открытого диалога подтверждения удаления.
   *
   * На desktop кнопки показываются по hover (DesktopHoverOverlay),
   * на мобильных — через `book-menu-*` (сам триггер под `md:hidden`).
   */
  async openDeleteDialog(bookId: string): Promise<void> {
    const menu = this.page.locator(`[data-testid="book-menu-${bookId}"]`);
    if (await menu.isVisible()) {
      await menu.click();
    } else {
      await this.page.locator(`[data-testid="book-card-${bookId}"]`).hover();
    }
    // `delete-book-*` рендерят обе ветки карточки — DesktopHoverOverlay
    // и MobileMenu, — поэтому на мобильном вьюпорте в DOM их две и обычный
    // локатор падает strict mode violation. Берём видимую.
    const remove = this.page
      .locator(`[data-testid="delete-book-${bookId}"]`)
      .locator('visible=true')
      .first();
    await remove.waitFor({ state: 'visible', timeout: 10000 });
    await remove.scrollIntoViewIfNeeded();
    await remove.click();
    await this.waitForElement('[data-testid="confirm-delete"]', 10000);
  }

  /**
   * Delete book
   */
  async deleteBook(bookId: string): Promise<void> {
    await this.openDeleteDialog(bookId);
    await this.click('[data-testid="confirm-delete"]');

    await this.page.waitForSelector(`[data-testid="book-card-${bookId}"]`, {
      state: 'detached',
      timeout: 20000,
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
   * Дождаться, что библиотека отрисована.
   *
   * Ждать только исчезновения скелетона недостаточно: `state: 'hidden'`
   * выполняется мгновенно, если элемента ещё нет в DOM, и следующий
   * `getBookCount()` считает ноль карточек на пустой странице. Условие
   * должно быть положительным — карточка либо явное пустое состояние.
   */
  async waitForBooksToLoad(): Promise<void> {
    await this.page
      .waitForSelector(this.loadingState, { state: 'hidden', timeout: 15000 })
      .catch(() => undefined);
    await this.page.waitForSelector(`[data-testid^="book-card-"], ${this.emptyState}`, {
      timeout: 20000,
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
