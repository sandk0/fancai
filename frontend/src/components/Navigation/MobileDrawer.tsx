/**
 * MobileDrawer Component
 * Slide-in drawer for mobile navigation with accessibility features
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { m, AnimatePresence } from 'motion/react';
import {
  Home,
  Library,
  Image,
  Settings,
  BarChart3,
  BookOpen,
  Sparkles,
  Shield,
  User,
  X,
  LogOut,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/cn';
import { isActiveRoute } from '@/utils/navigation';
import { Z_INDEX } from '@/lib/zIndex';

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const MobileDrawer: React.FC<MobileDrawerProps> = ({ isOpen, onClose }) => {
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { t } = useTranslation();
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusedElement = useRef<HTMLElement | null>(null);

  // Navigation items
  const navigation = [
    {
      name: t('nav.home'),
      href: '/',
      icon: Home,
    },
    {
      name: t('nav.myLibrary'),
      href: '/library',
      icon: Library,
    },
    {
      name: t('nav.generatedImages'),
      href: '/images',
      icon: Image,
    },
    {
      name: t('nav.readingStats'),
      href: '/stats',
      icon: BarChart3,
    },
    {
      name: t('nav.profile'),
      href: '/profile',
      icon: User,
    },
    {
      name: t('nav.settings'),
      href: '/settings',
      icon: Settings,
    },
    ...(user?.is_admin
      ? [
          {
            name: t('nav.adminDashboard'),
            href: '/admin',
            icon: Shield,
          },
        ]
      : []),
  ];

  // Handle ESC key to close drawer
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  // Focus trap implementation
  const handleFocusTrap = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !drawerRef.current) return;

    const focusableElements = drawerRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement?.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement?.focus();
    }
  }, []);

  // Body scroll lock and focus management
  useEffect(() => {
    if (isOpen) {
      // Store the currently focused element
      lastFocusedElement.current = document.activeElement as HTMLElement;

      // Lock body scroll
      document.body.style.overflow = 'hidden';

      // Add event listeners
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('keydown', handleFocusTrap);

      // Focus the close button after animation
      setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 100);
    } else {
      // Unlock body scroll
      document.body.style.overflow = '';

      // Remove event listeners
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keydown', handleFocusTrap);

      // Restore focus to the previously focused element
      lastFocusedElement.current?.focus();
    }

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keydown', handleFocusTrap);
    };
  }, [isOpen, handleKeyDown, handleFocusTrap]);

  // Handle link click - close drawer and navigate
  const handleLinkClick = () => {
    onClose();
  };

  // Handle logout
  const handleLogout = async () => {
    await logout();
    onClose();
  };

  // Animation variants
  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 },
  };

  const drawerVariants = {
    hidden: { x: '-100%' },
    visible: {
      x: 0,
      transition: {
        type: 'spring' as const,
        damping: 25,
        stiffness: 300,
      },
    },
    exit: {
      x: '-100%',
      transition: {
        type: 'spring' as const,
        damping: 30,
        stiffness: 400,
      },
    },
  };

  const drawerContent = (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 lg:hidden"
          style={{ zIndex: Z_INDEX.modalOverlay }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-drawer-title"
        >
          {/* Backdrop with blur effect - pointer-events-none on blur layer */}
          <m.div
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Drawer panel */}
          <m.div
            ref={drawerRef}
            variants={drawerVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              'absolute inset-y-0 left-0 w-[280px] max-w-[85vw]',
              'bg-background',
              'shadow-2xl',
              'flex flex-col',
              'pointer-events-auto',
              // Safe area support for notched devices
              'pb-safe pl-safe'
            )}
            style={{ zIndex: Z_INDEX.modal }}
          >
            {/* Header with logo and close button */}
            <div className="flex items-center justify-between flex-shrink-0 px-4 py-4 border-b border-border">
              <div className="flex items-center">
                <BookOpen className="w-8 h-8 text-primary" />
                <span
                  id="mobile-drawer-title"
                  className="ml-2 text-xl font-bold text-foreground"
                >
                  fancai
                </span>
              </div>
              <m.button
                ref={closeButtonRef}
                onClick={onClose}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className={cn(
                  'p-2 rounded-lg',
                  'text-muted-foreground',
                  'hover:bg-muted',
                  'focus:outline-hidden focus:ring-2 focus:ring-primary focus:ring-offset-2',
                  'transition-colors'
                )}
                aria-label={t('common.close')}
              >
                <X className="w-5 h-5" />
              </m.button>
            </div>

            {/* Navigation links */}
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {navigation.map((item) => {
                const isActive = isActiveRoute(location.pathname, item.href);
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={handleLinkClick}
                    className={cn(
                      'group flex items-center px-3 py-3 text-base font-medium rounded-lg transition-colors min-h-[44px]',
                      isActive
                        ? 'bg-primary/10 dark:bg-primary/20 text-primary'
                        : 'text-foreground hover:bg-muted'
                    )}
                  >
                    <Icon
                      className={cn(
                        'mr-4 flex-shrink-0 h-5 w-5',
                        isActive
                          ? 'text-primary'
                          : 'text-muted-foreground group-hover:text-foreground'
                      )}
                    />
                    {item.name}
                  </Link>
                );
              })}
            </nav>

            {/* User section at the bottom */}
            <div className="flex-shrink-0 border-t border-border">
              {/* User info */}
              <div className="px-4 py-4">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center bg-primary">
                      <span className="text-sm font-medium text-white">
                        {user?.full_name
                          ? user.full_name.charAt(0).toUpperCase()
                          : user?.email?.charAt(0).toUpperCase() || 'U'}
                      </span>
                    </div>
                  </div>
                  <div className="ml-3 flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {user?.full_name || t('nav.user')}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {user?.email}
                    </p>
                    <p className="text-xs flex items-center text-muted-foreground mt-0.5">
                      <Sparkles className="w-3 h-3 mr-1" />
                      {t('nav.freePlan')}
                    </p>
                  </div>
                </div>
              </div>

              {/* Logout button */}
              <div className="px-3 pb-4">
                <button
                  onClick={handleLogout}
                  className={cn(
                    'w-full flex items-center px-3 py-3 text-base font-medium rounded-lg min-h-[44px]',
                    'text-red-600 dark:text-red-400',
                    'hover:bg-red-50 dark:hover:bg-red-900/20',
                    'focus:outline-hidden focus:ring-2 focus:ring-red-500 focus:ring-offset-2',
                    'transition-colors'
                  )}
                >
                  <LogOut className="mr-4 flex-shrink-0 h-5 w-5" />
                  {t('nav.signOut')}
                </button>
              </div>
            </div>
          </m.div>
        </div>
      )}
    </AnimatePresence>
  );

  // Render using portal to ensure proper stacking context
  return createPortal(drawerContent, document.body);
};

export default MobileDrawer;
