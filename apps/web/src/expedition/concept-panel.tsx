// The Concept panel's reading content (spec §3.7, canvas 04). Two places on
// the back stack: the overview depth (summary, Attributes, the overview in
// Newsreader, Relationships both ways) and the article depth (its sections).
// Each overview and section carries a provenance badge, which opens the
// Source viewer at the cited segment. In-text `#c/` links and Relationship
// links push onto the back stack.
import * as React from "react"
import {
  ArrowLeftIcon,
  BookOpenIcon,
  CheckCheckIcon,
  CheckIcon,
} from "lucide-react"
import { Link } from "wouter"

import type { ReadingState } from "@seply/domain"
import { AttributeList } from "@seply/ui/components/attribute-list"
import { Badge } from "@seply/ui/components/badge"
import { Button } from "@seply/ui/components/button"
import { ToggleGroup, ToggleGroupItem } from "@seply/ui/components/toggle-group"
import { kindColor } from "@seply/ui/lib/kinds"
import type { ArticleSectionRow, ConceptRow } from "@seply/sync"

import { Prose } from "@/expedition/prose.tsx"
import {
  attributeItems,
  provenanceLabel,
  readingMinutes,
  relationshipGroups,
  type PanelEntry,
  type RelationshipGroup,
} from "@/expedition/reading.ts"
import type { ExpeditionData } from "@/expedition/use-expedition-data.ts"

/** What the Concept panel reads from, and how it moves. */
export type ConceptReading = {
  data: ExpeditionData
  conceptById: ReadonlyMap<string, ConceptRow>
  /** Pushes onto the back stack. */
  onNavigate: (entry: PanelEntry) => void
  /** Pops the back stack; null on its first entry. */
  onBack: (() => void) | null
  /** Where Back goes, for its label. */
  previous: PanelEntry | null
  /** Opens the Source viewer at a provenance ref. */
  onOpenSource: (ref: { source: string; segment: string }) => void
}

/**
 * Reading status (spec §3.7): Not read yet / Read / I knew this. It belongs
 * to the reader, not the Expedition, and shows as a check in every View.
 */
export function ReadingStatusControl({
  state,
  onChange,
  signInHref,
}: {
  state: ReadingState
  onChange: (state: ReadingState) => void
  /** Anonymous and has marked something: where "Sign in" goes. */
  signInHref?: string | null
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <ToggleGroup
        aria-label="Reading status"
        data-testid="reading-status"
        data-state={state}
        variant="outline"
        size="sm"
        spacing={0}
        value={[state]}
        onValueChange={(value: unknown[]) => {
          const next = value[0] as ReadingState | undefined
          if (next && next !== state) onChange(next)
        }}
      >
        <ToggleGroupItem value="unread">Not read yet</ToggleGroupItem>
        <ToggleGroupItem value="read">
          <CheckIcon />
          Read
        </ToggleGroupItem>
        <ToggleGroupItem value="known">
          <CheckCheckIcon />I knew this
        </ToggleGroupItem>
      </ToggleGroup>
      {signInHref && (
        <p data-testid="sign-in-hint" className="text-xs text-muted-foreground">
          <Link
            href={signInHref}
            className="font-medium text-foreground underline underline-offset-2"
          >
            Sign in
          </Link>{" "}
          to keep your progress across devices.
        </p>
      )}
    </div>
  )
}

/** "← Back to overview" / "← Back to <Concept>", above the header. */
export function BackBar({
  reading,
  concept,
}: {
  reading: ConceptReading
  concept: ConceptRow
}) {
  const { onBack, previous } = reading
  if (!onBack || !previous) return null
  const target =
    previous.conceptId === concept.id
      ? previous.depth === "article"
        ? "the article"
        : "overview"
      : (reading.conceptById.get(previous.conceptId)?.title ?? "previous")
  return (
    <div className="border-b px-3 py-1.5">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        data-testid="panel-back"
        className="max-w-full text-muted-foreground"
      >
        <ArrowLeftIcon />
        <span className="truncate">Back to {target}</span>
      </Button>
    </div>
  )
}

