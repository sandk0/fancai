import * as React from "react"

import { cn } from "@/lib/utils"
import { logger } from '@/lib/logger'
import { RadioOption } from './RadioOption'
import type { RadioProps } from './RadioOption'

interface RadioGroupContextValue {
  name: string
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  variant?: "default" | "error"
}

const RadioGroupContext = React.createContext<RadioGroupContextValue | null>(null)

function useRadioGroupContext() {
  return React.useContext(RadioGroupContext)
}

export interface RadioGroupProps {
  name: string
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  disabled?: boolean
  variant?: "default" | "error"
  label?: string
  helperText?: string
  errorMessage?: string
  orientation?: "horizontal" | "vertical"
  required?: boolean
  children: React.ReactNode
  className?: string
}

const RadioGroup = React.forwardRef<HTMLDivElement, RadioGroupProps>(
  (
    {
      name,
      value,
      defaultValue,
      onChange,
      disabled,
      variant = "default",
      label,
      helperText,
      errorMessage,
      orientation = "vertical",
      required,
      children,
      className,
    },
    ref
  ) => {
    const [internalValue, setInternalValue] = React.useState(defaultValue)
    const controlledValue = value !== undefined ? value : internalValue

    const handleChange = React.useCallback(
      (newValue: string) => {
        if (value === undefined) {
          setInternalValue(newValue)
        }
        onChange?.(newValue)
      },
      [value, onChange]
    )

    const contextValue = React.useMemo(
      () => ({
        name,
        value: controlledValue,
        onChange: handleChange,
        disabled,
        variant,
      }),
      [name, controlledValue, handleChange, disabled, variant]
    )

    const groupId = React.useId()
    const labelId = `${groupId}-label`
    const helperId = `${groupId}-helper`
    const errorId = `${groupId}-error`
    const showError = variant === "error" && errorMessage

    return (
      <RadioGroupContext.Provider value={contextValue}>
        <div
          ref={ref}
          role="radiogroup"
          aria-labelledby={label ? labelId : undefined}
          aria-describedby={
            [showError && errorId, helperText && helperId]
              .filter(Boolean)
              .join(" ") || undefined
          }
          aria-required={required}
          aria-invalid={variant === "error" ? true : undefined}
          className={cn("flex flex-col gap-1", className)}
        >
          {label && (
            <span
              id={labelId}
              className={cn(
                "text-sm font-medium text-[var(--color-text-default)]",
                disabled && "opacity-50"
              )}
            >
              {label}
              {required && (
                <span className="text-[var(--color-error)] ml-0.5" aria-hidden="true">
                  *
                </span>
              )}
            </span>
          )}

          <div
            className={cn(
              "flex",
              orientation === "vertical" ? "flex-col" : "flex-row flex-wrap gap-x-4"
            )}
          >
            {children}
          </div>

          {helperText && !showError && (
            <span
              id={helperId}
              className="text-xs text-[var(--color-text-muted)] mt-1"
            >
              {helperText}
            </span>
          )}
          {showError && (
            <span
              id={errorId}
              className="text-xs text-[var(--color-error)] mt-1"
              role="alert"
            >
              {errorMessage}
            </span>
          )}
        </div>
      </RadioGroupContext.Provider>
    )
  }
)
RadioGroup.displayName = "RadioGroup"

// ============================================================================
// RadioGroupItem Component
// ============================================================================

export interface RadioGroupItemProps
  extends Omit<RadioProps, "name" | "checked" | "onChange" | "variant"> {
  value: string
}

const RadioGroupItem = React.forwardRef<HTMLInputElement, RadioGroupItemProps>(
  ({ value, disabled: itemDisabled, ...props }, ref) => {
    const context = useRadioGroupContext()

    if (!context) {
      logger.warn(
        "RadioGroupItem must be used within a RadioGroup component"
      )
      return null
    }

    const { name, value: groupValue, onChange, disabled: groupDisabled, variant } = context
    const isDisabled = itemDisabled || groupDisabled
    const isChecked = groupValue === value

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.checked) {
        onChange?.(value)
      }
    }

    return (
      <RadioOption
        ref={ref}
        name={name}
        value={value}
        checked={isChecked}
        onChange={handleChange}
        disabled={isDisabled}
        variant={variant}
        {...props}
      />
    )
  }
)
RadioGroupItem.displayName = "RadioGroupItem"

export { RadioGroup, RadioGroupItem }
