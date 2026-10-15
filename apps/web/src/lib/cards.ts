// What Expedition cards share (components/expedition-card.tsx): the date
// format, the stretched link and the grid.

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" })

/** "Today, 9:14 PM" or "Sep 23, 2026". */
export function when(iso: string): string {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString()
    ? `Today, ${timeFormat.format(d)}`
    : dateFormat.format(d)
}

/** A link stretched over its card (the card is `relative`). */
export const cardLink =
  "outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-3 focus-visible:after:ring-ring/50"

/** The grid cards sit in. */
export const cardGrid =
  "grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-4"
