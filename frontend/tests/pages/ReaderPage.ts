/**
 * Reader Page Object Model
 *
 * Модель взаимодействия у читалки не кнопочная, и объект страницы обязан
 * это отражать:
 *
 * - Панели управления скрыты, пока их не раскроют; `ReaderUI` вообще
 *   не монтируется, пока rendition не готов, поэтому ждать надо не
 *   контейнер, а `reader-ready` — узел, который появляется вместе с
 *   `ReaderUI`. Раскрытие: пальцем в центр там, где есть касания,
 *   иначе `Escape` — в десктопном WebKit мышь до книги не доходит
 *   вовсе (подробности у `showControls`).
 * - Кнопок листания (`reader-next-page`/`reader-prev-page`) не существует.
 *   На мобиле листают тапом по боковым зонам, но обработчик слушает
 *   `touchstart`/`touchend`, а десктопный контекст Playwright их не шлёт
 *   (`hasTouch: false`). Рабочий на десктопе путь — клавиатура:
 *   `useKeyboardNavigation` вешает ArrowLeft/ArrowRight и на окно,
 *   и на документ iframe. Проверено вживую: три ArrowRight сдвигают
 *   индикатор с «1 из 236» на «2 из 236», ArrowLeft возвращает.
 * - Первая страница книги — **обложка**: в iframe лежит `<svg class="cover-svg">`
 *   и ни одного `<p>`. Всё, что работает с текстом, обязано сначала уйти
 *   с обложки — иначе выделять нечего.
 */

import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

/** Пауза после одного центрального тапа: он переключатель, спешить нельзя. */
const REVEAL_ATTEMPT_WAIT = 8000;
/** Сколько нажатий даём индикатору, чтобы он сдвинулся. */
const MAX_TURN_ATTEMPTS = 5;
/** Вкладки боковой панели: «Оглавление», «Закладки», «Информация». */
const TOC_TAB_COUNT = 3;
/** Столько экранов максимум листаем в поисках текстовой страницы. */
const MAX_SEEK_SCREENS = 12;

export class ReaderPage extends BasePage {
  // Selectors
  private readonly readerContainer = '[data-testid="epub-reader"]';
  /** Монтируется ровно вместе с `ReaderUI` — единственный внешний признак готовности. */
  private readonly readerReady = '[data-testid="reader-ready"]';
  private readonly tocButton = '[data-testid="reader-toc-button"]';
  private readonly tocSidebar = '[data-testid="toc-sidebar"]';
  private readonly settingsButton = '[data-testid="reader-settings-button"]';
  private readonly themeLightButton = '[data-testid="theme-light"]';
  private readonly closeButton = '[data-testid="reader-close-button"]';
  private readonly pageIndicator = '[data-testid="reader-page-indicator"]';
  private readonly progressBar = '[data-testid="reader-progress-bar"]';
  private readonly selectionMenu = '[data-testid="selection-menu"]';

  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to reader for specific book
   */
  async navigate(bookId: string): Promise<void> {
    await this.goto(`/book/${bookId}/read`);
  }

  /**
   * Wait for reader to load and reveal its controls.
   *
   * Ожидание одного `epub-reader` недостаточно: контейнер появляется сразу,
   * а `ReaderUI` — только после `renditionReady && bookMetadata`, что на
   * реальном EPUB занимает десятки секунд.
   */
  async waitForReaderToLoad(): Promise<void> {
    await this.waitForElement(this.readerContainer, 30000);
    await this.showControls(60000);
    await this.waitForStableIndicator();
  }

  /**
   * Дождаться, пока номер страницы перестанет меняться.
   *
   * Читать индикатор сразу после раскрытия панелей нельзя: у книги
   * с сохранённым прогрессом номер доезжает после восстановления позиции,
   * и тест, снявший «начальную» страницу слишком рано, потом видит
   * движение назад (наблюдалось 11 -> 9). В одиночном прогоне индикатор
   * стабилен за ~0,5 с — ожидание дешёвое.
   */
  private async waitForStableIndicator(timeout = 15000): Promise<void> {
    const deadline = Date.now() + timeout;
    let previous: string | null = null;
    while (Date.now() < deadline) {
      const current = await this.page
        .locator(this.pageIndicator)
        .textContent()
        .catch(() => null);
      if (current !== null && current === previous) return;
      previous = current;
      await this.wait(600);
    }
  }

