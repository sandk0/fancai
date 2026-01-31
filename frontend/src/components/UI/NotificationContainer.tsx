import React, { useEffect, useState, useCallback } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, XCircle, AlertTriangle, Info, Bell } from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/utils/cn';
import type { Notification } from '@/types/state';

/**
 * Toast notification variants
 */
type ToastVariant = 'success' | 'warning' | 'error' | 'info' | 'default';

/**
 * Configuration for each toast variant
 */
interface VariantConfig {
  icon: React.ReactNode;
  containerClasses: string;
  iconClasses: string;
  progressClasses: string;
}

/**
 * Get variant configuration for styling
 */
const getVariantConfig = (variant: ToastVariant): VariantConfig => {
  const configs: Record<ToastVariant, VariantConfig> = {
    success: {
      icon: <CheckCircle className="w-5 h-5" />,
      containerClasses: cn(
        'bg-[var(--color-success-muted)] border-[var(--color-success)]',
        'dark:bg-[var(--color-success-muted)] dark:border-[var(--color-success)]',
        'text-[var(--color-text-default)]'
      ),
      iconClasses: 'text-[var(--color-success)]',
      progressClasses: 'bg-[var(--color-success)]',
    },
    warning: {
      icon: <AlertTriangle className="w-5 h-5" />,
      containerClasses: cn(
        'bg-[var(--color-warning-muted)] border-[var(--color-warning)]',
        'dark:bg-[var(--color-warning-muted)] dark:border-[var(--color-warning)]',
        'text-[var(--color-text-default)]'
      ),
      iconClasses: 'text-[var(--color-warning)]',
      progressClasses: 'bg-[var(--color-warning)]',
    },
    error: {
      icon: <XCircle className="w-5 h-5" />,
      containerClasses: cn(
        'bg-[var(--color-error-muted)] border-[var(--color-error)]',
        'dark:bg-[var(--color-error-muted)] dark:border-[var(--color-error)]',
        'text-[var(--color-text-default)]'
      ),
      iconClasses: 'text-[var(--color-error)]',
      progressClasses: 'bg-[var(--color-error)]',
    },
    info: {
      icon: <Info className="w-5 h-5" />,
      containerClasses: cn(
        'bg-[var(--color-info-muted)] border-[var(--color-info)]',
        'dark:bg-[var(--color-info-muted)] dark:border-[var(--color-info)]',
        'text-[var(--color-text-default)]'
      ),
      iconClasses: 'text-[var(--color-info)]',
      progressClasses: 'bg-[var(--color-info)]',
    },
    default: {
      icon: <Bell className="w-5 h-5" />,
      containerClasses: cn(
        'bg-[var(--color-bg-subtle)] border-[var(--color-border-default)]',
        'text-[var(--color-text-default)]'
      ),
      iconClasses: 'text-[var(--color-text-muted)]',
      progressClasses: 'bg-[var(--color-accent-500)]',
    },
  };

  return configs[variant] || configs.default;
};

/**
 * Animation variants for slide in/out
 */
const toastAnimationVariants = {
  // Desktop: slide from right
  desktop: {
    initial: { opacity: 0, x: 100, scale: 0.95 },
    animate: { opacity: 1, x: 0, scale: 1 },
    exit: { opacity: 0, x: 100, scale: 0.95 },
  },
  // Mobile: slide from top center
  mobile: {
    initial: { opacity: 0, y: -50, scale: 0.95 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -50, scale: 0.95 },
  },
};

/**
 * Progress bar component for auto-dismiss
 */
interface ProgressBarProps {
  duration: number;
  isPaused: boolean;
  variant: ToastVariant;
  onComplete: () => void;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  duration,
  isPaused,
  variant,
  onComplete,
}) => {
  const [progress, setProgress] = useState(100);
  const config = getVariantConfig(variant);

  useEffect(() => {
    if (isPaused || duration === 0) return;

    const startTime = Date.now();
    const remainingTime = (progress / 100) * duration;

    const updateProgress = () => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.max(0, progress - (elapsed / remainingTime) * progress);

      if (newProgress <= 0) {
        setProgress(0);
        onComplete();
      } else {
        setProgress(newProgress);
        requestAnimationFrame(updateProgress);
      }
    };

    const animationId = requestAnimationFrame(updateProgress);
    return () => cancelAnimationFrame(animationId);
  }, [duration, isPaused, onComplete, progress]);

  if (duration === 0) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/10 dark:bg-white/10 overflow-hidden rounded-b-lg">
      <m.div
        className={cn('h-full', config.progressClasses)}
        initial={{ width: '100%' }}
        animate={{ width: `${progress}%` }}
        transition={{ duration: 0.1, ease: 'linear' }}
      />
    </div>
  );
};

