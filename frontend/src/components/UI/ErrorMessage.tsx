import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface ErrorMessageProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
  variant?: 'default' | 'compact';
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({
  title,
  message,
  onRetry,
  action,
  className,
  variant = 'default'
}) => {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t('ui.error.title');
  if (variant === 'compact') {
    return (
      <div className={cn(
        'flex items-center space-x-2 p-3 text-[var(--color-error)] bg-[var(--color-error-muted)] rounded-md',
        className
      )}>
        <AlertCircle size={18} />
        <span className="text-sm">{message}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="ml-auto text-[var(--color-error)] hover:text-[var(--color-error)]/80"
          >
            <RefreshCw size={16} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn(
      'flex flex-col items-center justify-center p-8 text-center',
      className
    )}>
      <div className="flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-[var(--color-error-muted)]">
        <AlertCircle className="w-8 h-8 text-[var(--color-error)]" />
      </div>
      
      <h3 className="mb-2 text-lg font-semibold text-foreground">
        {resolvedTitle}
      </h3>

      <p className="mb-6 text-muted-foreground max-w-md">
        {message}
      </p>
      
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center space-x-2 px-4 py-2 text-destructive-foreground bg-destructive rounded-lg hover:bg-destructive/90 focus:outline-hidden focus:ring-2 focus:ring-destructive focus:ring-offset-2 transition-colors"
        >
          <RefreshCw size={16} />
          <span>{t('ui.error.retry')}</span>
        </button>
      )}
      
      {action && (
        <button
          onClick={action.onClick}
          className="flex items-center space-x-2 px-4 py-2 text-[var(--color-error)] bg-[var(--color-bg-base)] border border-[var(--color-error)]/30 rounded-lg hover:bg-[var(--color-error-muted)] focus:outline-hidden focus:ring-2 focus:ring-destructive focus:ring-offset-2 transition-colors"
        >
          <span>{action.label}</span>
        </button>
      )}
    </div>
  );
};

export default ErrorMessage;