  /**
   * Раскрыть панели читалки.
   *
   * Раньше здесь был цикл центральных тапов с самого начала загрузки, и это
   * ломало два движка сразу. Измерено:
   *
   * - тапы до готовности не просто «проглатываются»: на Mobile Safari серия
   *   тапов с ~0,2 с оставляла читалку НЕготовой навсегда (96 с, `ReaderUI`
   *   так и не смонтирован), тогда как без раннего ввода она готова к 12 с
   *   и раскрывается одним тапом;
   * - в десктопном WebKit центральный клик не доходит вообще никуда:
   *   epub.js рисует книгу в iframe с `sandbox="allow-same-origin"` без
   *   `allow-scripts`, а WebKit не доставляет в такой документ ни одного
   *   события (проверено на движке: в iframe без sandbox тот же клик
   *   доходит). Обработчик центрального тапа живёт как раз на документе
   *   iframe, поэтому мышью панели там недостижимы.
   *
   * Отсюда порядок: сначала дождаться `reader-ready` — узла, который
   * монтируется ровно вместе с `ReaderUI`, — и только потом ОДИН ввод.
   * `onToggleUI` переключатель, второй ввод подряд гасит собственный успех.
   * Клавиатура (`Escape`) работает на всех движках: слушатель висит на
   * родительском `window`, куда sandbox не достаёт. Пальцем бьём только
   * там, где мышиных событий приложение не получает.
   */
  async showControls(timeout = 60000): Promise<void> {
    if (await this.page.locator(this.pageIndicator).isVisible().catch(() => false)) {
      return;
    }

    // Именно `attached`: узел-признак — нулевого размера (это якорь
    // выпадающего меню настроек, закрытое меню детей не рисует), поэтому
    // проверка на видимость по умолчанию не прошла бы никогда ни в одном
    // движке. Нам нужен факт монтирования `ReaderUI`, а не его габариты.
    await this.page.waitForSelector(this.readerReady, { timeout, state: 'attached' });

    const hasTouch = await this.page.evaluate(() => navigator.maxTouchPoints > 0);
    if (hasTouch) {
      const box = await this.page.locator(this.readerContainer).boundingBox();
      // Центр КОНТЕЙНЕРА, а не body внутри кадра: на обложке body растянут
      // по viewBox 1500×2387, его центр вне вьюпорта.
      if (box) {
        await this.page.touchscreen
          .tap(box.x + box.width / 2, box.y + box.height / 2)
          .catch(() => undefined);
      }
    } else {
      await this.page.keyboard.press('Escape');
    }

    if (await this.controlsVisible(REVEAL_ATTEMPT_WAIT)) return;

    throw new Error('Панели читалки не раскрылись за отведённое время');
  }

