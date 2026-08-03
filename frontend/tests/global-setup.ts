import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { AUTH_STATE_DIR } from './fixtures/worker-user';
import { chromium, type FullConfig } from '@playwright/test';

/**
 * Обратимая фикстура среды для e2e-прогона.
 *
 * Вся работа с БД делается кодом приложения внутри `fancai_backend_dev`
 * (`backend/scripts/e2e_fixture.py`): так хеш пароля, модели и каскады
 * гарантированно те же, что в бою, а не переписанные на TypeScript.
 *
 * Здесь только оркестрация: создать по аккаунту и книге на каждый
 * parallel-слот, положить состояние в `E2E_FIXTURE_STATE` для worker-фикстуры
 * и `E2E_RUN_ID` для `generateTestUser`.
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

  const raw = execFileSync('docker', ['exec', FIXTURE_CONTAINER, 'cat', FIXTURE_STATE_PATH], {
    encoding: 'utf-8',
  });
  const state = JSON.parse(raw) as {
    run_id: string;
    database: string;
    workers: Array<{ book: { chapters: number } | null }>;
  };

  process.env.E2E_RUN_ID = state.run_id;
  // Кэш сессий от прошлых прогонов не переиспользуем: аккаунты у каждого
  // прогона свои, а чужой файл дал бы 401 в середине матрицы.
  fs.rmSync(AUTH_STATE_DIR, { recursive: true, force: true });
  process.env.E2E_FIXTURE_STATE = raw;

  // Прогрев dev-сервера. Vite компилирует маршруты по требованию, и первый
  // вход занимает десятки секунд — на четырёх воркерах это съедало таймаут
  // теста ещё в worker-фикстуре («page.waitForURL: Test ended»).
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:5173';
  const browser = await chromium.launch();
  const warmup = await browser.newPage({ baseURL });
  for (const route of ['/login', '/register', '/library']) {
    await warmup.goto(route, { waitUntil: 'networkidle' }).catch(() => undefined);
  }
  await browser.close();

  const withBooks = state.workers.filter((w) => w.book).length;
  console.log(
    `[e2e fixture] db=${state.database} run=${state.run_id} ` +
      `workers=${state.workers.length} с книгой=${withBooks}`
  );
  for (const line of output.split('\n').filter((l) => /^(worker|WARN)/.test(l))) {
    console.log(`[e2e fixture]   ${line}`);
  }
}

export default globalSetup;
