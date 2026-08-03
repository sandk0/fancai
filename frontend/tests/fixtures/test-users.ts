/**
 * Test user fixtures for E2E testing
 */

export interface TestUser {
  email: string;
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Test users for different scenarios
 */
export const testUsers = {
  regular: {
    email: 'test.user@fancai.ru',
    username: 'testuser',
    password: 'E2eFixture!Pw7',
    firstName: 'Test',
    lastName: 'User',
  } as TestUser,

  premium: {
    email: 'premium.user@fancai.ru',
    username: 'premiumuser',
    password: 'PremiumPass123!',
    firstName: 'Premium',
    lastName: 'User',
  } as TestUser,

  /**
   * Аккаунт, который регистрируют сами тесты. Живёт в пространстве имён
   * прогона, поэтому globalTeardown узнаёт его по имени и удаляет по ID.
   */
  get newUser(): TestUser {
    return generateTestUser('new');
  },
};

/**
 * Generate a unique test user inside the current run namespace.
 *
 * Пространство имён прогона — `e2e-run-<E2E_RUN_ID>.`; переменную выставляет
 * globalSetup. Всё, что тесты регистрируют через UI, обязано попасть сюда:
 * по этому префиксу `backend/scripts/e2e_fixture.py teardown` находит свои
 * аккаунты и удаляет их по ID — вместо разности снимков БД, которая снесла
 * бы и параллельную запись владельца.
 */
export function generateTestUser(prefix = 'testuser'): TestUser {
  const runId = process.env.E2E_RUN_ID;
  if (!runId) {
    throw new Error(
      'E2E_RUN_ID не задан. Пользователей можно создавать только внутри ' +
        'пространства имён прогона — иначе globalTeardown не сможет их убрать. ' +
        'Проверьте, что globalSetup отработал.'
    );
  }
  const timestamp = Date.now();
  return {
    email: `e2e-run-${runId}.${prefix}-${timestamp}@fancai.ru`,
    username: `${prefix}${timestamp}`,
    password: 'E2eFixture!Pw7',
    firstName: 'Test',
    lastName: 'User',
  };
}
