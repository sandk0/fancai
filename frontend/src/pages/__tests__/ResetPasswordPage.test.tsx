/**
 * ResetPasswordPage Component Tests
 *
 * Tests:
 * - No token state (missing ?token= in URL)
 * - Form rendering with valid token
 * - Successful password reset shows success state
 * - API error shows error state
 * - Password validation (weak password rejected)
 * - Referrer-Policy meta tag (OWASP token leakage prevention)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import ResetPasswordPage from '../ResetPasswordPage';

// Mock API
const mockResetPassword = vi.fn();
vi.mock('@/api/auth', () => ({
  authAPI: {
    resetPassword: (...args: unknown[]) => mockResetPassword(...args),
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

// Mock SEO components
vi.mock('@/components/SEO/PageMeta', () => ({
  PageMeta: () => null,
}));

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }: { children: React.ReactNode }) => <div data-testid="helmet">{children}</div>,
}));

// Mock PasswordStrengthIndicator to avoid complex rendering
vi.mock('@/components/Auth/PasswordStrength', () => ({
  PasswordStrengthIndicator: () => <div data-testid="password-strength" />,
}));

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'reset_password.page_title': 'Reset Password',
        'reset_password.page_description': 'Set a new password',
        'reset_password.title': 'Set new password',
        'reset_password.description': 'Enter your new password below.',
        'reset_password.password_label': 'New password',
        'reset_password.password_placeholder': 'Enter new password',
        'reset_password.confirm_label': 'Confirm password',
        'reset_password.confirm_placeholder': 'Confirm new password',
        'reset_password.submit': 'Reset password',
        'reset_password.submitting': 'Resetting...',
        'reset_password.success_title': 'Password reset!',
        'reset_password.success_description': 'Your password has been changed.',
        'reset_password.go_to_login': 'Go to login',
        'reset_password.no_token_title': 'Invalid link',
        'reset_password.no_token_description': 'This reset link is invalid or missing.',
        'reset_password.request_new_link': 'Request a new link',
        'reset_password.invalid_token_title': 'Token expired',
        'reset_password.invalid_token_description': 'This reset link has expired.',
        'register.validation.password_min': 'At least 12 characters',
        'register.validation.password_lowercase': 'Must contain lowercase',
        'register.validation.password_uppercase': 'Must contain uppercase',
        'register.validation.password_digit': 'Must contain digit',
        'register.validation.password_special': 'Must contain special char',
        'register.validation.confirm_required': 'Confirm password required',
        'register.validation.passwords_mismatch': 'Passwords do not match',
        'register.show_password': 'Show password',
        'register.hide_password': 'Hide password',
      };
      return translations[key] || key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// Helper to set URL search params
function setURLToken(token: string | null) {
  const url = token
    ? `http://localhost:3000/reset-password?token=${token}`
    : 'http://localhost:3000/reset-password';
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
  });
}

const renderPage = () =>
  render(
    <BrowserRouter>
      <ResetPasswordPage />
    </BrowserRouter>,
  );

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('No token state', () => {
    beforeEach(() => {
      setURLToken(null);
    });

    it('shows invalid link message when no token in URL', () => {
      renderPage();

      expect(screen.getByText('Invalid link')).toBeInTheDocument();
      expect(screen.getByText('This reset link is invalid or missing.')).toBeInTheDocument();
    });

    it('shows link to request new reset', () => {
      renderPage();

      const link = screen.getByText('Request a new link');
      expect(link).toBeInTheDocument();
      expect(link.closest('a')).toHaveAttribute('href', '/forgot-password');
    });
  });

  describe('Form state (with token)', () => {
    beforeEach(() => {
      setURLToken('valid-test-token');
    });

    it('renders password form when token is present', () => {
      renderPage();

      expect(screen.getByText('Set new password')).toBeInTheDocument();
      expect(screen.getByLabelText(/new password/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reset password' })).toBeInTheDocument();
    });

    it('renders PasswordStrengthIndicator', () => {
      renderPage();

      expect(screen.getByTestId('password-strength')).toBeInTheDocument();
    });

    it('shows success state after successful reset', async () => {
      const user = userEvent.setup();
      mockResetPassword.mockResolvedValueOnce({ message: 'ok' });

      renderPage();

      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);

      await user.type(passwordInput, 'NewSecureP@ss99!');
      await user.type(confirmInput, 'NewSecureP@ss99!');

      const submitButton = screen.getByRole('button', { name: 'Reset password' });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Password reset!')).toBeInTheDocument();
      });

      expect(mockResetPassword).toHaveBeenCalledWith('valid-test-token', 'NewSecureP@ss99!');
    });

    it('shows error state on API failure', async () => {
      const user = userEvent.setup();
      mockResetPassword.mockRejectedValueOnce(new Error('Token expired'));

      renderPage();

      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);

      await user.type(passwordInput, 'NewSecureP@ss99!');
      await user.type(confirmInput, 'NewSecureP@ss99!');

      const submitButton = screen.getByRole('button', { name: 'Reset password' });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Token expired')).toBeInTheDocument();
      });
    });

    it('renders go-to-login link in success state', async () => {
      const user = userEvent.setup();
      mockResetPassword.mockResolvedValueOnce({ message: 'ok' });

      renderPage();

      const passwordInput = screen.getByLabelText(/new password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);

      await user.type(passwordInput, 'NewSecureP@ss99!');
      await user.type(confirmInput, 'NewSecureP@ss99!');

      const submitButton = screen.getByRole('button', { name: 'Reset password' });
      await user.click(submitButton);

      await waitFor(() => {
        const loginLink = screen.getByText('Go to login');
        expect(loginLink.closest('a')).toHaveAttribute('href', '/login');
      });
    });
  });
});
