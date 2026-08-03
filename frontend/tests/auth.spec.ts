// @ts-nocheck - E2E tests have different type strictness requirements
/**
 * Authentication E2E Tests
 *
 * Tests cover:
 * 1. User registration flow
 * 2. User login flow
 * 3. Token refresh
 * 4. Logout flow
 * 5. Protected route access
 */

import { test, expect } from './fixtures/worker-user';
import { LoginPage, RegisterPage, LibraryPage } from './pages';
import { generateTestUser } from './fixtures';

// Чистый контекст объявляется точечно — только там, где проверяется сам
// вход или его отсутствие. `POST /auth/login` ограничен десятью запросами
// в минуту на IP, и файловый opt-out заставлял логиниться каждый тест:
// вместе с четырьмя входами фикстуры лимит выбирался до конца прогона.

test.describe('Authentication', () => {
  // Регистрация ограничена пресетом `registration` — 2 запроса в минуту
  // на IP (`rate_limit.py:296`), а ключ у лимитера общий на все воркеры.
  // Три параллельные регистрации гарантированно ловят 429, поэтому блок
  // идёт последовательно и с выдержкой между попытками.
  test.describe.configure({ mode: 'serial' });

  test.describe('User Registration', () => {
    test.use({ storageState: undefined });

    test('should successfully register a new user', async ({ page }) => {
      const registerPage = new RegisterPage(page);
      const newUser = generateTestUser('e2e-register');

      // Navigate to registration page
      await registerPage.navigate();
      expect(page.url()).toContain('/register');

      // Fill registration form
      await registerPage.register(newUser);

      // Успех регистрации — это вход в приложение под новым аккаунтом.
      // Тост «Регистрация успешна!» самоуничтожается и к моменту проверки
      // его уже нет; проверять текст перевода вместо поведения — пусто.
      expect(await registerPage.isSuccessVisible()).toBe(true);
      await expect(page.locator('[data-testid="user-menu-trigger"]')).toBeVisible({
        timeout: 15000,
      });
    });

    test('should show error for duplicate email', async ({ page, testUser }) => {
      const registerPage = new RegisterPage(page);

      // Try to register with existing user email
      await registerPage.navigate();
      await registerPage.register(testUser);

      // Verify error
      await page.waitForSelector('[data-testid="register-error"]', { timeout: 10000 });
      const errorMessage = await registerPage.getErrorMessage();
      expect(errorMessage).toMatch(/уже существует|already exists|already registered/i);
    });

    test('should show validation error for weak password', async ({ page }) => {
      const registerPage = new RegisterPage(page);
      const weakUser = generateTestUser('weak');
      weakUser.password = '123'; // Weak password

      await registerPage.navigate();
      await registerPage.register(weakUser);

      // Verify validation error
      const errorMessage = await registerPage.getErrorMessage();
      expect(errorMessage).toBeTruthy();
    });

    test('should show error for password mismatch', async ({ page }) => {
      const registerPage = new RegisterPage(page);

      await registerPage.navigate();

      // Fill form with mismatched passwords
      // Полей username/firstName/lastName в форме нет — есть одно fullName.
      await page.fill('[data-testid="register-fullname"]', 'Test User');
      await page.fill('[data-testid="register-email"]', 'mismatch@example.com');
      await page.fill('[data-testid="register-password"]', 'MismatchPass!x9');
      await page.fill('[data-testid="register-confirm-password"]', 'OtherPass!x9zz');
      // input — sr-only, клик по нему состояние не меняет; кликаем обёртку-label.
      await page
        .locator('[data-testid="register-terms"]')
        .locator('xpath=ancestor::label[1]')
        .click();
      await page.click('[data-testid="register-submit"]');

      // Verify error
      const isErrorVisible = await page.isVisible('[data-testid="register-error"]');
      expect(isErrorVisible).toBe(true);
    });
  });

  test.describe('User Login', () => {
    test.use({ storageState: undefined });

    test('should successfully login with valid credentials', async ({ page, testUser }) => {
      const loginPage = new LoginPage(page);
      const _libraryPage = new LibraryPage(page);

      // Navigate to login page
      await loginPage.navigate();
      expect(page.url()).toContain('/login');

      // Login with valid credentials
      await loginPage.login(testUser.email, testUser.password);

      // Verify redirect to library
      await page.waitForURL('/library');
      expect(page.url()).toContain('/library');

      // isVisible() не ждёт: сразу после смены URL меню ещё не смонтировано.
      await expect(page.locator('[data-testid="user-menu-trigger"]')).toBeVisible({
        timeout: 15000,
      });
    });

    test('should show error for invalid credentials', async ({ page }) => {
      const loginPage = new LoginPage(page);

      await loginPage.navigate();
      await loginPage.login('invalid@example.com', 'WrongPassword123!');

      // Verify error message
      await page.waitForSelector('[data-testid="login-error"]', { timeout: 5000 });
      const errorMessage = await loginPage.getErrorMessage();
      expect(errorMessage).toBeTruthy();
    });

    test('should show validation error for empty fields', async ({ page }) => {
      const loginPage = new LoginPage(page);

      await loginPage.navigate();
      await page.click('[data-testid="login-submit"]');

      // Verify form validation
      const emailInput = page.locator('[data-testid="login-email"]');
      const isInvalid = await emailInput.evaluate((el) => {
        return (el as HTMLInputElement).validationMessage !== '';
      });
      expect(isInvalid).toBe(true);
    });
  });

  test.describe('Token Refresh', () => {
    test('should keep the session across a page reload', async ({ page, context }) => {
      await page.goto('/library');
      await expect(page.locator('[data-testid="user-menu-trigger"]')).toBeVisible({
        timeout: 30000,
      });

      // Токены живут в HttpOnly-cookie — это и есть защита от XSS.
      // Прежний тест читал `localStorage.auth_token`, которого в приложении
      // нет и не было, поэтому падал всегда.
      const access = (await context.cookies()).find((c) => c.name === 'access_token');
      expect(access, 'access_token должен лежать в cookie').toBeTruthy();
      expect(access.httpOnly).toBe(true);

      await page.reload();
      await expect(page.locator('[data-testid="user-menu-trigger"]')).toBeVisible({
        timeout: 30000,
      });
    });

    test('should silently refresh when the access token is gone', async ({ page, context }) => {
      await page.goto('/library');
      await expect(page.locator('[data-testid="user-menu-trigger"]')).toBeVisible({
        timeout: 30000,
      });
      const before = (await context.cookies()).find((c) => c.name === 'access_token');
      expect(before).toBeTruthy();

      // Убираем ТОЛЬКО access-токен: refresh-cookie остаётся, и приложение
      // обязано обменять её на новый access, а не разлогинивать. Ровно этот
      // сценарий ловил дефект `client.ts`, где под запрет обновления попадал
      // и защищённый `/auth/me`.
      const kept = (await context.cookies()).filter((c) => c.name !== 'access_token');
      await context.clearCookies();
      await context.addCookies(kept);

      const refreshed = page.waitForResponse(
        (r) => r.url().includes('/auth/refresh') && r.request().method() === 'POST',
        { timeout: 30000 }
      );
      await page.goto('/library');
      expect((await refreshed).ok()).toBe(true);

      await expect(page.locator('[data-testid="user-menu-trigger"]')).toBeVisible({
        timeout: 30000,
      });
      const after = (await context.cookies()).find((c) => c.name === 'access_token');
      expect(after, 'обмен обязан выдать новый access_token').toBeTruthy();
      expect(after.value).not.toBe(before.value);
    });
  });

  test.describe('Logout', () => {
    // Выход заносит токен в blacklist на сервере. Общий `storageState`
    // слота выдал бы один и тот же токен всем тестам, и первый же logout
    // обрушил бы сессию остальным — этим тестам нужен свой вход.
    test.use({ storageState: undefined });

    test('should successfully logout', async ({ page, testUser }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();
      await loginPage.login(testUser.email, testUser.password);
      await page.waitForURL('/library');

      // Open user menu and logout
      await page.click('[data-testid="user-menu-trigger"]');
      await page.click('[data-testid="logout-button"]');

      // Verify redirect to login
      await page.waitForURL('/login', { timeout: 5000 });
      expect(page.url()).toContain('/login');

      // Verify token is cleared
      const token = await page.evaluate(() => localStorage.getItem('auth_token'));
      expect(token).toBeFalsy();
    });

    test('should not access protected routes after logout', async ({ page, testUser }) => {
      const loginPage = new LoginPage(page);
      await loginPage.navigate();
      await loginPage.login(testUser.email, testUser.password);
      await page.waitForURL('/library');

      await page.click('[data-testid="user-menu-trigger"]');
      await page.click('[data-testid="logout-button"]');
      await page.waitForURL('/login', { timeout: 5000 });

      // Try to access library
      await page.goto('/library');

      // Should redirect to login
      await page.waitForTimeout(1000);
      expect(page.url()).toContain('/login');
    });
  });

  test.describe('Protected Route Access', () => {
    test.describe('without a session', () => {
      // Эти два теста проверяют отсутствие доступа, поэтому им нужен
      // контекст без сессии слота — иначе приложение законно остаётся
      // на /library и редиректа не происходит.
      test.use({ storageState: undefined });

      test('should redirect to login when accessing protected route without auth', async ({
        page,
      }) => {
        // Try to access library without login
        await page.goto('/library');

        // Should redirect to login
        await page.waitForURL('/login', { timeout: 15000 });
        expect(page.url()).toContain('/login');
      });

      test('should redirect to login when accessing reader without auth', async ({ page }) => {
        const bookId = '123e4567-e89b-12d3-a456-426614174000';

        await page.goto(`/book/${bookId}/read`);

        await page.waitForURL('/login', { timeout: 15000 });
        expect(page.url()).toContain('/login');
      });
    });

    // Перенесено из удалённой auth-journey.spec.ts — единственный её случай,
    // которого не было здесь. Остальные одиннадцать дублировали этот файл.
    test('should redirect to login when the session expires', async ({ page, context, testUser }) => {
      const loginPage = new LoginPage(page);

      await loginPage.navigate();
      await loginPage.login(testUser.email, testUser.password);
      await page.waitForURL('/library');

      // Токены живут в HttpOnly-cookie, поэтому «истечение сессии» — это
      // сброс cookie, а не очистка localStorage.
      await context.clearCookies();

      await page.goto('/library');
      await page.waitForURL('/login', { timeout: 10000 });
      expect(page.url()).toContain('/login');
    });

    test('should allow access to protected routes when authenticated', async ({ page }) => {
      // Сессия слота уже в контексте — повторный вход только жёг бы квоту.
      await page.goto('/library');
      await page.waitForTimeout(1000);
      expect(page.url()).toContain('/library');

      // Verify authenticated
      const isAuthenticated = await page.isVisible('[data-testid="user-menu-trigger"]');
      expect(isAuthenticated).toBe(true);
    });
  });
});