/**
 * Single toast notification component
 */
interface ToastProps {
  notification: Notification;
  onDismiss: (id: string) => void;
  showProgressBar?: boolean;
}

const Toast: React.FC<ToastProps> = ({
  notification,
  onDismiss,
  showProgressBar = true,
}) => {
  const [isPaused, setIsPaused] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const variant = (notification.type || 'default') as ToastVariant;
  const config = getVariantConfig(variant);
  const duration = notification.duration || 5000;

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleDismiss = useCallback(() => {
    onDismiss(notification.id);
  }, [notification.id, onDismiss]);

  const animationVariant = isMobile
    ? toastAnimationVariants.mobile
    : toastAnimationVariants.desktop;

  return (
    <m.div
      layout
      initial={animationVariant.initial}
      animate={animationVariant.animate}
      exit={animationVariant.exit}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 30,
        mass: 1,
      }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={() => setIsPaused(true)}
      onTouchEnd={() => setIsPaused(false)}
      className={cn(
        'relative overflow-hidden',
        'p-4 rounded-lg border shadow-lg',
        'backdrop-blur-sm',
        'min-w-0 max-w-[calc(100vw-2rem)] sm:min-w-[280px] sm:max-w-[400px]',
        'transition-shadow duration-200',
        'hover:shadow-xl',
        config.containerClasses
      )}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={cn('flex-shrink-0 mt-0.5', config.iconClasses)}>
          {config.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold leading-tight truncate">
            {notification.title}
          </h4>
          {notification.message && (
            <p className="mt-1 text-sm opacity-80 leading-relaxed line-clamp-2 break-words">
              {notification.message}
            </p>
          )}
          
          {/* Action Button */}
          {notification.action && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                notification.action?.onClick();
                // Don't auto-dismiss if persistent, let action handler decide
              }}
              className={cn(
                'mt-3 px-3 py-1.5 text-xs font-medium rounded-md',
                'bg-black/10 dark:bg-white/10',
                'hover:bg-black/20 dark:hover:bg-white/20',
                'transition-colors duration-200',
                'focus:outline-none focus:ring-2 focus:ring-offset-1',
                'focus:ring-[var(--color-accent-500)]'
              )}
            >
              {notification.action.label}
            </button>
          )}
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={handleDismiss}
          className={cn(
            'flex-shrink-0 p-1 rounded-md',
            'opacity-60 hover:opacity-100',
            'transition-all duration-200',
            'hover:bg-black/10 dark:hover:bg-white/10',
            'focus:outline-none focus:ring-2 focus:ring-offset-2',
            'focus:ring-[var(--color-accent-500)]'
          )}
          aria-label="Close notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Progress bar */}
      {showProgressBar && duration > 0 && (
        <ProgressBar
          duration={duration}
          isPaused={isPaused}
          variant={variant}
          onComplete={handleDismiss}
        />
      )}
    </m.div>
  );
};

/**
 * Main notification container component
 * Renders notifications with responsive positioning:
 * - Desktop: top-right
 * - Mobile: top-center
 */
const NotificationContainer: React.FC = () => {
  const { notifications, removeNotification } = useUIStore();

  return (
    <>
      {/* Desktop container - top-right */}
      <div
        className={cn(
          'fixed z-[800]', // Z_INDEX.toast from lib/zIndex.ts
          // Desktop positioning
          'hidden md:flex',
          'top-4 right-4',
          'flex-col items-end gap-3',
          'max-w-[420px] w-full',
          'pointer-events-none'
        )}
        aria-label="Notifications"
      >
        <AnimatePresence mode="popLayout">
          {notifications.map((notification) => (
            <div key={notification.id} className="pointer-events-auto w-full">
              <Toast
                notification={notification}
                onDismiss={removeNotification}
                showProgressBar={true}
              />
            </div>
          ))}
        </AnimatePresence>
      </div>

      {/* Mobile container - top-center */}
      <div
        className={cn(
          'fixed z-[800]', // Z_INDEX.toast from lib/zIndex.ts
          // Mobile positioning
          'flex md:hidden',
          'top-[calc(env(safe-area-inset-top)+1rem)] left-4 right-4',
          'flex-col items-center gap-3',
          'pointer-events-none'
        )}
        aria-label="Notifications"
      >
        <AnimatePresence mode="popLayout">
          {notifications.map((notification) => (
            <div key={notification.id} className="pointer-events-auto w-full">
              <Toast
                notification={notification}
                onDismiss={removeNotification}
                showProgressBar={true}
              />
            </div>
          ))}
        </AnimatePresence>
      </div>
    </>
  );
};

export default NotificationContainer;

/**
 * Standalone Toast component for external use
 */
export { Toast };
export type { ToastVariant, ToastProps };
