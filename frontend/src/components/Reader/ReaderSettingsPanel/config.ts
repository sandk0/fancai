import { Sun, Moon, Hand, MousePointerClick } from 'lucide-react';
import type { ReaderTheme, NavigationMode } from '@/stores/reader';

export const themeConfigs: Record<ReaderTheme, { bg: string; text: string; label: string; icon: typeof Sun }> = {
  light: { bg: '#FFFFFF', text: '#1A1A1A', label: 'Light', icon: Sun },
  dark: { bg: '#121212', text: '#E0E0E0', label: 'Dark', icon: Moon },
  sepia: { bg: '#FBF0D9', text: '#3D2914', label: 'Sepia', icon: Sun },
  night: { bg: '#000000', text: '#B0B0B0', label: 'Night', icon: Moon },
  outdoor: { bg: '#FFFEF5', text: '#000000', label: 'Outdoor', icon: Sun },
};

export const fontFamilyOptions = [
  { value: 'Georgia, serif', label: 'Serif', preview: 'Aa' },
  { value: '"Inter", sans-serif', label: 'Sans', preview: 'Aa' },
  { value: '"Fira Code", monospace', label: 'Mono', preview: 'Aa' },
];

export const widthPresets = [
  { value: 600, label: 'Narrow' },
  { value: 800, label: 'Medium' },
  { value: 1000, label: 'Wide' },
];

export const navigationModeOptions: { value: NavigationMode; icon: typeof Hand }[] = [
  { value: 'swipe', icon: Hand },
  { value: 'tap', icon: MousePointerClick },
];
