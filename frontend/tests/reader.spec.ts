// @ts-nocheck - E2E tests have different type strictness requirements
/**
 * Reading Experience E2E Tests
 *
 * Покрытие то же, что и раньше: открытие читалки, листание, оглавление,
 * закладки, выделение, прогресс, тема, размер шрифта, восстановление позиции.
 *
 * Что изменилось после сверки с приложением:
 *
 * - Каждый тест раньше заново проходил библиотеку, чтобы получить id книги.
 *   Теперь id приходит из worker-фикстуры, и `beforeEach` открывает читалку
 *   напрямую. Прогулка через библиотеку — предмет `books.spec.ts`.
 * - Кнопок листания (`reader-next-page`/`reader-prev-page`) в приложении нет
 *   и не было: страницы листаются тапом по боковым зонам. Управление скрыто
 *   до тапа в центр. Всё это спрятано в `ReaderPage`.
 * - Закладка ставится через меню выделения, а не кнопкой в шапке
 *   (`reader-bookmark-button` тоже никогда не существовал).
 * - Позиция чтения хранится не в `localStorage.last_cfi`, а в сторе
 *   `fancai-reader` и на сервере; проверяется восстановлением после
 *   перезагрузки.
 */

import { test, expect } from './fixtures/worker-user';
import { ReaderPage } from './pages';

// Рендер реального EPUB — десятки секунд, и это не признак поломки.
test.setTimeout(120000);

/**
 * Почему выделение текста не проверяется на движках WebKit.
 *
 * epub.js рисует книгу в iframe с `sandbox="allow-same-origin"` и БЕЗ
 * `allow-scripts` — это зашито в самой библиотеке
 * (`epubjs/lib/managers/views/iframe.js:97-101`). WebKit в такой документ
 * не доставляет НИ ОДНОГО события: измерено на голой странице — ни
 * нативный клик/тап, ни даже программный `dispatchEvent` из родителя не
 * запускают слушателей (`fired: []`), тогда как Chromium на тех же вызовах
 * даёт `["mouseup","selectionchange"]`, а в iframe БЕЗ sandbox всё доходит
 * и в WebKit. Само выделение при этом создаётся: `getSelection().toString()`
 * возвращает текст — недоступно именно уведомление.
 *
 * Приложение узнаёт о выделении только через события документа iframe
 * (`rendition.on('selected')` у epub.js и `selectionchange`,
 * `useTextSelection.ts:229`), поэтому на WebKit сообщить ему нечем — ни
 * тесту, ни пользователю. Это ограничение движка, а не наша регрессия:
 * тот же вывод уже зафиксирован в коде для iOS (`useGestureController.ts:773`
 * — «iOS doesn't deliver events to iframe content, so we can't use
 * selectionchange»); здесь он обобщён на весь WebKit и подтверждён замером.
 *
 * Обойти можно лишь двумя способами, и оба вне этой задачи: включить
 * `allow-scripts` (скрипты в загруженных пользователями EPUB получат доступ
 * к нашему origin — регрессия безопасности) либо перевести детекцию
 * выделения на опрос из родителя (изменение продукта, затрагивает живых
 * пользователей Safari). Вынесено долгом в `docs/handoff.md`.
 */
const SELECTION_UNAVAILABLE_ON_WEBKIT =
  'WebKit не доставляет события в засэндбоксенный iframe epub.js — ' +
  'приложению нечем узнать о выделении; см. комментарий у константы';

test.beforeEach(async ({ page, fixtureBookId }) => {
  test.skip(!fixtureBookId, 'в dev-БД нет разобранной книги');

  // Сессия слота уже в контексте (worker-фикстура storageState): вход
  // в каждом тесте упирался бы в лимит 10 логинов в минуту на IP.
  const readerPage = new ReaderPage(page);
  await readerPage.navigate(fixtureBookId);
  await readerPage.waitForReaderToLoad();
});

