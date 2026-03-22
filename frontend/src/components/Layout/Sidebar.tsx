import React, { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Home,
  Library,
  Image,
  Settings,
  BarChart3,
  Sparkles,
  Shield,
  User,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { isActiveRoute } from '@/utils/navigation';
import { Z_INDEX } from '@/lib/zIndex';

const SIDEBAR_COLLAPSED_KEY = 'fancai-sidebar-collapsed';

const Sidebar: React.FC = () => {
  const location = useLocation();
  const { user } = useAuthStore();
  const { t } = useTranslation();

  // Desktop collapsed state with localStorage persistence
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return saved === 'true';
  });

  // Persist collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isCollapsed));
  }, [isCollapsed]);

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => !prev);
  }, []);

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
    ...(user?.is_admin ? [{
      name: t('nav.adminDashboard'),
      href: '/admin',
      icon: Shield,
    }] : []),
  ];

  return (
    <>
      {/* Desktop Sidebar - Collapsible */}
      <aside
        className={cn(
          'hidden md:flex md:flex-shrink-0 md:flex-col',
          'fixed left-0 top-16 h-[calc(100vh-4rem)]',
          'transition-all duration-300 ease-in-out'
        )}
        style={{
          width: isCollapsed ? '64px' : '240px',
          zIndex: Z_INDEX.sidebar,
        }}
      >
        <div
          className={cn(
            'flex flex-col h-full',
            'bg-[var(--color-bg-base)] border-r border-[var(--color-border-default)]'
          )}
        >
          {/* Navigation */}
          <nav
            role="navigation"
            aria-label={t('sidebar.main_menu')}
            className="flex-1 py-4 overflow-y-auto"
          >
            <ul className="space-y-1 px-2">
              {navigation.map((item) => {
                const isActive = isActiveRoute(location.pathname, item.href);
                const Icon = item.icon;

                return (
                  <li key={item.name}>
                    <Link
                      to={item.href}
                      className={cn(
                        'group flex items-center rounded-lg min-h-[44px]',
                        'transition-all duration-200',
                        isCollapsed ? 'justify-center px-2 py-3' : 'px-3 py-3',
                        isActive
                          ? 'bg-[var(--color-accent-500)]/15 text-[var(--color-accent-600)]'
                          : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-emphasis)] hover:text-[var(--color-text-default)]'
                      )}
                      title={isCollapsed ? item.name : undefined}
                    >
                      <Icon
                        className={cn(
                          'flex-shrink-0 h-5 w-5',
                          'transition-colors duration-200',
                          isActive
                            ? 'text-[var(--color-accent-600)]'
                            : 'text-[var(--color-text-subtle)] group-hover:text-[var(--color-text-muted)]'
                        )}
                      />
                      <span
                        className={cn(
                          'ml-3 text-sm font-medium whitespace-nowrap',
                          'transition-all duration-200',
                          isCollapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
                        )}
                      >
                        {item.name}
                      </span>
                      {/* Active indicator */}
                      {isActive && (
                        <span
                          className={cn(
                            'absolute left-0 w-1 h-6 rounded-r-full',
                            'bg-[var(--color-accent-500)]'
                          )}
                        />
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Collapse Toggle Button */}
          <div className="px-2 py-2 border-t border-[var(--color-border-default)]">
            <button
              onClick={toggleCollapsed}
              className={cn(
                'w-full flex items-center rounded-lg min-h-[44px]',
                'px-3 py-3',
                'text-[var(--color-text-muted)]',
                'hover:bg-[var(--color-bg-emphasis)] hover:text-[var(--color-text-default)]',
                'transition-all duration-200',
                'focus:outline-hidden focus:ring-2 focus:ring-[var(--color-accent-500)] focus:ring-offset-2',
                isCollapsed && 'justify-center'
              )}
              aria-label={isCollapsed ? t('sidebar.expand_sidebar') : t('sidebar.collapse_sidebar')}
            >
              {isCollapsed ? (
                <ChevronRight className="w-5 h-5 flex-shrink-0" />
              ) : (
                <>
                  <ChevronLeft className="w-5 h-5 flex-shrink-0" />
                  <span className="ml-3 text-sm font-medium">{t('sidebar.collapse')}</span>
                </>
              )}
            </button>
          </div>

          {/* User Info Section */}
          <div className={cn(
            'flex-shrink-0 border-t border-[var(--color-border-default)]',
            isCollapsed ? 'px-2 py-3' : 'px-4 py-4'
          )}>
            <div className={cn(
              'flex items-center',
              isCollapsed && 'justify-center'
            )}>
              {/* Avatar */}
              <div className={cn(
                'flex-shrink-0 rounded-full flex items-center justify-center',
                'bg-[var(--color-accent-500)] text-primary-foreground',
                isCollapsed ? 'w-8 h-8' : 'w-10 h-10'
              )}>
                <span className={cn(
                  'font-medium',
                  isCollapsed ? 'text-xs' : 'text-sm'
                )}>
                  {user?.full_name ? user.full_name.charAt(0).toUpperCase() : user?.email?.charAt(0).toUpperCase() || 'U'}
                </span>
              </div>

              {/* User details - hidden when collapsed */}
              <div className={cn(
                'ml-3 overflow-hidden',
                'transition-all duration-200',
                isCollapsed ? 'opacity-0 w-0' : 'opacity-100 flex-1'
              )}>
                <p className="text-sm font-medium text-[var(--color-text-default)] truncate">
                  {user?.full_name || 'User'}
                </p>
                <p className="text-xs flex items-center text-[var(--color-text-subtle)]">
                  <Sparkles className="w-3 h-3 mr-1 text-[var(--color-accent-500)]" />
                  {t('sidebar.free_plan')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Spacer for desktop layout to account for fixed sidebar */}
      <div
        className={cn(
          'hidden md:block flex-shrink-0',
          'transition-all duration-300 ease-in-out'
        )}
        style={{
          width: isCollapsed ? '64px' : '240px',
        }}
      />
    </>
  );
};

export default Sidebar;
