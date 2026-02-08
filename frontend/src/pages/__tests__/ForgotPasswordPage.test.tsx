/**
 * ForgotPasswordPage Component Tests
 *
 * Tests:
 * - Form rendering (email input, submit button, back-to-login link)
 * - Form validation (invalid email)
 * - Successful submission shows success state
 * - API error shows toast notification
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import ForgotPasswordPage from '../ForgotPasswordPage';

// Mock API
const mockRequestPasswordReset = vi.fn();
vi.mock('@/api/auth', () => ({
  authAPI: {
    requestPasswordReset: (...args: unknown[]) => mockRequestPasswordReset(...args),
  },
}));

// Mock toast notifications
const mockNotifyError = vi.fn();
vi.mock('@/stores/ui', () => ({
  notify: {
    success: vi.fn(),
    error: (...args: unknown[]) => mockNotifyError(...args),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Mock SEO component
vi.mock('@/components/SEO/PageMeta', () => ({
  PageMeta: () => null,
}));

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'forgot_password.page_title': 'Forgot Password',
        'forgot_password.page_description': 'Reset your password',
        'forgot_password.title': 'Forgot password?',
        'forgot_password.description': 'Enter your email to receive a reset link.',
        'forgot_password.email_label': 'Email',
        'forgot_password.submit': 'Send reset link',
        'forgot_password.submitting': 'Sending...',
        'forgot_password.success_title': 'Check your email',
        'forgot_password.success_description': 'If an account exists, we sent a reset link.',
        'forgot_password.back_to_login': 'Back to login',
        'login.validation.email_invalid': 'Invalid email address',
      };
      return translations[key] || key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const renderPage = () =>
  render(
    <BrowserRouter>
      <ForgotPasswordPage />
    </BrowserRouter>,
  );

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form with email input and submit button', () => {
    renderPage();

    expect(screen.getByText('Forgot password?')).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument();
  });

  it('renders back to login link', () => {
    renderPage();

    const link = screen.getByText('Back to login');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/login');
  });

  it('shows success state after successful submission', async () => {
    const user = userEvent.setup();
    mockRequestPasswordReset.mockResolvedValueOnce({ message: 'ok' });

    renderPage();

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'test@example.com');

    const submitButton = screen.getByRole('button', { name: 'Send reset link' });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Check your email')).toBeInTheDocument();
    });

    expect(mockRequestPasswordReset).toHaveBeenCalledWith('test@example.com');
  });

  it('shows error toast on API failure', async () => {
    const user = userEvent.setup();
    mockRequestPasswordReset.mockRejectedValueOnce(new Error('Network error'));

    renderPage();

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'test@example.com');

    const submitButton = screen.getByRole('button', { name: 'Send reset link' });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockNotifyError).toHaveBeenCalled();
    });
  });

  it('validates email format before submission', async () => {
    const user = userEvent.setup();

    renderPage();

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'not-an-email');

    const submitButton = screen.getByRole('button', { name: 'Send reset link' });
    await user.click(submitButton);

    // Should NOT call API with invalid email
    await waitFor(() => {
      expect(mockRequestPasswordReset).not.toHaveBeenCalled();
    });
  });
});
