import { m } from 'framer-motion';
import { Minus, Plus, Hand } from 'lucide-react';
import type { ReaderTheme, NavigationMode } from '@/stores/reader';
import { themeConfigs, fontFamilyOptions, widthPresets } from '../config';

export const SectionHeader: React.FC<{ icon: React.ReactNode; title: string }> = ({ icon, title }) => (
  <div className="flex items-center gap-2 mb-4">
    <span className="text-accent">{icon}</span>
    <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">{title}</h3>
  </div>
);

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}

export const SliderControl: React.FC<SliderControlProps> = ({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  onChange,
  formatValue,
}) => {
  const displayValue = formatValue ? formatValue(value) : `${value}${unit}`;
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className="text-sm font-medium text-muted-foreground">{label}</label>
        <span className="text-sm font-semibold text-foreground tabular-nums">{displayValue}</span>
      </div>
      <div className="relative h-11 flex items-center">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-11 appearance-none cursor-pointer bg-transparent touch-pan-x
                     [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:mt-[-10px]
                     [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary
                     [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background
                     [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110
                     [&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full
                     [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:border-0
                     [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary
                     [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:cursor-pointer"
          style={{
            background: `linear-gradient(to right, transparent 0%, transparent 100%)`,
          }}
          aria-label={label}
        />
        <div
          className="absolute left-0 right-0 h-2 rounded-full pointer-events-none"
          style={{
            background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${percentage}%, hsl(var(--secondary)) ${percentage}%, hsl(var(--secondary)) 100%)`,
          }}
        />
      </div>
    </div>
  );
};

interface StepperControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}

export const StepperControl: React.FC<StepperControlProps> = ({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  onChange,
}) => {
  const decrease = () => onChange(Math.max(min, value - step));
  const increase = () => onChange(Math.min(max, value + step));

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-muted-foreground block">{label}</label>
      <div className="flex items-center justify-between bg-secondary/50 rounded-xl p-1">
        <button
          onClick={decrease}
          disabled={value <= min}
          className="flex items-center justify-center w-11 h-11 rounded-lg
                     bg-background text-foreground
                     hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors touch-target"
          aria-label={`Decrease ${label}`}
        >
          <Minus className="w-5 h-5" />
        </button>
        <span className="text-lg font-semibold text-foreground tabular-nums min-w-[4rem] text-center">
          {value}{unit}
        </span>
        <button
          onClick={increase}
          disabled={value >= max}
          className="flex items-center justify-center w-11 h-11 rounded-lg
                     bg-background text-foreground
                     hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors touch-target"
          aria-label={`Increase ${label}`}
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};

interface ThemeButtonProps {
  theme: ReaderTheme;
  isActive: boolean;
  onClick: () => void;
}

export const ThemeButton: React.FC<ThemeButtonProps> = ({ theme, isActive, onClick }) => {
  const config = themeConfigs[theme];

  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center p-3 rounded-xl
                  border-2 transition-all touch-target min-h-[72px]
                  ${isActive
                    ? 'border-primary bg-primary/10 ring-2 ring-primary/20'
                    : 'border-border bg-card hover:border-muted-foreground/30'
                  }`}
      aria-label={`${config.label} theme`}
      aria-pressed={isActive}
    >
      <div
        className="w-8 h-8 rounded-full border-2 border-border mb-1 flex items-center justify-center shadow-sm"
        style={{ backgroundColor: config.bg }}
      >
        <span style={{ color: config.text }} className="text-xs font-bold">
          Aa
        </span>
      </div>
      <span className="text-xs font-medium text-foreground">{config.label}</span>
      {isActive && (
        <m.div
          layoutId="activeTheme"
          className="absolute inset-0 rounded-xl border-2 border-primary"
          initial={false}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      )}
    </button>
  );
};

interface FontFamilyButtonProps {
  family: typeof fontFamilyOptions[0];
  isActive: boolean;
  onClick: () => void;
}

export const FontFamilyButton: React.FC<FontFamilyButtonProps> = ({ family, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center justify-center p-3 rounded-xl
                border-2 transition-all touch-target min-h-[72px]
                ${isActive
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card hover:border-muted-foreground/30'
                }`}
    aria-label={`${family.label} font`}
    aria-pressed={isActive}
  >
    <span
      className="text-2xl font-normal mb-1"
      style={{ fontFamily: family.value }}
    >
      {family.preview}
    </span>
    <span className="text-xs font-medium text-foreground">{family.label}</span>
  </button>
);

interface WidthPresetButtonProps {
  preset: typeof widthPresets[0];
  isActive: boolean;
  onClick: () => void;
}

export const WidthPresetButton: React.FC<WidthPresetButtonProps> = ({ preset, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`flex-1 py-3 px-4 rounded-xl border-2 transition-all touch-target
                text-sm font-medium
                ${isActive
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card hover:border-muted-foreground/30 text-foreground'
                }`}
    aria-label={`${preset.label} width`}
    aria-pressed={isActive}
  >
    {preset.label}
  </button>
);

interface NavigationModeButtonProps {
  mode: NavigationMode;
  icon: typeof Hand;
  label: string;
  description: string;
  isActive: boolean;
  onClick: () => void;
}

export const NavigationModeButton: React.FC<NavigationModeButtonProps> = ({
  mode: _mode,
  icon: Icon,
  label,
  description,
  isActive,
  onClick,
}) => (
  <button
    onClick={onClick}
    className={`flex-1 flex flex-col items-center justify-center p-4 rounded-xl
                border-2 transition-all touch-target min-h-[100px]
                ${isActive
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card hover:border-muted-foreground/30'
                }`}
    aria-label={label}
    aria-pressed={isActive}
  >
    <Icon className={`w-8 h-8 mb-2 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
    <span className="text-sm font-medium text-foreground">{label}</span>
    <span className="text-xs text-muted-foreground mt-1 text-center">{description}</span>
  </button>
);
