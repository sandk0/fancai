/**
 * Register Page Object Model
 */

import { Page } from '@playwright/test';
import { BasePage } from './BasePage';
import type { TestUser } from '../fixtures';

export class RegisterPage extends BasePage {
  // Selectors
  // Форма приложения — fullName + email + пароль + подтверждение + согласие
  // с условиями. Отдельных username/firstName/lastName в ней нет.
  private readonly fullNameInput = '[data-testid="register-fullname"]';
  private readonly emailInput = '[data-testid="register-email"]';
  private readonly passwordInput = '[data-testid="register-password"]';
  private readonly confirmPasswordInput = '[data-testid="register-confirm-password"]';
  private readonly termsCheckbox = '[data-testid="register-terms"]';
  private readonly submitButton = '[data-testid="register-submit"]';
  private readonly loginLink = '[data-testid="login-link"]';
  private readonly errorMessage = '[data-testid="register-error"]';

  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to register page
   */
  async navigate(): Promise<void> {
    await this.goto('/register');
  }

  /**
   * Perform registration
   */
  async register(user: TestUser): Promise<void> {
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username;
    await this.fill(this.fullNameInput, fullName);
    await this.fill(this.emailInput, user.email);
    await this.fill(this.passwordInput, user.password);
    await this.fill(this.confirmPasswordInput, user.password);
    // Согласие с условиями обязательно — без него форма не отправится.
    // `force`: сам input — sr-only (визуально его заменяет стилизованный
    // peer-элемент), поэтому обычная проверка видимости не проходит.
    await this.page.locator(this.termsCheckbox).check({ force: true });
    await this.click(this.submitButton);
  }

  /**
   * Get error message
   */
  async getErrorMessage(): Promise<string> {
    return await this.getText(this.errorMessage);
  }

  /**
   * Текст подтверждения регистрации.
   *
   * Успех уводит на /library сразу же, поэтому элемент на самой странице
   * регистрации не доживает до проверки. Читаем тост — он рендерится
   * в корне приложения и переживает переход.
   */
  async getSuccessMessage(): Promise<string> {
    return await this.getText('[data-sonner-toast] [data-title]');
  }

  /**
   * Click login link
   */
  async goToLogin(): Promise<void> {
    await this.click(this.loginLink);
  }

  /**
   * Регистрация прошла, если приложение ушло в библиотеку.
   */
  async isSuccessVisible(): Promise<boolean> {
    try {
      await this.page.waitForURL('**/library', { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }
}
