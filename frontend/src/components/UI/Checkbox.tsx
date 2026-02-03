import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Animated checkmark SVG icon
 * Uses stroke-dasharray animation for draw effect
 */
const CheckIcon = React.memo(function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-3.5", className)}
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M11.5 4L5.5 10L2.5 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="checkbox-check-path"
      />
    </svg>
  )
})

/**
 * Indeterminate (minus) icon for partial selection state
 */
const IndeterminateIcon = React.memo(function IndeterminateIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-3.5", className)}
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M3 7H11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="checkbox-indeterminate-path"
      />
    </svg>
  )
})

/**
 * Checkbox variants using class-variance-authority (cva)
 *
 * Design system requirements:
 * - Minimum 44px touch target per Apple HIG
 * - Uses CSS custom properties for theming
 * - Focus styles with ring-2 and ring-offset
 */
const checkboxContainerVariants = cva(
  // Base container styles - provides 44px touch target
  [
    "relative inline-flex items-center justify-center",
    "min-h-[44px] min-w-[44px]",
    "cursor-pointer",
    "touch-action-manipulation",
  ],
  {
    variants: {
      disabled: {
        true: "cursor-not-allowed opacity-50",
        false: "",
      },
    },
    defaultVariants: {
      disabled: false,
    },
  }
)

const checkboxBoxVariants = cva(
  // Base checkbox box styles
  [
    "relative flex items-center justify-center",
    "size-5 rounded",
    "border-2 transition-all duration-200",
    // Focus styles
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    "focus-visible:ring-[var(--color-accent-500)]",
    "ring-offset-[var(--color-bg-base)]",
  ],
  {
    variants: {
      variant: {
        default: [
          "border-[var(--color-border-default)]",
          "bg-[var(--color-bg-base)]",
          "hover:border-[var(--color-accent-500)]",
        ],
        error: [
          "border-[var(--color-error)]",
          "bg-[var(--color-bg-base)]",
          "hover:border-[var(--color-error)]",
        ],
      },
      checked: {
        true: [
          "bg-[var(--color-accent-600)] border-[var(--color-accent-600)]",
          "text-white",
        ],
        false: "",
      },
      indeterminate: {
        true: [
          "bg-[var(--color-accent-600)] border-[var(--color-accent-600)]",
          "text-white",
        ],
        false: "",
      },
    },
    compoundVariants: [
      {
        variant: "error",
        checked: true,
        className: "bg-[var(--color-error)] border-[var(--color-error)]",
      },
      {
        variant: "error",
        indeterminate: true,
        className: "bg-[var(--color-error)] border-[var(--color-error)]",
      },
    ],
    defaultVariants: {
      variant: "default",
      checked: false,
      indeterminate: false,
    },
  }
)

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size">,
    Omit<VariantProps<typeof checkboxBoxVariants>, "checked" | "indeterminate"> {
  /** Error variant styling */
  variant?: "default" | "error"
  /** Indeterminate state for partial selection */
  indeterminate?: boolean
  /** Label text to display next to checkbox */
  label?: string
  /** Helper text displayed below label */
  helperText?: string
  /** Error message displayed when variant is error */
  errorMessage?: string
  /** Class name for the container wrapper */
  containerClassName?: string
}

/**
 * Checkbox component with animated checkmark and touch-friendly target
 *
 * @example
 * // Basic checkbox
 * <Checkbox label="Accept terms" />
 *
 * @example
 * // Checkbox with error state
 * <Checkbox
 *   variant="error"
 *   label="Required field"
 *   errorMessage="This field is required"
 * />
 *
 * @example
 * // Indeterminate checkbox
 * <Checkbox indeterminate label="Select all" />
 *
 * @example
 * // Disabled checkbox
 * <Checkbox disabled label="Cannot change" checked />
 */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      className,
      containerClassName,
      variant = "default",
      indeterminate = false,
      label,
      helperText,
      errorMessage,
      disabled,
      checked,
      defaultChecked,
      id,
      onChange,
      ...props
    },
    ref
  ) => {
    const internalRef = React.useRef<HTMLInputElement>(null)
    const checkboxRef = (ref as React.RefObject<HTMLInputElement>) || internalRef

    // Generate unique ID if not provided
    const generatedId = React.useId()
    const checkboxId = id || generatedId
    const helperId = `${checkboxId}-helper`
    const errorId = `${checkboxId}-error`

    // Handle indeterminate state
    React.useEffect(() => {
      if (checkboxRef.current) {
        checkboxRef.current.indeterminate = indeterminate
      }
    }, [indeterminate, checkboxRef])

    // Track checked state for styling
    const [isChecked, setIsChecked] = React.useState(defaultChecked || false)
    const controlledChecked = checked !== undefined ? checked : isChecked

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (checked === undefined) {
        setIsChecked(e.target.checked)
      }
      onChange?.(e)
    }

    const showError = variant === "error" && errorMessage

    return (
      <div className={cn("flex items-start gap-1", containerClassName)}>
        <label
          htmlFor={checkboxId}
          className={cn(
            checkboxContainerVariants({ disabled: !!disabled }),
            "shrink-0"
          )}
        >
          {/* Hidden native checkbox for accessibility */}
          <input
            type="checkbox"
            ref={checkboxRef}
            id={checkboxId}
            className="peer sr-only"
            disabled={disabled}
            checked={checked}
            defaultChecked={defaultChecked}
            onChange={handleChange}
            aria-required={props.required}
            aria-describedby={
              [showError && errorId, helperText && helperId]
                .filter(Boolean)
                .join(" ") || undefined
            }
            aria-invalid={variant === "error" ? true : undefined}
            {...props}
          />

          {/* Visual checkbox */}
          <span
            className={cn(
              checkboxBoxVariants({
                variant,
                checked: controlledChecked,
                indeterminate,
              }),
              // Peer focus state
              "peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2",
              "peer-focus-visible:ring-[var(--color-accent-500)]",
              className
            )}
            aria-hidden="true"
          >
            {/* Animated checkmark or indeterminate icon */}
            <span
              className={cn(
                "transition-all duration-200",
                controlledChecked || indeterminate
                  ? "scale-100 opacity-100"
                  : "scale-0 opacity-0"
              )}
            >
              {indeterminate ? <IndeterminateIcon /> : <CheckIcon />}
            </span>
          </span>
        </label>

        {/* Label and helper text */}
        {(label || helperText || showError) && (
          <div className="flex flex-col justify-center min-h-[44px] py-2.5">
            {label && (
              <label
                htmlFor={checkboxId}
                className={cn(
                  "text-sm font-medium leading-tight cursor-pointer",
                  "text-[var(--color-text-default)]",
                  disabled && "opacity-50 cursor-not-allowed"
                )}
              >
                {label}
              </label>
            )}
            {helperText && !showError && (
              <span
                id={helperId}
                className="text-xs text-[var(--color-text-muted)] mt-0.5"
              >
                {helperText}
              </span>
            )}
            {showError && (
              <span
                id={errorId}
                className="text-xs text-[var(--color-error)] mt-0.5"
                role="alert"
              >
                {errorMessage}
              </span>
            )}
          </div>
        )}
      </div>
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
