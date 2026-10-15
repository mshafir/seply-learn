// An Expedition card (spec §3.2, §3.13): the fixed thumbnail of the best
// View's View Type, the title (a link over the whole card), the summary,
// then whatever the screen adds, and a footer with the counts and the date.
// The Library adds collaborators, a pin and badges; Explore adds Tags.
import * as React from "react"
import { Link } from "wouter"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@seply/ui/components/card"
import { ViewTypeThumbnail } from "@seply/ui/components/view-type-thumbnail"
import { cn } from "@seply/ui/lib/utils"

import { cardLink, when } from "@/lib/cards.ts"
import { countsLabel } from "@/screens/library-sections.ts"

export type CardBasics = {
  title: string
  summary: string
  counts: { concepts: number; views: number }
  bestViewType: string | null
  updatedAt: string
}

export function ExpeditionCard({
  card,
  href,
  action,
  children,
  badges,
}: {
  card: CardBasics
  href: string
  /** Top right, above the stretched link (e.g. the offline pin). */
  action?: React.ReactNode
  /** Between the summary and the footer. */
  children?: React.ReactNode
  /** In the footer, around the counts. */
  badges?: { before?: React.ReactNode; after?: React.ReactNode }
}) {
  return (
    <Card
      data-testid="expedition-card"
      className="relative h-full pt-0 transition-colors hover:bg-accent/60"
    >
      <div className="flex h-32 items-center justify-center border-b bg-sidebar px-6 py-3">
        <ViewTypeThumbnail
          viewType={card.bestViewType}
          className="max-h-full w-auto"
        />
      </div>
      <CardHeader>
        <CardTitle className="font-reading text-xl font-medium">
          <Link href={href} className={cardLink}>
            {card.title || "Untitled Expedition"}
          </Link>
        </CardTitle>
        {action && <CardAction>{action}</CardAction>}
        {card.summary && (
          <CardDescription className="line-clamp-2">
            {card.summary}
          </CardDescription>
        )}
      </CardHeader>
      {children && <CardContent className="mt-auto">{children}</CardContent>}
      <CardFooter
        className={cn(
          "flex-wrap gap-x-3 gap-y-1 text-muted-foreground",
          !children && "mt-auto"
        )}
      >
        {badges?.before}
        <span data-testid="card-counts">{countsLabel(card.counts)}</span>
        {badges?.after}
        <span className="ml-auto">{when(card.updatedAt)}</span>
      </CardFooter>
    </Card>
  )
}
