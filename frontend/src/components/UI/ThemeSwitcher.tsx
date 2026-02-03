/**
 * ThemeSwitcher - Global theme toggle component
 *
 * Features:
 * - Dropdown menu with Light/Dark/Sepia options
 * - Icons for each theme
 * - Persistent theme selection
 * - Compact and accessible design
 */

import React from 'react';
import { Sun, Moon, FileText, Monitor } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/UI/dropdown-menu';
import { cn } from '@/lib/utils';
import { useTheme, type AppTheme } from '@/hooks/useTheme';

export const ThemeSwitcher: React.FC = () => {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { t } = useTranslation();

  const themes: Array<{ value: AppTheme; label: string; icon: React.ReactNode }> = [
    { value: 'system', label: t('ui.theme.system'), icon: <Monitor className="w-4 h-4" /> },
    { value: 'light', label: t('ui.theme.light'), icon: <Sun className="w-4 h-4" /> },
    { value: 'dark', label: t('ui.theme.dark'), icon: <Moon className="w-4 h-4" /> },
    { value: 'sepia', label: t('ui.theme.sepia'), icon: <FileText className="w-4 h-4" /> },
  ];

  const currentTheme = themes.find(t => t.value === theme);

  // For system theme, show the resolved icon in the trigger button
  const displayIcon = theme === 'system'
    ? (resolvedTheme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />)
    : currentTheme?.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center justify-center gap-2 rounded-lg transition-colors touch-target shrink-0",
            "h-[44px] min-w-[44px] px-3 sm:px-3",
            "bg-muted hover:bg-muted/80 text-foreground"
          )}
          title={t('ui.theme.switch_title')}
          aria-label={t('ui.theme.switch_aria')}
        >
          {displayIcon}
          <span className="hidden sm:inline text-sm font-medium whitespace-nowrap">{currentTheme?.label}</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" side="bottom" alignOffset={0} sideOffset={8} className="w-40">
        {themes.map(({ value, label, icon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            className={cn(
              "flex items-center gap-2 cursor-pointer",
              theme === value && "bg-primary/10 sepia-theme:bg-primary/10"
            )}
          >
            {icon}
            <span>{label}</span>
            {theme === value && <span className="ml-auto text-primary">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
