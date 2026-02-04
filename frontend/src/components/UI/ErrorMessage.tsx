import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';

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
        'flex items-center space-x-2 p-3 text-red-600 bg-red-50 rounded-md dark:bg-red-900/20 dark:text-red-400',
        className
      )}>
        <AlertCircle size={18} />
        <span className="text-sm">{message}</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="ml-auto text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
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
      <div className="flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-red-100 dark:bg-red-900/30">
        <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
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
          className="flex items-center space-x-2 px-4 py-2 text-destructive-foreground bg-red-600 rounded-lg hover:bg-red-700 focus:outline-hidden focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors"
        >
          <RefreshCw size={16} />
          <span>{t('ui.error.retry')}</span>
        </button>
      )}
      
      {action && (
        <button
          onClick={action.onClick}
          className="flex items-center space-x-2 px-4 py-2 text-red-600 bg-white border border-red-300 rounded-lg hover:bg-red-50 focus:outline-hidden focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors dark:bg-card dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/10"
        >
          <span>{action.label}</span>
        </button>
      )}
    </div>
  );
};

export default ErrorMessage;