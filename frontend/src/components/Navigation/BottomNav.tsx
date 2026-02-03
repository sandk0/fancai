import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home, Library, Image, Settings, User } from 'lucide-react';
import { isActiveRoute } from '@/utils/navigation';
import { Z_INDEX } from '@/lib/zIndex';
import { useHaptics } from '@/hooks/useHaptics';

interface NavItem {
  path: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * BottomNav - Mobile navigation component
 *
 * Features:
 * - Fixed at bottom of screen
 * - Hidden on desktop (md:hidden)
 * - Backdrop blur for modern appearance
 * - Safe area support for iOS notch/home indicator
 * - Touch targets >= 44px for accessibility
 * - Smooth transitions for active states
 */
export function BottomNav() {
  const location = useLocation();
  const haptics = useHaptics();
  const { t } = useTranslation();

  const navItems: NavItem[] = [
    { path: '/', label: t('bottomNav.home'), icon: Home },
    { path: '/library', label: t('bottomNav.library'), icon: Library },
    { path: '/images', label: t('bottomNav.gallery'), icon: Image },
    { path: '/settings', label: t('bottomNav.settings'), icon: Settings },
    { path: '/profile', label: t('bottomNav.profile'), icon: User },
  ];

  return (
    <nav
      className="fixed bottom-0 inset-x-0 md:hidden"
      role="navigation"
      aria-label={t('bottomNav.aria_label')}
      style={{ zIndex: Z_INDEX.bottomNav }}
    >
      {/* Background with blur - pointer-events: none to allow touch pass-through */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-lg border-t border-border"
        style={{ pointerEvents: 'none' }}
        aria-hidden="true"
      />

      {/* Navigation items - pointer-events: auto for clickable content */}
      <ul
        className="relative flex items-center justify-around"
        style={{
          pointerEvents: 'auto',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        {navItems.map(({ path, label, icon: Icon }) => {
          const active = isActiveRoute(location.pathname, path);

          return (
            <li key={path} className="flex-1">
              <Link
                to={path}
                onClick={() => haptics.tap()}
                className={`
                  flex flex-col items-center justify-center
                  min-h-[56px] py-2 px-1
                  touch-target
                  transition-colors duration-200 ease-out
                  ${active
                    ? 'text-[var(--color-accent-500)]'
                    : 'text-muted-foreground hover:text-foreground'
                  }
                `}
                aria-current={active ? 'page' : undefined}
              >
                <Icon
                  className={`
                    w-6 h-6 mb-1
                    transition-transform duration-200 ease-out
                    ${active ? 'scale-110' : 'scale-100'}
                  `}
                  aria-hidden="true"
                />
                <span
                  className={`
                    text-[11px] sm:text-xs font-medium leading-tight
                    transition-opacity duration-200
                    ${active ? 'opacity-100' : 'opacity-80'}
                  `}
                >
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default BottomNav;
