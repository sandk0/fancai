// @ts-nocheck - E2E tests have different type strictness requirements
/**
 * Image Generation & Gallery E2E Tests
 *
 * Переписано 2026-08-05. Прежняя версия давала ложный зелёный: девять
 * утверждений вида `expect(x || true).toBe(true)` не могут упасть в принципе,
 * подсветки искались в родительском документе (текст книги живёт в iframe
 * epub.js), а половина тестов молча уходила в `test.skip()`, потому что
 * в dev-БД нет ни описаний, ни картинок.
 *
 * Предусловия готовит `backend/scripts/e2e_fixture.py`: у книги слота есть
 * сущность, два описания (их текст взят **дословно** из главы, иначе
 * подсветка их не найдёт) и одна готовая картинка с файлом в
 * `/app/storage/generated_images` — каталоге, из которого отдаёт `images.py`.
 *
 * **Настоящая генерация здесь не запускается.** Она означала бы платный
 * вызов провайдера, а это стоп-точка сессии. Проверяется всё, что до неё:
 * описания доезжают до читалки и подсвечиваются, галерея показывает готовую
 * картинку, файл реально отдаётся, ограничения тарифа видны в API.
 */

import { test, expect } from './fixtures/worker-user';
import { LibraryPage, ReaderPage } from './pages';

test.beforeEach(async ({ page, fixtureBookId }) => {
  test.skip(!fixtureBookId, 'в dev-БД нет разобранной книги');
  await page.goto('/library');
});

test.describe('Image Generation & Gallery', () => {
  test.describe('Descriptions in the reader', () => {
    test('should expose seeded descriptions through the API', async ({
      page,
      fixtureBookId,
      fixtureSeed,
    }) => {
      expect(fixtureSeed.chapter, 'фикстура обязана назвать главу с описаниями').not.toBeNull();
      const res = await page.request.get(
        `/api/v1/books/${fixtureBookId}/chapters/${fixtureSeed.chapter}/descriptions`
      );
      expect(res.ok(), `GET описаний вернул ${res.status()}`).toBe(true);

      // Форма ответа: { chapter_info, nlp_analysis: { descriptions: [...] } }
      const items = (await res.json()).nlp_analysis.descriptions;
      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(items.some((d) => d.type === 'character')).toBe(true);
      expect(items.some((d) => d.type === 'location')).toBe(true);
    });

    test('should highlight a description inside the book text', async ({
      page,
      fixtureBookId,
      fixtureSeed,
    }) => {
      const readerPage = new ReaderPage(page);
      await readerPage.navigate(fixtureBookId);
      await readerPage.waitForReaderToLoad();
      // Описания привязаны к конкретной главе — в неё и надо попасть.
      // Номер главы в БД не равен её позиции в оглавлении: там есть
      // служебные разделы, поэтому переход идёт по названию.
      expect(fixtureSeed.chapterTitle, 'фикстура обязана назвать главу').toBeTruthy();
      await readerPage.navigateToChapterByTitle(fixtureSeed.chapterTitle);

      // Подсветка живёт в документе iframe, а не в родительском.
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                document
                  .querySelector('iframe')
                  ?.contentDocument?.querySelectorAll(
                    '.description-highlight, [data-description-id]'
                  ).length ?? 0
            ),
          { timeout: 45000, intervals: [1500] }
        )
        .toBeGreaterThan(0);
    });
  });

  test.describe('Image Gallery', () => {
    test('should list the generated image for the book', async ({
      page,
      fixtureBookId,
      fixtureSeed,
    }) => {
      const res = await page.request.get(`/api/v1/images/book/${fixtureBookId}`);
      expect(res.ok(), `GET картинок вернул ${res.status()}`).toBe(true);

      const images = (await res.json()).images;
      expect(Array.isArray(images)).toBe(true);
      const seeded = images.find((i) => i.id === fixtureSeed.imageId);
      expect(seeded, 'засеянная картинка должна быть в выдаче').toBeTruthy();

      // `BookImageItem` не содержит status — он есть только в детальной
      // выдаче по описанию.
      const detail = await page.request.get(
        `/api/v1/images/description/${fixtureSeed.descriptionIds[0]}`
      );
      expect(detail.ok(), `GET картинки по описанию вернул ${detail.status()}`).toBe(true);
      expect((await detail.json()).status).toBe('completed');
    });

    test('should serve the image file itself', async ({ page, fixtureBookId, fixtureSeed }) => {
      const list = await (await page.request.get(`/api/v1/images/book/${fixtureBookId}`)).json();
      const image = list.images.find((i) => i.id === fixtureSeed.imageId);
      expect(image, 'засеянная картинка должна быть в выдаче').toBeTruthy();
      const url = image.image_url;
      expect(url, 'у готовой картинки должен быть непустой image_url').toBeTruthy();

      const file = await page.request.get(url);
      expect(file.status(), `файл картинки отдался как ${file.status()}`).toBe(200);
      expect((await file.body()).length).toBeGreaterThan(0);
    });

    test('should render the book gallery page', async ({ page, fixtureBookId }) => {
      await page.goto(`/book/${fixtureBookId}/images`);

      // Заголовок страницы — название книги; он появляется после загрузки.
      await expect(page.locator('h1')).toBeVisible({ timeout: 30000 });
      // Картинки в галерее лениво подгружаются через LazyImage, поэтому
      // `src` появляется не сразу; стабильный признак карточки — её
      // aria-label с текстом описания.
      await expect(page.locator('[aria-label^="View image"]').first()).toBeVisible({
        timeout: 30000,
      });
    });

    test('should render the all-images gallery page', async ({ page }) => {
      await page.goto('/images');
      await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 30000 });
    });
  });

  test.describe('Generation limits', () => {
    test('should report the subscription image quota', async ({ page }) => {
      // Лимиты — предусловие любой генерации; сама генерация не запускается,
      // это платный вызов провайдера и стоп-точка сессии.
      const res = await page.request.get('/api/v1/users/subscription');
      expect(res.ok(), `GET подписки вернул ${res.status()}`).toBe(true);
      const body = await res.json();
      expect(JSON.stringify(body)).toMatch(/images|limit|plan/i);
    });
  });

  test.describe('Library entry point', () => {
    test('should open the book page from the library', async ({ page, fixtureBookId }) => {
      const libraryPage = new LibraryPage(page);
      await libraryPage.waitForBooksToLoad();

      await libraryPage.openBook(fixtureBookId);
      expect(page.url()).toContain(`/book/${fixtureBookId}`);
    });
  });
});
