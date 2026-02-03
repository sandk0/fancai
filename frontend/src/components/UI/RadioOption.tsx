import * as React from "react"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

const radioContainerVariants = cva(
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

const radioCircleVariants = cva(
  [
    "relative flex items-center justify-center",
    "size-5 rounded-full",
    "border-2 transition-all duration-200",
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
        true: "border-[var(--color-accent-600)]",
        false: "",
      },
    },
    compoundVariants: [
      {
        variant: "error",
        checked: true,
        className: "border-[var(--color-error)]",
      },
    ],
    defaultVariants: {
      variant: "default",
      checked: false,
    },
  }
)

const radioDotVariants = cva(
  [
    "size-2.5 rounded-full",
    "transition-all duration-200",
  ],
  {
    variants: {
      variant: {
        default: "bg-[var(--color-accent-600)]",
        error: "bg-[var(--color-error)]",
      },
      checked: {
        true: "scale-100 opacity-100",
        false: "scale-0 opacity-0",
      },
    },
    defaultVariants: {
      variant: "default",
      checked: false,
    },
  }
)

export interface RadioProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  variant?: "default" | "error"
  label?: string
  helperText?: string
  errorMessage?: string
  containerClassName?: string
}

const RadioOption = React.forwardRef<HTMLInputElement, RadioProps>(
  (
    {
      className,
      containerClassName,
      variant = "default",
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
    const generatedId = React.useId()
    const radioId = id || generatedId
    const helperId = `${radioId}-helper`
    const errorId = `${radioId}-error`

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
          htmlFor={radioId}
          className={cn(
            radioContainerVariants({ disabled: !!disabled }),
            "shrink-0"
          )}
        >
          <input
            type="radio"
            ref={ref}
            id={radioId}
            className="peer sr-only"
            disabled={disabled}
            checked={checked}
            defaultChecked={defaultChecked}
            onChange={handleChange}
            aria-describedby={
              [showError && errorId, helperText && helperId]
                .filter(Boolean)
                .join(" ") || undefined
            }
            aria-invalid={variant === "error" ? true : undefined}
            {...props}
          />

          <span
            className={cn(
              radioCircleVariants({
                variant,
                checked: controlledChecked,
              }),
              "peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2",
              "peer-focus-visible:ring-[var(--color-accent-500)]",
              className
            )}
            aria-hidden="true"
          >
            <span
              className={radioDotVariants({
                variant,
                checked: controlledChecked,
              })}
            />
          </span>
        </label>

        {(label || helperText || showError) && (
          <div className="flex flex-col justify-center min-h-[44px] py-2.5">
            {label && (
              <label
                htmlFor={radioId}
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
RadioOption.displayName = "Radio"

export { RadioOption }
