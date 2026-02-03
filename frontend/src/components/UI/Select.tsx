import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Select component variants using class-variance-authority
 * Follows design system patterns with touch-friendly sizing
 */
const selectVariants = cva(
  [
    // Base styles
    "w-full appearance-none rounded-lg border bg-background text-foreground",
    "transition-colors duration-200",
    // Typography
    "text-sm font-medium",
    // Padding with space for chevron icon
    "pl-3 pr-10",
    // Focus states - visible ring
    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
    // Disabled state
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-muted",
    // Placeholder styling (first option with empty value)
    "[&:invalid]:text-muted-foreground",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "border-input hover:border-ring/50",
        error: "border-destructive focus:ring-destructive",
      },
      size: {
        default: "h-11 py-2", // 44px - Apple HIG minimum touch target
        sm: "h-10 py-1.5 text-sm", // 40px - acceptable for secondary actions
        lg: "h-12 py-2.5 text-base", // 48px - large touch target
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

/**
 * Option type for Select component
 */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Select component props
 */
export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size">,
    VariantProps<typeof selectVariants> {
  /** Placeholder text shown when no value is selected */
  placeholder?: string;
  /** Options to display in the dropdown */
  options?: SelectOption[];
}

/**
 * Native select element with custom styling
 * Touch-friendly with minimum 44px height (h-11)
 * Mobile-friendly dropdown using native browser behavior
 */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      variant,
      size,
      placeholder,
      options,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <div className="relative w-full">
        <select
          className={cn(selectVariants({ variant, size, className }))}
          ref={ref}
          {...props}
        >
          {placeholder && (
            <option value="" disabled hidden>
              {placeholder}
            </option>
          )}
          {options
            ? options.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.label}
                </option>
              ))
            : children}
        </select>
        <ChevronDown
          className={cn(
            "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2",
            "h-4 w-4 text-muted-foreground",
            "transition-colors duration-200",
            props.disabled && "opacity-50"
          )}
          aria-hidden="true"
        />
      </div>
    );
  }
);
Select.displayName = "Select";

/**
 * SelectWrapper props for label + select + helper text composition
 */
export interface SelectWrapperProps {
  /** Label text displayed above the select */
  label?: string;
  /** Helper text displayed below the select */
  helperText?: string;
  /** Error message - when set, applies error styling */
  error?: string;
  /** Makes the field required (adds asterisk to label) */
  required?: boolean;
  /** Additional className for the wrapper */
  className?: string;
  /** Select element ID for label association */
  id?: string;
  /** Children - should be a Select component */
  children: React.ReactNode;
}

/**
 * Wrapper component for Select with label, helper text, and error support
 * Provides consistent form field layout across the design system
 */
const SelectWrapper = React.forwardRef<HTMLDivElement, SelectWrapperProps>(
  (
    { label, helperText, error, required, className, id, children },
    ref
  ) => {
    return (
      <div ref={ref} className={cn("flex flex-col gap-1.5", className)}>
        {label && (
          <label
            htmlFor={id}
            className={cn(
              "text-sm font-medium",
              error ? "text-destructive" : "text-foreground"
            )}
          >
            {label}
            {required && (
              <span className="ml-0.5 text-destructive" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}
        {children}
        {(helperText || error) && (
          <p
            className={cn(
              "text-xs",
              error ? "text-destructive" : "text-muted-foreground"
            )}
            role={error ? "alert" : undefined}
          >
            {error || helperText}
          </p>
        )}
      </div>
    );
  }
);
SelectWrapper.displayName = "SelectWrapper";

export { Select, SelectWrapper };
