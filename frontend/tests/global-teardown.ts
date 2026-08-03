import fs from 'node:fs';
import { runFixture } from './global-setup';
import { AUTH_STATE_DIR } from './fixtures/worker-user';

/**
 * Откат фикстуры. Падение уборки обязано красить прогон: незамеченный мусор
 * в dev-БД дороже красного прогона, потому что следующая сессия построит
 * на нём выводы.
 */
async function globalTeardown(): Promise<void> {
  fs.rmSync(AUTH_STATE_DIR, { recursive: true, force: true });

  let output: string;
  try {
    output = runFixture(['teardown']);
  } catch (error) {
    const err = error as { stdout?: Buffer | string; stderr?: Buffer | string };
    console.error('[e2e fixture] TEARDOWN FAILED');
    console.error(String(err.stdout ?? ''));
    console.error(String(err.stderr ?? ''));
    throw new Error(
      'Уборка e2e-фикстуры не прошла: dev-БД осталась изменённой. ' +
        'Разобрать вручную по выводу выше.'
    );
  }

  console.log(
    '[e2e fixture] ' +
      output
        .split('\n')
        .filter((line) => /^(account|book|user|image|file|teardown)/.test(line))
        .join('\n[e2e fixture] ')
  );
}

export default globalTeardown;
