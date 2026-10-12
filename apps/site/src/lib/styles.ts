// Class lists the pages share, all on tokens. Buttons start from @seply/ui's
// buttonVariants and take the mockup's sizes.
import { buttonVariants } from "@seply/ui/components/button"
import { cn } from "@seply/ui/lib/utils"

/** An inline text link. */
export const link =
  "rounded-sm text-primary underline underline-offset-4 hover:no-underline"

/** A standalone link ("Open this View", "Read the MCP guide"). */
export const textLink =
  "w-fit rounded-sm font-medium text-primary hover:underline underline-offset-4"

/** The page width every section shares. */
export const container = "mx-auto w-full max-w-[1120px] px-6"

/** The small mono label above a heading. */
export const eyebrow =
  "font-mono text-xs font-medium tracking-[0.06em] text-muted-foreground uppercase"

/** Section headings. */
export const h2 =
  "m-0 font-reading text-[clamp(30px,3.4vw,38px)] leading-[1.15] font-medium text-balance [font-variation-settings:'opsz'_72]"

export const h3 = "m-0 text-lg font-semibold"

/** Mono labels inside cards and placeholders. */
export const monoLabel =
  "font-mono text-[11px] tracking-[0.06em] text-muted-foreground"

/** The primary call to action, 48 px high. */
export const primaryButton = cn(
  buttonVariants(),
  "h-auto min-h-12 rounded-lg px-[22px] text-base"
)

/** A secondary button on a surface (card colour). */
export const secondaryButton = cn(
  buttonVariants({ variant: "outline" }),
  "h-auto min-h-12 gap-2.5 rounded-lg bg-card px-5 text-base dark:bg-card"
)

/** Code snippets: inverted, on the ink colour. */
export const snippet =
  "m-0 overflow-x-auto rounded-xl bg-foreground px-5 py-[18px] font-mono text-[13px] leading-[1.7] text-background"
