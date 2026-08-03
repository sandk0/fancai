import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { TestUser } from './test-users';

/**
 * Аккаунт, книга и готовая сессия текущего parallel-слота Playwright.
 *
 * Две причины, почему фикстура именно такая.
 *
 * 1. **Изоляция данных.** Пять браузерных проектов идут параллельно,
 *    а `books.spec.ts` удаляет книгу настоящим DELETE — вместе с файлом
 *    на диске. С общей фикстурой первый же прошедший delete-тест оставлял
 *    бы спеки читалки и картинок без данных. `parallelIndex` уникален среди
 *    одновременно работающих воркеров, поэтому один слот = один пользователь.
 *
 * 2. **Один вход на воркер.** `POST /api/v1/auth/login` ограничен пресетом
 *    `auth` — 10 запросов в минуту, и ключ у него `ip:` (`rate_limit.py:227`),
 *    то есть общий на все воркеры. Логин в каждом `beforeEach` упирался
 *    в 429, и половина набора падала на `waitForURL('/library')`. Здесь вход
 *    делается один раз на слот, а тесты получают готовый `storageState`.
 *    Спекам, которые проверяют сам вход, состояние не нужно — они объявляют
 *    `test.use({ storageState: undefined })`.
 *
 * Данные готовит `backend/scripts/e2e_fixture.py`, состояние прогона
 * приезжает через `E2E_FIXTURE_STATE` (его выставляет globalSetup).
 */

/** Каталог кэша сессий: переживает воркеры, чистится в globalSetup/teardown. */
export const AUTH_STATE_DIR = path.join(process.cwd(), 'test-results', '.auth');

interface WorkerFixtureState {
  run_id: string;
  password: string;
  workers: Array<{
    index: number;
    email: string;
    id: string;
    book: {
      book_id: string;
      chapters: number;
      seeded_chapter: number | null;
      seeded_chapter_title: string | null;
      description_ids: string[];
      image_id: string | null;
    } | null;
  }>;
}

export interface WorkerFixtures {
  /** Пользователь этого parallel-слота. */
  testUser: TestUser;
  /** ID книги с разобранными главами у этого пользователя, если она есть. */
  fixtureBookId: string | null;
  /** Номер главы, в которую засеяны описания, и id засеянной картинки. */
  fixtureSeed: {
    chapter: number | null;
    chapterTitle: string | null;
    descriptionIds: string[];
    imageId: string | null;
  };
  /** Путь к сохранённой сессии слота. */
  workerStorageState: string;
}

export const test = base.extend<Record<never, never>, WorkerFixtures>({
  testUser: [
    async ({}, use, workerInfo) => {
      const raw = process.env.E2E_FIXTURE_STATE;
      if (!raw) {
        throw new Error(
          'E2E_FIXTURE_STATE не задан — globalSetup не отработал. Тесты не должны ' +
            'создавать пользователей вне пространства имён прогона: иначе ' +
            'globalTeardown не сможет их убрать.'
        );
      }
      const state = JSON.parse(raw) as WorkerFixtureState;
      const slot = state.workers[workerInfo.parallelIndex];
      if (!slot) {
        throw new Error(
          `Фикстура не создала аккаунт для parallelIndex=${workerInfo.parallelIndex}. ` +
            `Создано ${state.workers.length}; workers в playwright.config.ts ` +
            'и --workers в globalSetup обязаны совпадать.'
        );
      }
      await use({
        email: slot.email,
        username: `worker${slot.index}`,
        password: state.password,
        firstName: 'E2E',
        lastName: `Worker ${slot.index}`,
      });
    },
    { scope: 'worker' },
  ],

  fixtureBookId: [
    async ({}, use, workerInfo) => {
      const state = JSON.parse(process.env.E2E_FIXTURE_STATE ?? '{"workers":[]}');
      await use(state.workers[workerInfo.parallelIndex]?.book?.book_id ?? null);
    },
    { scope: 'worker' },
  ],

  fixtureSeed: [
    async ({}, use, workerInfo) => {
      const state = JSON.parse(process.env.E2E_FIXTURE_STATE ?? '{"workers":[]}');
      const book = state.workers[workerInfo.parallelIndex]?.book;
      await use({
        chapter: book?.seeded_chapter ?? null,
        chapterTitle: book?.seeded_chapter_title ?? null,
        descriptionIds: book?.description_ids ?? [],
        imageId: book?.image_id ?? null,
      });
    },
    { scope: 'worker' },
  ],

  workerStorageState: [
    async ({}, use, workerInfo) => {
      // Сессии создаёт globalSetup — все четыре сразу, до старта тестов.
      // Ленивого входа здесь нет намеренно: он случался уже во время
      // прогона и конкурировал с auth-спеками за квоту `POST /auth/login`
      // (10 запросов в минуту на IP). Нет файла — это сбой setup, и о нём
      // надо узнать сразу, а не молча войти ещё раз.
      const runId = process.env.E2E_RUN_ID ?? 'norun';
      const file = path.join(AUTH_STATE_DIR, `${runId}-${workerInfo.parallelIndex}.json`);
      if (!fs.existsSync(file)) {
        throw new Error(
          `Нет сохранённой сессии слота ${workerInfo.parallelIndex} (${file}). ` +
            'globalSetup обязан создать её до запуска тестов.'
        );
      }
      await use(file);
    },
    { scope: 'worker' },
  ],

  storageState: async ({ workerStorageState }, use) => {
    await use(workerStorageState);
  },
});

export { expect };
