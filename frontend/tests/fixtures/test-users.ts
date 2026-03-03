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
    password: 'TestPassword123!',
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

  newUser: {
    email: `test.${Date.now()}@fancai.ru`,
    username: `testuser${Date.now()}`,
    password: 'NewUserPass123!',
    firstName: 'New',
    lastName: 'User',
  } as TestUser,
};

/**
 * Generate a unique test user
 */
export function generateTestUser(prefix = 'testuser'): TestUser {
  const timestamp = Date.now();
  return {
    email: `${prefix}.${timestamp}@fancai.ru`,
    username: `${prefix}${timestamp}`,
    password: 'TestPassword123!',
    firstName: 'Test',
    lastName: 'User',
  };
}
