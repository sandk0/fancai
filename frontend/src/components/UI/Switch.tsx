/**
 * Switch - Toggle component for boolean settings
 *
 * Features:
 * - Accessible toggle with proper ARIA attributes
 * - Touch-friendly 44px minimum target
 * - Smooth animation with Tailwind
 * - Works with controlled and uncontrolled state
 *
 * @component
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface SwitchProps {
  /** Whether the switch is on */
  checked?: boolean;
  /** Default checked state for uncontrolled usage */
  defaultChecked?: boolean;
  /** Callback when switch is toggled */
  onChange?: (checked: boolean) => void;
  /** Whether the switch is disabled */
  disabled?: boolean;
  /** Label text */
  label?: string;
  /** Description text below label */
  description?: string;
  /** Additional class for the container */
  className?: string;
  /** ID for the switch input */
  id?: string;
  /** Name attribute for form submission */
  name?: string;
}

/**
 * Toggle switch component
 *
 * @example
 * // Controlled switch
 * <Switch
 *   checked={isEnabled}
 *   onChange={setIsEnabled}
 *   label="Enable feature"
 *   description="This will turn on the feature"
 * />
 *
 * @example
 * // Uncontrolled switch
 * <Switch
 *   defaultChecked={true}
 *   label="Auto-save"
 * />
 */
export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  (
    {
      checked,
      defaultChecked = false,
      onChange,
      disabled = false,
      label,
      description,
      className,
      id,
      name,
    },
    ref
  ) => {
    const generatedId = React.useId();
    const switchId = id || generatedId;
    const descriptionId = `${switchId}-description`;

    // Internal state for uncontrolled mode
    const [internalChecked, setInternalChecked] = React.useState(defaultChecked);
    const isChecked = checked !== undefined ? checked : internalChecked;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.checked;
      if (checked === undefined) {
        setInternalChecked(newValue);
      }
      onChange?.(newValue);
    };

    return (
      <div className={cn('flex items-center gap-3', className)}>
        {/* Switch container with 44px touch target */}
        <label
          htmlFor={switchId}
          className={cn(
            'relative inline-flex items-center justify-center',
            'min-h-[44px] min-w-[44px]',
            'cursor-pointer',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          {/* Hidden input for accessibility */}
          <input
            ref={ref}
            type="checkbox"
            id={switchId}
            name={name}
            className="peer sr-only"
            checked={isChecked}
            onChange={handleChange}
            disabled={disabled}
            role="switch"
            aria-checked={isChecked}
            aria-describedby={description ? descriptionId : undefined}
          />

          {/* Visual switch track */}
          <span
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full',
              'border-2 border-transparent transition-colors duration-200',
              'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-2',
              'focus-visible:ring-primary',
              'ring-offset-background',
              isChecked
                ? 'bg-primary'
                : 'bg-muted',
              'peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
              'peer-focus-visible:ring-primary'
            )}
            aria-hidden="true"
          >
            {/* Switch thumb */}
            <span
              className={cn(
                'pointer-events-none block h-5 w-5 rounded-full bg-[var(--color-bg-base)] shadow-lg',
                'ring-0 transition-transform duration-200',
                isChecked ? 'translate-x-5' : 'translate-x-0'
              )}
            />
          </span>
        </label>

        {/* Label and description */}
        {(label || description) && (
          <div className="flex flex-col">
            {label && (
              <label
                htmlFor={switchId}
                className={cn(
                  'text-sm font-medium text-foreground cursor-pointer',
                  disabled && 'cursor-not-allowed opacity-50'
                )}
              >
                {label}
              </label>
            )}
            {description && (
              <span
                id={descriptionId}
                className="text-xs text-muted-foreground"
              >
                {description}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }
);

Switch.displayName = 'Switch';

export default Switch;
