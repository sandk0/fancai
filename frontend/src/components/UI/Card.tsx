import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Card component variants using class-variance-authority
 * 
 * Design system:
 * - Uses CSS custom properties for theming (--color-*)
 * - Consistent rounded-lg corners across all variants
 * - Focus ring uses accent color for accessibility
 * - Interactive variant provides button-like behavior
 */
const cardVariants = cva(
  [
    "rounded-lg",
    "text-[var(--color-text-default)]",
    "transition-colors duration-200",
  ],
  {
    variants: {
      /**
       * Visual style variants
       */
      variant: {
        /** Default card with base background and border */
        default: "bg-[var(--color-bg-base)] border border-[var(--color-border-default)]",
        /** Elevated card with shadow for prominent content */
        elevated: "bg-[var(--color-bg-elevated)] shadow-lg border border-[var(--color-border-default)]",
        /** Outlined card with thicker border, transparent background */
        outlined: "border-2 border-[var(--color-border-default)] bg-transparent",
        /** Subtle card for nested content with muted border */
        subtle: "bg-[var(--color-bg-elevated)] border border-[var(--color-border-subtle)]",
        /** Ghost card with no visible container */
        ghost: "bg-transparent border-transparent",
      },
      /**
       * Padding sizes matching design system spacing
       */
      padding: {
        none: "",
        sm: "p-3",
        md: "p-4",
        lg: "p-6",
      },
      /**
       * Interactive state for clickable cards
       * Adds hover, focus, and active states
       */
      interactive: {
        true: [
          "cursor-pointer",
          "hover:bg-[var(--color-bg-hover)]",
          "hover:border-[var(--color-border-default)]",
          "focus-visible:outline-none",
          "focus-visible:ring-2",
          "focus-visible:ring-[var(--color-accent-500)]",
          "focus-visible:ring-offset-2",
          "ring-offset-[var(--color-bg-base)]",
          "active:bg-[var(--color-bg-emphasis)]",
        ],
        false: "",
      },
      /**
       * Disabled state for non-interactive cards
       */
      disabled: {
        true: "opacity-60 cursor-default pointer-events-none",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      padding: "md",
      interactive: false,
      disabled: false,
    },
  }
)

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  /**
   * Render as child element using Radix Slot
   * When true, Card passes its styles to the child element
   * Useful for rendering Card as button, link, or other semantic elements
   * 
   * @example
   * ```tsx
   * <Card asChild interactive padding="sm">
   *   <button onClick={handleClick}>Clickable card</button>
   * </Card>
   * ```
   */
  asChild?: boolean
}

/**
 * Card - A flexible container component for grouping related content
 * 
 * Supports polymorphism via `asChild` prop for semantic HTML elements.
 * Use `interactive` for clickable cards with proper focus states.
 *
 * @example
 * ```tsx
 * // Basic card
 * <Card variant="elevated" padding="lg">
 *   <CardHeader>
 *     <CardTitle>Title</CardTitle>
 *     <CardDescription>Description text</CardDescription>
 *   </CardHeader>
 *   <CardContent>Main content here</CardContent>
 * </Card>
 * ```
 * 
 * @example
 * ```tsx
 * // Interactive card as button (accessible)
 * <Card asChild interactive variant="subtle" padding="sm">
 *   <button type="button" onClick={handleClick}>
 *     <span>Clickable content</span>
 *   </button>
 * </Card>
 * ```
 * 
 * @example
 * ```tsx
 * // Card as link
 * <Card asChild interactive>
 *   <a href="/path">Navigate to page</a>
 * </Card>
 * ```
 */
const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, padding, interactive, disabled, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div"
    
    return (
      <Comp
        ref={ref}
        className={cn(cardVariants({ variant, padding, interactive, disabled, className }))}
        {...props}
      />
    )
  }
)
Card.displayName = "Card"

/**
 * CardHeader - Container for card title and description
 * Provides consistent spacing between title elements
 */
const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

/**
 * CardTitle - Main heading for the card
 * Uses semibold weight and default text color
 */
const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight text-[var(--color-text-default)]",
      className
    )}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

/**
 * CardDescription - Secondary text below the title
 * Uses muted text color for hierarchy
 */
const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-[var(--color-text-muted)]", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

/**
 * CardContent - Main content area of the card
 * Adds top padding to separate from header
 */
const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("pt-4", className)} {...props} />
))
CardContent.displayName = "CardContent"

/**
 * CardFooter - Footer area for actions or additional info
 * Uses flex layout for action buttons
 */
const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center pt-4", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

/**
 * CardAccent - Left border accent for highlighted content
 * Used for notes, quotes, or emphasized sections
 */
const CardAccent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    /** Accent color variant */
    accentColor?: "primary" | "muted"
  }
>(({ className, accentColor = "primary", ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-lg p-3 pl-4 border-l-2",
      "bg-[var(--color-bg-muted)]/20",
      accentColor === "primary" 
        ? "border-l-[var(--color-accent-500)]" 
        : "border-l-[var(--color-border-default)]",
      className
    )}
    {...props}
  />
))
CardAccent.displayName = "CardAccent"

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAccent,
  cardVariants,
}
