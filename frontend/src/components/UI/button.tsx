import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Spinner component for loading states
 * Uses currentColor to inherit text color from parent
 */
const Spinner = React.memo(function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-spin", className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
})

/**
 * Button variants using class-variance-authority (cva)
 *
 * Design system requirements:
 * - Minimum 44px touch target (h-11) per Apple HIG
 * - Uses CSS custom properties for theming
 * - Focus styles with ring-2 and ring-offset
 */
const buttonVariants = cva(
  // Base styles
  [
    "inline-flex items-center justify-center gap-2",
    "whitespace-nowrap rounded-lg",
    "text-sm font-medium",
    "transition-all duration-200",
    // Focus styles with ring
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    "focus-visible:ring-[var(--color-accent-500)]",
    "ring-offset-[var(--color-bg-base)]",
    // Disabled state
    "disabled:pointer-events-none disabled:opacity-50",
    // Touch handling
    "touch-action-manipulation",
    // SVG children sizing
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        /**
         * Primary - Main CTA, uses accent color
         */
        primary: [
          "bg-[var(--color-accent-600)] text-white",
          "hover:bg-[var(--color-accent-700)]",
          "active:bg-[var(--color-accent-700)]",
          "shadow-sm hover:shadow-md",
        ],
        /**
         * Secondary - Less prominent actions
         */
        secondary: [
          "bg-[var(--color-bg-emphasis)] text-[var(--color-text-default)]",
          "hover:bg-[var(--color-border-default)]",
          "active:bg-[var(--color-border-default)]",
          "border border-[var(--color-border-default)]",
        ],
        /**
         * Ghost - Minimal visual weight
         */
        ghost: [
          "bg-transparent text-[var(--color-text-default)]",
          "hover:bg-[var(--color-bg-muted)]",
          "active:bg-[var(--color-bg-emphasis)]",
        ],
        /**
         * Destructive - Dangerous actions (delete, remove)
         */
        destructive: [
          "bg-[var(--color-error)] text-white",
          "hover:bg-[var(--color-error)]/90",
          "active:bg-[var(--color-error)]/80",
          "shadow-sm",
        ],
        /**
         * Outline - Bordered button with transparent background
         */
        outline: [
          "bg-transparent text-[var(--color-text-default)]",
          "border border-[var(--color-border-default)]",
          "hover:bg-[var(--color-bg-subtle)]",
          "hover:border-[var(--color-accent-500)]",
          "active:bg-[var(--color-bg-muted)]",
        ],
        /**
         * Link - Text-only button that looks like a link
         */
        link: [
          "bg-transparent text-[var(--color-accent-600)]",
          "underline-offset-4 hover:underline",
          "p-0 h-auto",
        ],
      },
      size: {
        /**
         * Small - 36px height, for compact UIs
         */
        sm: "h-9 px-3 text-xs",
        /**
         * Medium (default) - 44px height, minimum touch target
         */
        md: "h-11 px-4 py-2",
        /**
         * Large - 48px height, prominent actions
         */
        lg: "h-12 px-8 text-base",
        /**
         * Icon - 44px square, for icon-only buttons
         */
        icon: "h-11 w-11 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render as child element (Slot) instead of button */
  asChild?: boolean
  /** Show loading spinner and disable interactions */
  isLoading?: boolean
  /** Accessible label for loading state */
  loadingText?: string
}

/**
 * Button component with multiple variants and sizes
 *
 * @example
 * // Primary button (default)
 * <Button>Click me</Button>
 *
 * @example
 * // Secondary button with loading state
 * <Button variant="secondary" isLoading>
 *   Saving...
 * </Button>
 *
 * @example
 * // Icon button
 * <Button variant="ghost" size="icon" aria-label="Close">
 *   <XIcon />
 * </Button>
 *
 * @example
 * // As link (using Slot)
 * <Button asChild variant="link">
 *   <a href="/path">Go to page</a>
 * </Button>
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      isLoading = false,
      loadingText,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button"
    const isDisabled = disabled || isLoading

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={isLoading}
        {...props}
      >
        {isLoading ? (
          <>
            <Spinner className="size-4" />
            {loadingText && <span>{loadingText}</span>}
            {!loadingText && children && (
              <span className="sr-only">{children}</span>
            )}
          </>
        ) : (
          children
        )}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, Spinner }
