// The live embed's View (spec §9.3), loaded lazily by embed-screen.tsx: one
// View of the Expedition, read-only, with a small card for the clicked
// Concept and a link to the full Expedition. No editing, panels or rail.
import * as React from "react"
import { ExternalLinkIcon, XIcon } from "lucide-react"
import type { EngineCollections } from "@seply/sync"
import { ExpeditionView, useLiveExpedition } from "@seply/views"

import { SeplyGlyph } from "@seply/ui/components/brand"
import { Button, buttonVariants } from "@seply/ui/components/button"
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@seply/ui/components/card"

import { useBasemap } from "@/lib/basemap"
import { appHref } from "./params.ts"

export default function EmbedView({
  expeditionId,
  collections,
  viewId,
}: {
  expeditionId: string
  collections: EngineCollections
  viewId: string | null
}) {
  const expedition = useLiveExpedition(collections)
  const basemap = useBasemap()
  const [selected, setSelected] = React.useState<string | null>(null)
  // The asked-for View, else the first in the rail.
  const view =
    expedition.views.find((v) => v.id === viewId) ?? expedition.views[0]
  const concept = selected
    ? expedition.concepts.find((c) => c.id === selected)
    : undefined

  React.useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selected])

  return (
    <div className="flex h-svh min-h-0 flex-col bg-background text-foreground">
      <div className="relative min-h-0 flex-1" data-testid="embed-view">
        {view ? (
          <ExpeditionView
            collections={collections}
            viewId={view.id}
            selected={selected ?? undefined}
            onSelect={(id) => setSelected(id ?? null)}
            basemap={basemap}
          />
        ) : (
          <p className="flex size-full items-center justify-center p-6 text-sm text-muted-foreground">
            This Expedition has no Views yet.
          </p>
        )}
        {concept && (
          <Card
            size="sm"
            role="dialog"
            aria-label={concept.title}
            data-testid="embed-concept-card"
            className="absolute right-3 bottom-3 z-10 w-80 max-w-[calc(100%-1.5rem)] shadow-lg"
          >
            <CardHeader>
              <CardTitle>{concept.title}</CardTitle>
              <CardDescription>
                {concept.summary || "No summary yet."}
              </CardDescription>
              <CardAction>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Close"
                  onClick={() => setSelected(null)}
                >
                  <XIcon />
                </Button>
              </CardAction>
            </CardHeader>
          </Card>
        )}
      </div>
      <footer className="flex h-9 shrink-0 items-center gap-2 border-t px-3 text-xs text-muted-foreground">
        <SeplyGlyph className="size-4" />
        <span className="min-w-0 flex-1 truncate" data-testid="embed-title">
          {expedition.title}
          {view ? ` · ${view.label}` : ""}
        </span>
        <a
          href={appHref(location.origin, expeditionId, view?.id ?? null)}
          target="_blank"
          rel="noopener"
          className={buttonVariants({ variant: "ghost", size: "xs" })}
        >
          Open in Seply Learn
          <ExternalLinkIcon data-icon="inline-end" />
        </a>
      </footer>
    </div>
  )
}
