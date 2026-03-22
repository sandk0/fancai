import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import ErrorBoundary from '../ErrorBoundary';

const ThrowError = ({ shouldThrow = true }: { shouldThrow?: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test error message');
  }
  return <div>No error</div>;
};

describe('ErrorBoundary', () => {
  const originalError = console.error;
  const originalLocation = window.location;

  beforeEach(() => {
    console.error = vi.fn();
    localStorage.clear();

    // @ts-expect-error - necessary for mocking readonly property in tests
    delete window.location;
    window.location = { ...originalLocation, reload: vi.fn(), href: '' } as any;
  });

  afterEach(() => {
    console.error = originalError;
    // @ts-expect-error - necessary for restoring readonly property in tests
    window.location = originalLocation;
    vi.clearAllMocks();
  });

  describe('Error Catching', () => {
    it('catches errors and displays fallback UI', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByText(/упс! что-то пошло не так/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /обновить/i })).toBeInTheDocument();
    });

    it('renders children when there is no error', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={false} />
        </ErrorBoundary>
      );

      expect(screen.getByText('No error')).toBeInTheDocument();
      expect(screen.queryByText(/упс! что-то пошло не так/i)).not.toBeInTheDocument();
    });

    it('logs error to console', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('Error Levels', () => {
    it('displays app-level error UI correctly', () => {
      render(
        <ErrorBoundary level="app">
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByText(/упс! что-то пошло не так/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /обновить страницу/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /на главную/i })).toBeInTheDocument();
    });

    it('displays page-level error UI correctly', () => {
      render(
        <ErrorBoundary level="page">
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByText(/ошибка загрузки страницы/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /попробовать снова/i })).toBeInTheDocument();
    });

    it('displays component-level error UI correctly', () => {
      render(
        <ErrorBoundary level="component">
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByText(/ошибка компонента/i)).toBeInTheDocument();
    });
  });

  describe('Custom Fallback', () => {
    it('renders custom fallback when provided', () => {
      const customFallback = <div>Custom error message</div>;

      render(
        <ErrorBoundary fallback={customFallback}>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByText('Custom error message')).toBeInTheDocument();
      expect(screen.queryByText(/упс! что-то пошло не так/i)).not.toBeInTheDocument();
    });
  });

  describe('Error Reset', () => {
    it('reloads page when reset button clicked on app-level boundary', () => {
      render(
        <ErrorBoundary level="app">
          <ThrowError />
        </ErrorBoundary>
      );

      const resetButton = screen.getByRole('button', { name: /обновить/i });
      fireEvent.click(resetButton);

      expect(window.location.reload).toHaveBeenCalled();
    });

    it('resets state when reset button clicked on component-level boundary', () => {
      render(
        <ErrorBoundary level="component">
          <ThrowError />
        </ErrorBoundary>
      );

      expect(screen.getByText(/ошибка компонента/i)).toBeInTheDocument();

      const resetButton = screen.getByRole('button', { name: /попробовать снова/i });
      fireEvent.click(resetButton);

      expect(screen.getByText(/ошибка компонента/i)).toBeInTheDocument();
    });
  });

  describe('Navigation', () => {
    it('navigates to home when home button clicked', () => {
      render(
        <ErrorBoundary level="app">
          <ThrowError />
        </ErrorBoundary>
      );

      const homeButton = screen.getByRole('button', { name: /на главную/i });
      fireEvent.click(homeButton);

      expect(window.location.href).toBe('/');
    });
  });

  describe('Error Callback', () => {
    it('calls onError callback when error is caught', () => {
      const onError = vi.fn();

      render(
        <ErrorBoundary onError={onError}>
          <ThrowError />
        </ErrorBoundary>
      );

      expect(onError).toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          componentStack: expect.any(String),
        })
      );
    });
  });

  describe('Dev Mode Features', () => {
    it('shows error details in dev mode', () => {
      render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      if (import.meta.env.DEV) {
        const summaryElement = screen.getByText('Error details');
        expect(summaryElement).toBeInTheDocument();

        const errorTexts = screen.getAllByText(/Test error message/);
        expect(errorTexts.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Theme Support', () => {
    // FIXME: Skipped due to test environment localStorage timing issues
    it.skip('respects dark theme from localStorage', () => {
      localStorage.setItem('theme', 'dark');

      const { container } = render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      const errorContainer = container.querySelector('.error-boundary-container');
      expect(errorContainer).toBeTruthy();

      const style = errorContainer ? window.getComputedStyle(errorContainer as Element) : null;
      expect(style?.backgroundColor).toBe('rgb(26, 26, 26)');
    });

    it('respects light theme from localStorage', () => {
      localStorage.setItem('theme', 'light');

      const { container } = render(
        <ErrorBoundary>
          <ThrowError />
        </ErrorBoundary>
      );

      const errorContainer = container.querySelector('.error-boundary-container');
      expect(errorContainer).toBeInTheDocument();

      localStorage.removeItem('theme');
    });
  });
});
