import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Input variants using class-variance-authority (cva)
 *
 * Design system requirements:
 * - Minimum 44px touch target (h-11) per Apple HIG
 * - Uses CSS custom properties for theming
 * - Focus styles with ring-2 and ring-offset
 * - Supports error/success states
 */
const inputVariants = cva(
  // Base styles
  [
    "flex w-full rounded-lg",
    "bg-[var(--color-bg-base)]",
    "text-[var(--color-text-default)]",
    "placeholder:text-[var(--color-text-disabled)]",
    "border border-[var(--color-border-default)]",
    "transition-all duration-200",
    // Focus styles with ring
    "focus:outline-hidden focus:ring-2 focus:ring-offset-2",
    "focus:ring-[var(--color-accent-500)]",
    "ring-offset-[var(--color-bg-base)]",
    "focus:border-[var(--color-accent-500)]",
    // Disabled state
    "disabled:cursor-not-allowed disabled:opacity-50",
    "disabled:bg-[var(--color-bg-muted)]",
    // File input styling
    "file:border-0 file:bg-transparent file:text-sm file:font-medium",
    "file:text-[var(--color-text-default)]",
  ],
  {
    variants: {
      variant: {
        /**
         * Default - Standard input appearance
         */
        default: [
          "hover:border-[var(--color-border-default)]",
        ],
        /**
         * Error - Input with validation error
         */
        error: [
          "border-[var(--color-error)]",
          "focus:ring-[var(--color-error)]",
          "focus:border-[var(--color-error)]",
        ],
        /**
         * Success - Input with successful validation
         */
        success: [
          "border-[var(--color-success)]",
          "focus:ring-[var(--color-success)]",
          "focus:border-[var(--color-success)]",
        ],
      },
      inputSize: {
        /**
         * Small - 36px height
         */
        sm: "h-9 px-3 text-sm",
        /**
         * Medium (default) - 44px height, minimum touch target
         */
        md: "h-11 px-4 text-base",
        /**
         * Large - 48px height
         */
        lg: "h-12 px-5 text-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      inputSize: "md",
    },
  }
)

/**
 * Label component for input fields
 */
const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement> & {
    required?: boolean
  }
>(({ className, required, children, ...props }, ref) => (
  <label
    ref={ref}
    className={cn(
      "block text-sm font-medium text-[var(--color-text-default)] mb-1.5",
      className
    )}
    {...props}
  >
    {children}
    {required && (
      <span className="text-[var(--color-error)] ml-1" aria-hidden="true">
        *
      </span>
    )}
  </label>
))
Label.displayName = "Label"

/**
 * Helper text component for input descriptions and errors
 */
const HelperText = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement> & {
    variant?: "default" | "error" | "success"
  }
>(({ className, variant = "default", ...props }, ref) => (
  <p
    ref={ref}
    className={cn(
      "mt-1.5 text-sm",
      {
        "text-[var(--color-text-muted)]": variant === "default",
        "text-[var(--color-error)]": variant === "error",
        "text-[var(--color-success)]": variant === "success",
      },
      className
    )}
    {...props}
  />
))
HelperText.displayName = "HelperText"

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {
  /** Label text for the input */
  label?: string
  /** Helper text displayed below the input */
  helperText?: string
  /** Error message - sets variant to error and displays message */
  error?: string
  /** Icon displayed on the left side of the input */
  leftIcon?: React.ReactNode
  /** Icon displayed on the right side of the input */
  rightIcon?: React.ReactNode
  /** Container className for the wrapper div */
  wrapperClassName?: string
}

/**
 * Input component with label, helper text, and icon support
 *
 * @example
 * // Basic input
 * <Input placeholder="Enter text" />
 *
 * @example
 * // Input with label and helper text
 * <Input
 *   label="Email"
 *   placeholder="you@example.com"
 *   helperText="We'll never share your email"
 * />
 *
 * @example
 * // Input with error state
 * <Input
 *   label="Password"
 *   type="password"
 *   error="Password must be at least 8 characters"
 * />
 *
 * @example
 * // Input with icons
 * <Input
 *   label="Search"
 *   leftIcon={<SearchIcon />}
 *   rightIcon={<ClearIcon />}
 * />
 *
 * @example
 * // Different sizes
 * <Input inputSize="sm" placeholder="Small" />
 * <Input inputSize="md" placeholder="Medium (default)" />
 * <Input inputSize="lg" placeholder="Large" />
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      variant,
      inputSize,
      label,
      helperText,
      error,
      leftIcon,
      rightIcon,
      wrapperClassName,
      id,
      required,
      disabled,
      "aria-describedby": ariaDescribedBy,
      ...props
    },
    ref
  ) => {
    const generatedId = React.useId()
    const inputId = id || generatedId
    const helperId = `${inputId}-helper`
    const errorId = `${inputId}-error`

    // Determine the effective variant
    const effectiveVariant = error ? "error" : variant

    // Build aria-describedby
    const describedBy = [
      ariaDescribedBy,
      error ? errorId : null,
      helperText && !error ? helperId : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined

    return (
      <div className={cn("w-full", wrapperClassName)}>
        {label && (
          <Label htmlFor={inputId} required={required}>
            {label}
          </Label>
        )}

        <div className="relative">
          {leftIcon && (
            <div
              className={cn(
                "absolute left-3 top-1/2 -translate-y-1/2",
                "text-[var(--color-text-subtle)]",
                "pointer-events-none",
                "[&>svg]:size-5"
              )}
              aria-hidden="true"
            >
              {leftIcon}
            </div>
          )}

          <input
            id={inputId}
            ref={ref}
            className={cn(
              inputVariants({ variant: effectiveVariant, inputSize, className }),
              leftIcon && "pl-10",
              rightIcon && "pr-10"
            )}
            disabled={disabled}
            required={required}
            aria-required={required}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            {...props}
          />

          {rightIcon && (
            <div
              className={cn(
                "absolute right-3 top-1/2 -translate-y-1/2",
                "text-[var(--color-text-subtle)]",
                "[&>svg]:size-5"
              )}
            >
              {rightIcon}
            </div>
          )}
        </div>

        {error && (
          <HelperText id={errorId} variant="error" role="alert">
            {error}
          </HelperText>
        )}

        {helperText && !error && (
          <HelperText id={helperId}>{helperText}</HelperText>
        )}
      </div>
    )
  }
)
Input.displayName = "Input"

export { Input, Label, HelperText }
