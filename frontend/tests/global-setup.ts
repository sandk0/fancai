import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type FullConfig } from '@playwright/test';
import { AUTH_STATE_DIR } from './fixtures/worker-user';

/**
 * Обратимая фикстура среды для e2e-прогона.
 *
 * Вся работа с БД делается кодом приложения внутри `fancai_backend_dev`
 * (`backend/scripts/e2e_fixture.py`): так хеш пароля, модели и каскады
 * гарантированно те же, что в бою, а не переписанные на TypeScript.
 *
 * Здесь оркестрация: создать по аккаунту и книге на каждый parallel-слот,
 * войти под каждым один раз и разложить состояние по `E2E_FIXTURE_STATE`
 * и `E2E_RUN_ID`.
 */

export const FIXTURE_CONTAINER = process.env.E2E_FIXTURE_CONTAINER ?? 'fancai_backend_dev';
export const FIXTURE_STATE_PATH = '/tmp/e2e-fixture-state.json';

export function runFixture(args: string[]): string {
  return execFileSync(
    'docker',
    ['exec', FIXTURE_CONTAINER, 'python', 'scripts/e2e_fixture.py', ...args, '--state', FIXTURE_STATE_PATH],
    { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

async function globalSetup(config: FullConfig): Promise<void> {
  // config.workers — фактическое число parallel-слотов; на каждый нужен
  // свой аккаунт, иначе спеки подерутся за одну книгу.
  const output = runFixture(['setup', '--workers', String(config.workers)]);

  // Дальше данные уже закоммичены, а Playwright не гарантирует вызов
  // globalTeardown после упавшего globalSetup. Поэтому ВСЁ, что ниже,
  // обязано убирать за собой само — иначе аккаунты, книги и файлы
  // останутся в dev-БД навсегда.
  let warmupBrowser: Browser | undefined;
  let authBrowser: Browser | undefined;
  try {
    const raw = execFileSync('docker', ['exec', FIXTURE_CONTAINER, 'cat', FIXTURE_STATE_PATH], {
      encoding: 'utf-8',
    });
    const state = JSON.parse(raw) as {
      run_id: string;
      database: string;
      password: string;
      workers: Array<{ index: number; email: string; book: { chapters: number } | null }>;
    };

    process.env.E2E_RUN_ID = state.run_id;
    process.env.E2E_FIXTURE_STATE = raw;
    // Кэш сессий от прошлых прогонов не переиспользуем: аккаунты у каждого
    // прогона свои, а чужой файл дал бы 401 в середине матрицы.
    fs.rmSync(AUTH_STATE_DIR, { recursive: true, force: true });
    fs.mkdirSync(AUTH_STATE_DIR, { recursive: true });

    const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:5173';

    // Прогрев dev-сервера. Vite компилирует маршруты по требованию, и первый
    // вход занимает десятки секунд — на четырёх воркерах это съедало таймаут
    // теста ещё в worker-фикстуре («page.waitForURL: Test ended»).
    warmupBrowser = await chromium.launch();
    const warmup = await warmupBrowser.newPage({ baseURL });
    for (const route of ['/login', '/register', '/library']) {
      await warmup.goto(route, { waitUntil: 'networkidle' }).catch(() => undefined);
    }

    // Сессии создаются здесь, а не лениво в worker-фикстуре: ленивый вход
    // случался уже во время прогона и конкурировал с auth-спеками за квоту
    // `POST /auth/login` — 10 запросов в минуту на IP. Cookie и localStorage
    // переносимы между проектами, поэтому хватает одного браузера.
    authBrowser = await chromium.launch();
    for (const slot of state.workers) {
      const ctx = await authBrowser.newContext({ baseURL });
      const page = await ctx.newPage();
      await page.goto('/login');
      await page.fill('[data-testid="login-email"]', slot.email);
      await page.fill('[data-testid="login-password"]', state.password);
      await page.click('[data-testid="login-submit"]');
      await page.waitForURL('/library', { timeout: 90000 });
      // Ждём смонтированного меню, а не только URL: `auth-store` пишется
      // в localStorage после редиректа, и снимок мог сохраниться без него.
      await page.waitForSelector('[data-testid="user-menu-trigger"]', { timeout: 60000 });
      await ctx.storageState({
        path: path.join(AUTH_STATE_DIR, `${state.run_id}-${slot.index}.json`),
      });
      await ctx.close();
    }

    const withBooks = state.workers.filter((w) => w.book).length;
    console.log(
      `[e2e fixture] db=${state.database} run=${state.run_id} ` +
        `workers=${state.workers.length} с книгой=${withBooks}`
    );
    for (const line of output.split('\n').filter((l) => /^(worker|WARN)/.test(l))) {
      console.log(`[e2e fixture]   ${line}`);
    }
  } catch (error) {
    fs.rmSync(AUTH_STATE_DIR, { recursive: true, force: true });
    try {
      runFixture(['teardown']);
      // Явный маркер, а не догадка по тексту ошибки: globalTeardown всё
      // равно будет вызван и не должен заявлять «dev-БД осталась
      // изменённой», когда setup уже убрал за собой.
      process.env.E2E_SETUP_CLEANED = '1';
    } catch (cleanupError) {
      // Провал уборки нельзя прятать за исходной ошибкой: dev-БД осталась
      // изменённой, и об этом должно быть сказано отдельной строкой.
      throw new AggregateError(
        [error, cleanupError],
        'globalSetup упал, и уборка фикстуры тоже не прошла — dev-БД осталась изменённой'
      );
    }
    throw error;
  } finally {
    await warmupBrowser?.close().catch(() => undefined);
    await authBrowser?.close().catch(() => undefined);
  }
}

export default globalSetup;
