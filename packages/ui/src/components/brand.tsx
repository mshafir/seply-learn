import * as React from "react"
import { cn } from "cn"

// The Seply brand (spec 7.5). The standalone files live in packages/ui/brand;
// these components draw the same marks with tokens, so they follow the theme.

/** One sepal, pointing up from the centre; the glyph rotates it five times. */
const SEPAL = "M32 31C19.5 26 18.5 11 29.5 2.5C41.5 9 42 24.5 32 31Z"
const ANGLES = [0, 72, 144, 216, 288] as const

/**
 * Five sepals (`--calyx`) in a slight whorl, holding a bud in the product's
 * colour (`--primary`: gentian in Learn). A ring around the bud is cut out of
 * the sepals, so the glyph sits on any surface.
 */
export function SeplyGlyph({
  className,
  ...props
}: React.ComponentProps<"svg">) {
  const maskId = `seply-ring-${React.useId().replace(/[^\w-]/g, "")}`
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={cn("size-6 shrink-0", className)}
      {...props}
    >
      <mask id={maskId}>
        <rect width={64} height={64} fill="white" />
        <circle cx={32} cy={32} r={11} fill="black" />
      </mask>
      <g fill="var(--calyx)" mask={`url(#${maskId})`}>
        {ANGLES.map((angle) => (
          <path
            key={angle}
            d={SEPAL}
            transform={angle ? `rotate(${angle} 32 32)` : undefined}
          />
        ))}
      </g>
      <circle fill="var(--primary)" cx={32} cy={32} r={8.5} />
    </svg>
  )
}

/** The glyph, "Seply" in Newsreader and "Learn" in IBM Plex Sans. */
export function Wordmark({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-xl text-foreground",
        className
      )}
      {...props}
    >
      <SeplyGlyph className="size-[1.4em]" />
      <span className="leading-none">
        <span className="font-reading font-medium [font-variation-settings:'opsz'_72]">
          Seply
        </span>{" "}
        <span className="font-sans text-[0.77em] font-normal text-muted-foreground">
          Learn
        </span>
      </span>
    </span>
  )
}
