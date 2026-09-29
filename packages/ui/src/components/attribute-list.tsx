// Divergence 7 (DIVERGENCES.md): a Concept's Attributes as a key/value list.
// A semantic <dl> in two label/value columns, styled with tokens.
import type * as React from "react"
import { cn } from "cn"

export type AttributeListItem = { id: string; label: string; value: string }

function AttributeList({
  items,
  className,
  ...props
}: { items: readonly AttributeListItem[] } & React.ComponentProps<"dl">) {
  return (
    <dl
      data-slot="attribute-list"
      className={cn(
        "grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-lg bg-muted/50 px-3 py-2.5 text-sm",
        className
      )}
      {...props}
    >
      {items.map((item) => (
        <div key={item.id} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="font-medium break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export { AttributeList }
