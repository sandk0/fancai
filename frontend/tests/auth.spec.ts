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

import { test, expect } from '@playwright/test';
import { LoginPage, RegisterPage, LibraryPage } from './pages';
import { generateTestUser, testUsers } from './fixtures';

test.describe('Authentication', () => {
  test.describe('User Registration', () => {
    test('should successfully register a new user', async ({ page }) => {
      const registerPage = new RegisterPage(page);
      const newUser = generateTestUser('e2e-register');

      // Navigate to registration page
      await registerPage.navigate();
      expect(page.url()).toContain('/register');

      // Fill registration form
      await registerPage.register(newUser);

      // Verify success message
      const isSuccess = await registerPage.isSuccessVisible();
      expect(isSuccess).toBe(true);

      const successMessage = await registerPage.getSuccessMessage();
      expect(successMessage).toContain('успешно');
    });

    test('should show error for duplicate email', async ({ page }) => {
      const registerPage = new RegisterPage(page);

      // Try to register with existing user email
      await registerPage.navigate();
      await registerPage.register(testUsers.regular);

      // Verify error message
      await page.waitForSelector('[data-testid="register-error"]', { timeout: 5000 });
      const errorMessage = await registerPage.getErrorMessage();
      expect(errorMessage).toContain('уже существует' || 'already exists');
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
      await page.fill('[data-testid="register-email"]', 'test@example.com');
      await page.fill('[data-testid="register-password"]', 'Password123!');
      await page.fill('[data-testid="register-confirm-password"]', 'DifferentPass123!');
      await page.locator('[data-testid="register-terms"]').check({ force: true });
      await page.click('[data-testid="register-submit"]');

      // Verify error
      const isErrorVisible = await page.isVisible('[data-testid="register-error"]');
      expect(isErrorVisible).toBe(true);
    });
  });

  test.describe('User Login', () => {
    test('should successfully login with valid credentials', async ({ page }) => {
      const loginPage = new LoginPage(page);
      const _libraryPage = new LibraryPage(page);

      // Navigate to login page
      await loginPage.navigate();
      expect(page.url()).toContain('/login');

      // Login with valid credentials
      await loginPage.login(testUsers.regular.email, testUsers.regular.password);

      // Verify redirect to library
      await page.waitForURL('/library', { timeout: 10000 });
      expect(page.url()).toContain('/library');

      // Verify user is logged in (user menu visible)
      const isUserMenuVisible = await page.isVisible('[data-testid="user-menu-trigger"]');
      expect(isUserMenuVisible).toBe(true);
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
    test('should refresh token on page reload', async ({ page }) => {
      const loginPage = new LoginPage(page);

      // Login first
      await loginPage.navigate();
      await loginPage.login(testUsers.regular.email, testUsers.regular.password);
      await page.waitForURL('/library', { timeout: 10000 });

      // Get initial token
      const initialToken = await page.evaluate(() => localStorage.getItem('auth_token'));
      expect(initialToken).toBeTruthy();

      // Reload page
      await page.reload();
      await page.waitForTimeout(1000);

      // Verify still authenticated
      const isStillLoggedIn = await page.isVisible('[data-testid="user-menu-trigger"]');
      expect(isStillLoggedIn).toBe(true);

      // Token should still exist (may be same or refreshed)
      const currentToken = await page.evaluate(() => localStorage.getItem('auth_token'));
      expect(currentToken).toBeTruthy();
    });
  });

  test.describe('Logout', () => {
    test('should successfully logout', async ({ page }) => {
      const loginPage = new LoginPage(page);

      // Login first
      await loginPage.navigate();
      await loginPage.login(testUsers.regular.email, testUsers.regular.password);
      await page.waitForURL('/library', { timeout: 10000 });

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

    test('should not access protected routes after logout', async ({ page }) => {
      const loginPage = new LoginPage(page);

      // Login and logout
      await loginPage.navigate();
      await loginPage.login(testUsers.regular.email, testUsers.regular.password);
      await page.waitForURL('/library', { timeout: 10000 });

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
    test('should redirect to login when accessing protected route without auth', async ({ page }) => {
      // Try to access library without login
      await page.goto('/library');

      // Should redirect to login
      await page.waitForURL('/login', { timeout: 5000 });
      expect(page.url()).toContain('/login');
    });

    test('should redirect to login when accessing reader without auth', async ({ page }) => {
      const bookId = '123e4567-e89b-12d3-a456-426614174000';

      // Try to access reader without login
      await page.goto(`/reader/${bookId}`);

      // Should redirect to login
      await page.waitForURL('/login', { timeout: 5000 });
      expect(page.url()).toContain('/login');
    });

    test('should allow access to protected routes when authenticated', async ({ page }) => {
      const loginPage = new LoginPage(page);

      // Login
      await loginPage.navigate();
      await loginPage.login(testUsers.regular.email, testUsers.regular.password);
      await page.waitForURL('/library', { timeout: 10000 });

      // Access library - should stay on library
      await page.goto('/library');
      await page.waitForTimeout(1000);
      expect(page.url()).toContain('/library');

      // Verify authenticated
      const isAuthenticated = await page.isVisible('[data-testid="user-menu-trigger"]');
      expect(isAuthenticated).toBe(true);
    });
  });
});