  private async controlsVisible(timeout: number): Promise<boolean> {
    return this.page
      .waitForSelector(this.pageIndicator, { timeout })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Перелистнуть до фактического сдвига индикатора В НУЖНУЮ СТОРОНУ.
   *
   * Один ArrowRight двигает экран, но напечатанный номер страницы меняется
   * не на каждом экране — пагинация epub.js мельче, чем шаг индикатора.
   * Поэтому «страница» здесь — наблюдаемое изменение индикатора.
   *
   * Сторона проверяется намеренно, а не просто «номер изменился». Читалка
   * восстанавливает позицию с сервера, и у книги фикстуры прогресс мог
   * остаться от прошлых тестов прогона (фикстура пока общая на все
   * проекты — долг назван в `docs/handoff.md`). Тогда первый снятый номер
   * оказывался чужим, а последующая поправка выглядела как «страница
   * сменилась»: `ArrowRight` со страницы 11 давал 9, и тест это принимал.
   * Требование монотонности отсекает такие поправки, но НЕ маскирует
   * настоящий дефект: если приложение реально листает не туда, попытки
   * исчерпаются и тест упадёт.
   */
  private async turnPage(key: 'ArrowRight' | 'ArrowLeft'): Promise<void> {
    const forward = key === 'ArrowRight';
    let before = await this.getCurrentPage();
    for (let attempt = 0; attempt < MAX_TURN_ATTEMPTS; attempt++) {
      await this.page.keyboard.press(key);
      await this.wait(1000);
      const now = await this.getCurrentPage();
      if (forward ? now > before : now < before) return;
      // Номер уехал в противоположную сторону сам — это доехавшее
      // восстановление позиции, а не наше листание: берём его за новую
      // отправную точку, иначе сравнение навсегда останется с чужим числом.
      if (now !== before) before = now;
    }
    throw new Error(
      `Индикатор страницы не сдвинулся ${forward ? 'вперёд' : 'назад'} ` +
        `после ${MAX_TURN_ATTEMPTS} нажатий ${key}`
    );
  }

  /**
   * Go to next page
   */
  async nextPage(): Promise<void> {
    await this.turnPage('ArrowRight');
  }

  /**
   * Go to previous page
   */
  async previousPage(): Promise<void> {
    await this.turnPage('ArrowLeft');
  }

  /** Текстовое содержимое текущего экрана книги (внутри iframe epub.js). */
  async getContentText(): Promise<string> {
    return this.page.evaluate(
      () => document.querySelector('iframe')?.contentDocument?.body?.textContent?.trim() ?? ''
    );
  }

  /**
   * Уйти с обложки на первый экран с текстом.
   *
   * Первая страница книги — `<svg class="cover-svg">` без единого абзаца,
   * поэтому всё, что работает с текстом, обязано сначала позвать это.
   */
  async goToTextContent(): Promise<boolean> {
    for (let screen = 0; screen < MAX_SEEK_SCREENS; screen++) {
      if ((await this.getContentText()).length >= 100) return true;
      await this.page.keyboard.press('ArrowRight');
      await this.wait(900);
    }
    return (await this.getContentText()).length >= 100;
  }

  /**
   * Open table of contents
   */
  async openTableOfContents(): Promise<void> {
    await this.showControls();
    await this.click(this.tocButton);
    await this.waitForElement(this.tocSidebar);
  }

  /**
   * Navigate to chapter by its position in the TOC.
   */
  async navigateToChapter(chapterIndex: number): Promise<void> {
    await this.openTableOfContents();
    // Первые три кнопки панели — вкладки «Оглавление / Закладки / Информация»,
    // главы начинаются после них.
    await this.page
      .locator(`${this.tocSidebar} button`)
      .nth(TOC_TAB_COUNT + chapterIndex)
      .click();
    await this.wait(2000);
  }

  /**
   * Перейти в последнюю главу оглавления.
   *
   * Фиксированный индекс не годится для проверки «переход меняет
   * содержимое»: книга слота переиспользуется между проектами, читалка
   * восстанавливает позицию, и целевая глава может оказаться текущей —
   * тогда содержимое законно не меняется и тест врёт. Последняя запись
   * заведомо отличается от первого экрана.
   */
  async navigateToLastChapter(): Promise<void> {
    await this.openTableOfContents();
    const entries = this.page.locator(`${this.tocSidebar} button`);
    const total = await entries.count();
    await entries.nth(total - 1).click();
    await this.wait(2500);
  }

  /** Перейти в главу по её названию в оглавлении. */
  async navigateToChapterByTitle(title: string): Promise<void> {
    await this.openTableOfContents();
    await this.page
      .locator(`${this.tocSidebar} button`)
      .filter({ hasText: title })
      .first()
      .click();
    await this.wait(2500);
  }

  /**
   * Open settings
   */
  async openSettings(): Promise<void> {
    await this.showControls();
    // Кнопка настроек — переключатель (`setIsSettingsOpen(!isSettingsOpen)`),
    // поэтому повторный клик по уже открытой панели её закрывает.
    if (await this.page.locator(this.themeLightButton).isVisible().catch(() => false)) {
      return;
    }
    await this.click(this.settingsButton);
    await this.waitForElement(this.themeLightButton, 10000);
  }

  /**
   * Change theme
   */
  async changeTheme(theme: 'light' | 'dark' | 'sepia'): Promise<void> {
    await this.openSettings();
    await this.click(`[data-testid="theme-${theme}"]`);
    await this.wait(300);
  }

  /**
   * Change font size
   */
  async changeFontSize(direction: 'increase' | 'decrease'): Promise<void> {
    await this.openSettings();
    await this.click(`[data-testid="font-size-${direction}"]`);
    await this.wait(300);
  }

  /**
   * Select text inside the epub.js iframe and wait for the selection menu.
   *
   * Текст книги живёт в iframe, поэтому селекция строится в его документе,
   * а не в родительском — `document.querySelectorAll` снаружи его не видит.
   * И до текста надо ещё дойти: первый экран — обложка.
   */
  async selectText(): Promise<boolean> {
    if (!(await this.goToTextContent())) return false;

    const selected = await this.page.evaluate(() => {
      const doc = document.querySelector('iframe')?.contentDocument;
      if (!doc) return false;
      const node = Array.from(doc.querySelectorAll('p, div')).find(
        (el) => (el.textContent ?? '').trim().length >= 40 && el.children.length === 0
      );
      if (!node) return false;
      const range = doc.createRange();
      range.selectNodeContents(node);
      const selection = doc.defaultView?.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      doc.dispatchEvent(new Event('selectionchange', { bubbles: true }));
      return true;
    });
    if (!selected) return false;

    try {
      await this.waitForElement(this.selectionMenu, 8000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current page number
   */
  async getCurrentPage(): Promise<number> {
    await this.showControls();
    const text = await this.getText(this.pageIndicator);
    const match = text.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Get total pages
   */
  async getTotalPages(): Promise<number> {
    await this.showControls();
    const text = await this.getText(this.pageIndicator);
    // Индикатор локализован: «1 из 236» / «1 of 236»
    const match = text.match(/(\d+)\s*(?:\/|из|of)\s*(\d+)/i);
    return match ? parseInt(match[2], 10) : 0;
  }

  /**
   * Get reading progress
   */
  async getReadingProgress(): Promise<number> {
    await this.showControls();
    const progressElement = this.page.locator(this.progressBar);
    const ariaValue = await progressElement.getAttribute('aria-valuenow');
    return ariaValue ? parseInt(ariaValue, 10) : 0;
  }

  /**
   * Close reader
   */
  async closeReader(): Promise<void> {
    await this.showControls();
    await this.click(this.closeButton);
  }

  /**
   * Check if reader is loaded
   */
  async isReaderLoaded(): Promise<boolean> {
    return await this.isVisible(this.readerContainer);
  }
}
