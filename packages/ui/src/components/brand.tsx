import type * as React from "react"
import { cn } from "cn"

// The placeholder brand (spec 7.5). The standalone files live in
// packages/ui/brand; these components draw the same marks with tokens, so they
// follow the theme.

const DOTS = [
  [10, 24],
  [20, 15],
  [32, 11],
  [54, 24],
] as const
const ACCENT_DOT = [44, 15] as const

// Placeholder mark until branding lands.
/** The old umbel glyph: stalks radiating from one point to small dots, one in indigo. */
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
      <g
        stroke="var(--foreground)"
        strokeWidth={2.5}
        strokeLinecap="round"
        fill="none"
      >
        <path d="M32 52 L32 61" />
        {[...DOTS, ACCENT_DOT].map(([x, y]) => (
          <path key={`${x}-${y}`} d={`M32 52 L${x} ${y}`} />
        ))}
      </g>
      <g fill="var(--foreground)">
        {DOTS.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={4.5} />
        ))}
      </g>
      <circle
        fill="var(--primary)"
        cx={ACCENT_DOT[0]}
        cy={ACCENT_DOT[1]}
        r={4.5}
      />
    </svg>
  )
}

/** "Seply" in Newsreader and "Learn" in IBM Plex Sans, after the glyph. */
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
        <span className="font-reading font-medium">Seply</span>{" "}
        <span className="font-sans text-[0.85em] font-normal text-muted-foreground">
          Learn
        </span>
      </span>
    </span>
  )
}
