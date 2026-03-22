import React from 'react';
import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  size?: 'small' | 'medium' | 'large' | 'sm' | 'lg';
  className?: string;
  color?: 'primary' | 'secondary' | 'white';
  text?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'medium',
  className,
  color = 'primary',
  text,
}) => {
  // Map aliases to main sizes
  const normalizedSize = size === 'sm' ? 'small' : size === 'lg' ? 'large' : size;
  
  const sizeClasses = {
    small: 'w-4 h-4',
    medium: 'w-8 h-8',
    large: 'w-12 h-12',
  };

  const colorClasses = {
    primary: 'border-primary/20 border-t-primary',
    secondary: 'border-muted border-t-muted-foreground',
    white: 'border-foreground/20 border-t-foreground',
  };

  return (
    <div className={cn('flex items-center', text ? 'space-x-3' : '')}>
      <div
        className={cn(
          'animate-spin rounded-full border-2',
          sizeClasses[normalizedSize],
          colorClasses[color],
          className
        )}
        role="status"
        aria-label="Loading"
      >
        <span className="sr-only">Loading...</span>
      </div>
      {text && (
        <span className="text-muted-foreground">{text}</span>
      )}
    </div>
  );
};

export default LoadingSpinner;