/** Aliases and Tags, under the title. */
export function ConceptHeaderExtras({ concept }: { concept: ConceptRow }) {
  if (concept.aliases.length === 0 && concept.tags.length === 0) return null
  return (
    <>
      {concept.aliases.length > 0 && (
        <p
          data-testid="concept-aliases"
          className="text-sm text-muted-foreground"
        >
          Also called {concept.aliases.join(", ")}
        </p>
      )}
      {concept.tags.length > 0 && (
        <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
          {concept.tags.map((tag) => (
            <li key={tag}>
              <Badge variant="secondary">#{tag}</Badge>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function ProvenanceBadge({
  prov,
  reading,
  of,
}: {
  prov: ConceptRow["prov"]
  reading: ConceptReading
  /** What it describes, for screen readers ("the overview"). */
  of: string
}) {
  const label = provenanceLabel(prov, reading.data.sources)
  const ref = label.ref
  // A ref to a Source this Expedition has opens the Source viewer there.
  const opens = !!ref && reading.data.sources.some((s) => s.id === ref.source)
  return (
    <Badge
      variant={label.kind}
      data-testid="provenance"
      data-provenance={label.kind}
      data-source={ref?.source}
      data-segment={ref?.segment}
      aria-label={`Provenance of ${of}: ${label.text}${opens ? " (open the Source)" : ""}`}
      className="self-start"
      render={
        opens ? (
          <a
            href={`?${new URLSearchParams({ source: ref.source, segment: ref.segment })}`}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return
              event.preventDefault()
              reading.onOpenSource(ref)
            }}
          />
        ) : undefined
      }
    >
      {label.text}
    </Badge>
  )
}

function ConceptLink({
  id,
  children,
  onNavigate,
}: {
  id: string
  children: React.ReactNode
  onNavigate: ConceptReading["onNavigate"]
}) {
  return (
    <a
      href={`#c/${encodeURIComponent(id)}`}
      data-concept-link={id}
      className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return
        event.preventDefault()
        onNavigate({ conceptId: id, depth: "overview" })
      }}
    >
      {children}
    </a>
  )
}

function RelationshipList({
  heading,
  groups,
  onNavigate,
}: {
  heading: string
  groups: RelationshipGroup[]
  onNavigate: ConceptReading["onNavigate"]
}) {
  if (groups.length === 0) return null
  return (
    <section aria-label={heading} className="flex flex-col gap-1.5 text-sm">
      <h3 className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
        {heading}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {groups.map((g) => (
          <li key={`${g.direction}|${g.typeId}`} data-testid="relationship">
            <span
              className="font-medium"
              style={g.color ? { color: kindColor(g.color) } : undefined}
            >
              {g.phrase}
            </span>{" "}
            {g.concepts.map((c, i) => (
              <React.Fragment key={c.id}>
                {i > 0 && ", "}
                <ConceptLink id={c.id} onNavigate={onNavigate}>
                  {c.title}
                </ConceptLink>
                {c.note && (
                  <span className="text-muted-foreground"> ({c.note})</span>
                )}
              </React.Fragment>
            ))}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The overview depth: summary, Attributes, overview, article link, Relationships. */
export function ConceptOverview({
  concept,
  reading,
  sections,
}: {
  concept: ConceptRow
  reading: ConceptReading
  sections: readonly ArticleSectionRow[]
}) {
  const { data, conceptById, onNavigate } = reading
  const attributes = attributeItems(concept, data.attributeDefs)
  const relationships = React.useMemo(
    () =>
      relationshipGroups(
        concept.id,
        data.relationships,
        conceptById,
        data.relTypeDefs
      ),
    [concept.id, data.relationships, conceptById, data.relTypeDefs]
  )
  const exists = (id: string) => conceptById.has(id)
  const follow = (id: string) =>
    onNavigate({ conceptId: id, depth: "overview" })

  return (
    <div data-testid="concept-overview" className="flex flex-col gap-5">
      {concept.summary && (
        <p className="text-[0.95rem] leading-snug font-medium text-foreground/80">
          {concept.summary}
        </p>
      )}
      {attributes.length > 0 && <AttributeList items={attributes} />}
      {concept.overview ? (
        <div className="flex min-w-0 flex-col gap-2">
          <Prose
            md={concept.overview}
            onConceptLink={follow}
            conceptExists={exists}
            data-testid="overview"
          />
          <ProvenanceBadge
            prov={concept.overviewProv}
            reading={reading}
            of="the overview"
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No overview yet.</p>
      )}
      {sections.length > 0 && (
        <Button
          variant="outline"
          className="h-auto justify-start gap-3 px-3.5 py-3 text-left"
          onClick={() =>
            onNavigate({ conceptId: concept.id, depth: "article" })
          }
        >
          <BookOpenIcon className="size-5! text-primary" />
          <span className="flex flex-col">
            <span className="font-semibold">Read the full article</span>
            <span className="text-xs font-normal text-muted-foreground">
              ~{readingMinutes(sections.map((s) => s.md))} min
            </span>
          </span>
        </Button>
      )}
      <RelationshipList
        heading="Links to"
        groups={relationships.out}
        onNavigate={onNavigate}
      />
      <RelationshipList
        heading="Linked from"
        groups={relationships.in}
        onNavigate={onNavigate}
      />
    </div>
  )
}

const sectionAnchor = (id: string) => `section-${id.replace(/[^\w-]/g, "_")}`

/** Headings of the article's sections, as jump links, under the title. */
export function ArticleContents({
  sections,
}: {
  sections: readonly ArticleSectionRow[]
}) {
  const headed = sections.filter((s) => s.heading)
  if (headed.length < 2) return null
  return (
    <nav aria-label="Sections" className="-mx-2 flex flex-wrap gap-x-1">
      {headed.map((s) => (
        <Button
          key={s.id}
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={() =>
            document
              .getElementById(sectionAnchor(s.id))
              ?.scrollIntoView({ block: "start", behavior: "smooth" })
          }
        >
          {s.heading}
        </Button>
      ))}
    </nav>
  )
}

/** The article depth: every section, each with its provenance badge. */
export function ConceptArticle({
  reading,
  sections,
}: {
  reading: ConceptReading
  sections: readonly ArticleSectionRow[]
}) {
  const { conceptById, onNavigate } = reading
  const exists = (id: string) => conceptById.has(id)
  const follow = (id: string) =>
    onNavigate({ conceptId: id, depth: "overview" })
  if (sections.length === 0)
    return <p className="text-sm text-muted-foreground">No article yet.</p>
  return (
    <div data-testid="concept-article" className="flex flex-col gap-6">
      {sections.map((s) => (
        <section
          key={s.id}
          id={sectionAnchor(s.id)}
          aria-label={s.heading || "Introduction"}
          data-testid="article-section"
          className="flex min-w-0 scroll-mt-4 flex-col gap-2"
        >
          {s.heading && (
            <h3 className="font-reading text-lg leading-snug font-semibold">
              {s.heading}
            </h3>
          )}
          <Prose md={s.md} onConceptLink={follow} conceptExists={exists} />
          <ProvenanceBadge
            prov={s.prov}
            reading={reading}
            of={s.heading ? `“${s.heading}”` : "the introduction"}
          />
        </section>
      ))}
    </div>
  )
}