test.describe('Reading Experience', () => {
  test.describe('Book Reader', () => {
    test('should successfully open book reader', async ({ page, fixtureBookId }) => {
      const readerPage = new ReaderPage(page);

      expect(await readerPage.isReaderLoaded()).toBe(true);
      expect(page.url()).toContain(`/book/${fixtureBookId}/read`);
    });

    test('should display book content in reader', async ({ page }) => {
      const readerPage = new ReaderPage(page);

      // Первый экран книги — обложка (svg.cover-svg), текста там нет.
      expect(await readerPage.goToTextContent()).toBe(true);
      expect((await readerPage.getContentText()).length).toBeGreaterThan(100);
    });
  });

  test.describe('Page Navigation', () => {
    test('should navigate to next page', async ({ page }) => {
      const readerPage = new ReaderPage(page);

      const initialPage = await readerPage.getCurrentPage();
      await readerPage.nextPage();

      await expect
        .poll(() => readerPage.getCurrentPage(), { timeout: 20000 })
        .toBeGreaterThan(initialPage);
    });

    test('should navigate to previous page', async ({ page }) => {
      const readerPage = new ReaderPage(page);

      await readerPage.nextPage();
      const currentPage = await readerPage.getCurrentPage();
      expect(currentPage).toBeGreaterThan(1);

      await readerPage.previousPage();
      await expect
        .poll(() => readerPage.getCurrentPage(), { timeout: 20000 })
        .toBeLessThan(currentPage);
    });

    test('should display correct page indicator', async ({ page }) => {
      const readerPage = new ReaderPage(page);

      const currentPage = await readerPage.getCurrentPage();
      const totalPages = await readerPage.getTotalPages();

      expect(currentPage).toBeGreaterThan(0);
      expect(totalPages).toBeGreaterThan(0);
      expect(currentPage).toBeLessThanOrEqual(totalPages);
    });
  });

  test.describe('Table of Contents', () => {
    test('should open table of contents', async ({ page }) => {
      const readerPage = new ReaderPage(page);

      await readerPage.openTableOfContents();
      await expect(page.locator('[data-testid="toc-sidebar"]')).toBeVisible();
    });

    test('should navigate to chapter from TOC', async ({ page }) => {
      const readerPage = new ReaderPage(page);

      await readerPage.goToTextContent();
      const before = (await readerPage.getContentText()).slice(0, 200);
      // Последняя глава, а не глава с фиксированным номером: позиция
      // восстанавливается, и фиксированная цель может оказаться текущей.
      await readerPage.navigateToLastChapter();

      // Переход в другую главу обязан сменить содержимое кадра.
      await expect
        .poll(async () => (await readerPage.getContentText()).slice(0, 200), { timeout: 30000 })
        .not.toBe(before);
    });
  });

  test.describe('Bookmarks', () => {
    test('should create a bookmark from the selection menu', async ({
      page,
      fixtureBookId,
      browserName,
    }) => {
      test.skip(browserName === 'webkit', SELECTION_UNAVAILABLE_ON_WEBKIT);

      const readerPage = new ReaderPage(page);

      const selected = await readerPage.selectText();
      expect(selected, 'меню выделения должно появиться на выделенном абзаце').toBe(true);

      // Кнопка «Закладка» не сохраняет сразу — она разворачивает редактор
      // заметки с цветами и полем текста; запись уходит по «Сохранить».
      const menu = page.locator('[data-testid="selection-menu"]');
      await menu.locator('button[aria-label="Закладка"]').click();

      const saved = page.waitForResponse(
        (r) =>
          r.url().includes(`/sync/books/${fixtureBookId}/bookmarks`) &&
          r.request().method() === 'POST',
        { timeout: 20000 }
      );
      await menu.getByRole('button', { name: /Сохранить|Save/i }).click();
      const response = await saved;
      expect(response.ok(), `POST закладки вернул ${response.status()}`).toBe(true);
    });

    test('should keep the selection menu closed without a selection', async ({ page }) => {
      // Обратный контроль к тесту выше: без выделения меню не всплывает.
      await expect(page.locator('[data-testid="selection-menu"]')).toHaveCount(0);
    });
  });

  test.describe('Text Highlighting', () => {
    test('should show selection menu on text selection', async ({ page, browserName }) => {
      test.skip(browserName === 'webkit', SELECTION_UNAVAILABLE_ON_WEBKIT);

      const readerPage = new ReaderPage(page);

      expect(await readerPage.selectText()).toBe(true);
      const menu = page.locator('[data-testid="selection-menu"]');
      await expect(menu).toBeVisible();
      // Действия меню проверяются здесь же: отдельный тест на «в меню есть
      // кнопки» повторял ту же селекцию и ничего не добавлял к покрытию.
      await expect(menu.locator('button')).not.toHaveCount(0);
    });
  });

  test.describe('Reading Progress', () => {
    test('should save reading progress', async ({ page, fixtureBookId }) => {
      const readerPage = new ReaderPage(page);

      await readerPage.nextPage();
      await readerPage.nextPage();
      const reached = await readerPage.getCurrentPage();
      expect(reached).toBeGreaterThan(1);

      // Прогресс уезжает на сервер с задержкой — даём ему уйти до перезагрузки.
      await page.waitForTimeout(3000);
      await readerPage.navigate(fixtureBookId);
      await readerPage.waitForReaderToLoad();

      await expect
        .poll(() => readerPage.getCurrentPage(), { timeout: 30000 })
        .toBeGreaterThan(1);
    });

    test('should display reading progress percentage', async ({ page }) => {
      const readerPage = new ReaderPage(page);

      const progress = await readerPage.getReadingProgress();
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(100);
    });
  });

  test.describe('Theme Switching', () => {
    test('should switch to dark theme', async ({ page }) => {
      const readerPage = new ReaderPage(page);

      await readerPage.changeTheme('dark');
      // Тема читалки живёт в отдельном ключе `app-theme`, а не в сторе
      // `fancai-reader`: её пишет useEpubThemes.
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('app-theme') ?? ''), {
          timeout: 10000,
        })
        .toContain('dark');
    });

    test('should switch to light theme', async ({ page }) => {
      const readerPage = new ReaderPage(page);

      await readerPage.changeTheme('dark');
      await readerPage.changeTheme('light');
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('app-theme') ?? ''), {
          timeout: 10000,
        })
        .toContain('light');
    });

    test('should persist theme preference', async ({ page, fixtureBookId }) => {
      const readerPage = new ReaderPage(page);

      await readerPage.changeTheme('sepia');
      await readerPage.navigate(fixtureBookId);
      await readerPage.waitForReaderToLoad();

      const persisted = await page.evaluate(() => localStorage.getItem('app-theme') ?? '');
      expect(persisted).toContain('sepia');
    });
  });

  test.describe('Font Size Adjustment', () => {
    // Размер шрифта читалки пишется отдельным ключом, а не в стор.
    const readFontSize = (page) =>
      page.evaluate(() => Number(localStorage.getItem('epub_reader_font_size') ?? '0'));

    test('should increase font size', async ({ page }) => {
      const readerPage = new ReaderPage(page);

      const before = await readFontSize(page);
      await readerPage.changeFontSize('increase');
      await expect.poll(() => readFontSize(page), { timeout: 10000 }).toBeGreaterThan(before);
    });

    test('should decrease font size', async ({ page }) => {
      const readerPage = new ReaderPage(page);

      await readerPage.changeFontSize('increase');
      const before = await readFontSize(page);
      await readerPage.changeFontSize('decrease');
      await expect.poll(() => readFontSize(page), { timeout: 10000 }).toBeLessThan(before);
    });
  });

  test.describe('CFI Position Tracking', () => {
    test('should track reading position with CFI', async ({ page, fixtureBookId }) => {
      const readerPage = new ReaderPage(page);

      // Прогресс уходит на сервер с задержкой (debounce в useProgressSync),
      // поэтому ждём саму запись, а не фиксированную паузу: на паузе
      // в 3 секунды тест иногда читал `{"progress":null}`.
      const saved = page.waitForResponse(
        (r) =>
          r.url().includes(`/books/${fixtureBookId}/progress`) &&
          r.request().method() === 'POST',
        { timeout: 30000 }
      );
      await readerPage.nextPage();
      await readerPage.nextPage();
      await saved;

      // Позиция — epub.js CFI, и хранится она на сервере, а не в localStorage:
      // ключа `last_cfi` в приложении нет вовсе.
      const progress = await page.request.get(`/api/v1/books/${fixtureBookId}/progress`);
      expect(progress.ok(), `GET прогресса вернул ${progress.status()}`).toBe(true);
      expect(JSON.stringify(await progress.json())).toMatch(/epubcfi\(/);

      await readerPage.navigate(fixtureBookId);
      await readerPage.waitForReaderToLoad();
      await expect.poll(() => readerPage.getCurrentPage(), { timeout: 30000 }).toBeGreaterThan(1);
    });
  });
});
