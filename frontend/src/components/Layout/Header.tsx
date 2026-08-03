import React from 'react';
import { Link, useLocation } from 'react-router';
import {
  BookOpen,
  User,
  Settings,
  LogOut,
  Upload,
  Library,
  Home,
  ChevronDown,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { useUIStore } from '@/stores/ui';
import { useTranslation } from 'react-i18next';
import { ThemeSwitcher } from '@/components/UI/ThemeSwitcher';
import { isActiveRoute } from '@/utils/navigation';
import { cn } from '@/lib/utils';

const Header: React.FC = () => {
  const { user, logout } = useAuthStore();
  const { setShowUploadModal } = useUIStore();
  const { t } = useTranslation();
  const location = useLocation();
  const [showUserMenu, setShowUserMenu] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const handleLogout = () => {
    logout();
    setShowUserMenu(false);
  };

  // Close menu when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

  // Close menu on escape key
  React.useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showUserMenu]);

  const navLinks = [
    { to: '/', label: t('nav.home'), icon: Home },
    { to: '/library', label: t('nav.myLibrary'), icon: Library },
  ];

  return (
    <header className="sticky top-0 left-0 right-0 z-[200] pt-safe standalone:pt-[calc(env(safe-area-inset-top)+0.5rem)] border-b border-border bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 md:h-16">
          {/* Left side - Logo */}
          <div className="flex items-center gap-3">
            {/* Logo */}
            <Link
              to="/"
              className="flex items-center gap-2 min-h-[44px] min-w-[44px] justify-center transition-opacity hover:opacity-80 touch-target"
              aria-label={t('header.home_aria')}
            >
              <div className="flex items-center justify-center w-11 h-11 rounded-lg bg-primary">
                <BookOpen className="w-6 h-6 text-primary-foreground" />
              </div>
              <span className="text-lg font-semibold text-foreground hidden sm:block">
                fancai
              </span>
            </Link>

            {/* Desktop Navigation */}
            <nav
              role="navigation"
              aria-label={t('header.site_nav')}
              className="hidden md:flex items-center gap-1 ml-6"
            >
              {navLinks.map((link) => {
                const Icon = link.icon;
                const isActive = isActiveRoute(location.pathname, link.to);
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    aria-current={isActive ? 'page' : undefined}
                    className={`
                      flex items-center gap-2 px-3 min-h-[44px] rounded-lg text-sm font-medium transition-colors
                      focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
                      ${isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                      }
                    `}
                  >
                    <Icon className="w-4 h-4" aria-hidden="true" />
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right side - Actions and User menu */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {/* Upload button - icon only on mobile */}
            <button
              type="button"
              onClick={() => setShowUploadModal(true)}
              className="inline-flex items-center justify-center gap-2 px-3 sm:px-4 min-h-[44px] min-w-[44px] text-sm font-medium rounded-lg text-primary-foreground bg-primary hover:bg-primary/90 transition-all hover:scale-[102%] active:scale-[98%] touch-target"
              aria-label={t('nav.uploadBook')}
              data-testid="header-upload-button"
            >
              <Upload className="w-4 h-4" />
              <span className="hidden sm:inline">{t('nav.uploadBook')}</span>
            </button>

            {/* Theme Switcher */}
            <ThemeSwitcher />

            {/* User menu */}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                className="flex items-center gap-2 p-1 min-w-[44px] min-h-[44px] rounded-full transition-all hover:bg-muted focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                onClick={() => setShowUserMenu(!showUserMenu)}
                aria-expanded={showUserMenu}
                aria-haspopup="true"
                data-testid="user-menu-trigger"
              >
                <span className="sr-only">{t('nav.openUserMenu')}</span>
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center bg-primary text-primary-foreground"
                  data-testid="user-avatar"
                >
                  <span className="text-sm font-medium">
                    {user?.full_name
                      ? user.full_name.charAt(0).toUpperCase()
                      : user?.email?.charAt(0).toUpperCase() || 'U'}
                  </span>
                </div>
                <ChevronDown
                  className={`hidden sm:block w-4 h-4 text-muted-foreground transition-transform duration-200 ${showUserMenu ? 'rotate-180' : ''}`}
                />
              </button>

              {/* User dropdown */}
              {showUserMenu && (
                <div
                  className={cn(
                    "absolute right-0 mt-2 origin-top-right rounded-xl shadow-lg py-1 ring-1 ring-border bg-popover border border-border animate-fade-in-up",
                    "w-56 max-w-[calc(100vw-2rem)]"
                  )}
                  role="menu"
                  aria-orientation="vertical"
                >
                  {/* User info */}
                  <div className="px-4 py-3 border-b border-border">
                    <p className="text-sm font-medium text-foreground truncate">
                      {user?.full_name || 'User'}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {user?.email}
                    </p>
                  </div>

                  {/* Menu items */}
                  <div className="py-1">
                    <Link
                      to="/profile"
                      onClick={() => setShowUserMenu(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors"
                      role="menuitem"
                    >
                      <User className="w-4 h-4 text-muted-foreground" />
                      {t('nav.profile')}
                    </Link>

                    <Link
                      to="/settings"
                      onClick={() => setShowUserMenu(false)}
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-muted transition-colors"
                      role="menuitem"
                    >
                      <Settings className="w-4 h-4 text-muted-foreground" />
                      {t('nav.settings')}
                    </Link>
                  </div>

                  {/* Logout */}
                  <div className="border-t border-border py-1">
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                      role="menuitem"
                      data-testid="logout-button"
                    >
                      <LogOut className="w-4 h-4" />
                      {t('nav.signOut')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
