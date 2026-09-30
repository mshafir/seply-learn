import type * as React from "react"
import { cn } from "cn"

// The Seply brand (spec 7.5). The standalone files live in packages/ui/brand;
// these components draw the same marks with tokens, so they follow the theme.

/** One leaf, a lens pointing up from the centre; the glyph turns it five times. */
const LEAF = "M32 29A12.2 12.2 0 0 1 32 10.2A12.2 12.2 0 0 1 32 29Z"
const ANGLES = [-10, 62, 134, 206, 278] as const

/** Five pale leaves (`--sprout`) in a whorl on a rounded calyx tile (`--calyx`). */
export function SeplyGlyph({
  className,
  ...props
}: React.ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={cn("size-6 shrink-0", className)}
      {...props}
    >
      <rect width={64} height={64} rx={14} fill="var(--calyx)" />
      <g fill="var(--sprout)">
        {ANGLES.map((angle) => (
          <path key={angle} d={LEAF} transform={`rotate(${angle} 32 32)`} />
        ))}
      </g>
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
