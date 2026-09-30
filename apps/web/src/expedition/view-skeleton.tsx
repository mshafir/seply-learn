// What a View shows on the canvas while it builds (spec §3.5, artboard 02e):
// its own shape first, then the Concepts the build streams in.
//
// - Graph Views (Learning path, Cause & Effect, Evidence, Lineage): reserved
//   slots that the streamed Concepts fill, so nothing jumps.
// - Comparison Table: rows first, cells "?" until they are known.
// - Outline and Anatomy: the structure first (headings, nested parts).
// - Map: the area framed, pins dropping in, open rings for ones still looking.
// - Timeline and Rates: the axis first, items slotting in along it.
// - Quadrant: the grid, cards dropping into it.
//
// Positions here are slots in a fixed pattern, never stored (layouts are
// always computed; the real View lays them out once it is ready).
import type { PreviewNode } from "@seply/domain"
import { Badge } from "@seply/ui/components/badge"
import { Skeleton } from "@seply/ui/components/skeleton"
import { Spinner } from "@seply/ui/components/spinner"
import type { ViewRow } from "@seply/sync"
import { cn } from "@seply/ui/lib/utils"

import { viewTypeMeta } from "@/expedition/labels.ts"

type Family = "graph" | "table" | "structure" | "map" | "axis" | "grid"

function familyOf(viewType: string): Family {
  switch (viewType) {
    case "comparison-table":
      return "table"
    case "outline":
    case "anatomy":
      return "structure"
    case "map":
      return "map"
    case "timeline":
    case "rates":
      return "axis"
    case "quadrant":
      return "grid"
    default:
      return "graph"
  }
}

/** How many slots a skeleton reserves beyond the Concepts already in. */
const SPARE = 6

export function ViewSkeleton({
  view,
  step,
  previewNodes,
  building,
}: {
  view: ViewRow
  step: string
  previewNodes: PreviewNode[]
  /** False while queued: the shape only, not pulsing. */
  building: boolean
}) {
  const meta = viewTypeMeta(view.viewType)
  const family = familyOf(view.viewType)
  const nodes = previewNodes
  const count = nodes.length
  return (
    <div
      data-testid="view-building"
      data-view-type={view.viewType}
      data-family={family}
      className="flex size-full flex-col gap-4 overflow-auto px-6 pt-21 pb-6"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={building ? "progress" : "queued"}>
          {building ? <Spinner className="size-3" /> : null}
          {building ? "Building" : "Queued"}
        </Badge>
        <span data-testid="building-step" className="text-muted-foreground">
          {step}
          {building && count > 0
            ? ` · ${count} ${count === 1 ? "Concept" : "Concepts"} so far`
            : ""}
        </span>
      </div>
      <div
        aria-label={`${view.label || meta.name}, building`}
        className="relative min-h-0 flex-1"
      >
        {family === "graph" && <GraphSlots nodes={nodes} pulse={building} />}
        {family === "table" && <TableRows nodes={nodes} pulse={building} />}
        {family === "structure" && (
          <StructureLines nodes={nodes} pulse={building} />
        )}
        {family === "map" && <MapPins nodes={nodes} pulse={building} />}
        {family === "axis" && <AxisItems nodes={nodes} pulse={building} />}
        {family === "grid" && <GridCards nodes={nodes} pulse={building} />}
      </div>
    </div>
  )
}

type Part = { nodes: PreviewNode[]; pulse: boolean }

function Streamed({
  node,
  className,
}: {
  node: PreviewNode
  className?: string
}) {
  return (
    <div
      data-testid="preview-node"
      className={cn(
        "animate-in truncate rounded-lg border bg-card px-3 py-2 text-sm font-medium text-card-foreground shadow-xs duration-300 fade-in-0 zoom-in-95 motion-reduce:animate-none",
        className
      )}
      title={node.title}
    >
      {node.title}
    </div>
  )
}

function Placeholder({
  pulse,
  className,
}: {
  pulse: boolean
  className?: string
}) {
  return (
    <Skeleton
      data-testid="reserved-slot"
      className={cn(
        "border border-dashed border-border bg-muted/60",
        !pulse && "animate-none",
        className
      )}
    />
  )
}

/** Reserved slots in staggered columns; streamed Concepts take them in order. */
function GraphSlots({ nodes, pulse }: Part) {
  const slots = Math.max(12, nodes.length + SPARE)
  return (
    <div className="grid grid-cols-2 gap-x-10 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: slots }, (_, i) => (
        <div key={i} className={cn("h-11", i % 2 === 1 && "translate-y-6")}>
          {nodes[i] ? (
            <Streamed node={nodes[i]} className="h-11" />
          ) : (
            <Placeholder pulse={pulse} className="h-11" />
          )}
        </div>
      ))}
    </div>
  )
}

const TABLE_COLUMNS = 3

/** Rows first; cells stay "?" until the build fills them. */
function TableRows({ nodes, pulse }: Part) {
  const spare = Math.max(0, 6 - nodes.length)
  return (
    <table className="w-full max-w-3xl border-separate border-spacing-y-1 text-sm">
      <thead>
        <tr>
          <th className="w-1/3 pr-4 text-left">
            <Skeleton className={cn("h-4 w-24", !pulse && "animate-none")} />
          </th>
          {Array.from({ length: TABLE_COLUMNS }, (_, c) => (
            <th key={c} className="pr-4 text-left">
              <Skeleton className={cn("h-4 w-20", !pulse && "animate-none")} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {nodes.map((n) => (
          <tr key={n.id}>
            <td className="pr-4">
              <Streamed node={n} />
            </td>
            {Array.from({ length: TABLE_COLUMNS }, (_, c) => (
              <td
                key={c}
                className="rounded-md border border-dashed px-3 text-muted-foreground"
              >
                ?
              </td>
            ))}
          </tr>
        ))}
        {Array.from({ length: spare }, (_, i) => (
          <tr key={`spare-${i}`}>
            <td colSpan={TABLE_COLUMNS + 1}>
              <Placeholder pulse={pulse} className="h-9" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Headings and nested lines; streamed Concepts take the lines in order. */
function StructureLines({ nodes, pulse }: Part) {
  const lines = Math.max(9, nodes.length + SPARE)
  return (
    <div className="flex max-w-2xl flex-col gap-2">
      {Array.from({ length: lines }, (_, i) => {
        const depth = i % 3 === 0 ? 0 : 1
        return (
          <div key={i} style={{ paddingLeft: `${depth * 1.5}rem` }}>
            {nodes[i] ? (
              <Streamed
                node={nodes[i]}
                className={depth ? "" : "font-semibold"}
              />
            ) : (
              <Placeholder
                pulse={pulse}
                className={cn("h-9", depth ? "w-3/4" : "w-1/2")}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/** A fixed scatter of pin places (fractions of the frame). */
const PIN_PLACES = [
  [0.22, 0.3],
  [0.62, 0.22],
  [0.45, 0.55],
  [0.78, 0.62],
  [0.3, 0.72],
  [0.12, 0.5],
  [0.55, 0.8],
  [0.86, 0.35],
] as const

/** The area framed first; pins drop in, open rings where one is still looking. */
function MapPins({ nodes, pulse }: Part) {
  const shown = nodes.slice(0, PIN_PLACES.length)
  return (
    <div className="relative h-full min-h-72 overflow-hidden rounded-xl border bg-muted/50">
      {PIN_PLACES.map(([x, y], i) => {
        const node = shown[i]
        return (
          <div
            key={i}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5"
            style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
          >
            {node ? (
              <>
                <span className="size-3 rounded-full bg-suggested shadow-sm" />
                <span
                  data-testid="preview-node"
                  className="animate-in rounded-full border bg-card px-2 py-0.5 text-xs font-medium fade-in-0 slide-in-from-top-2 motion-reduce:animate-none"
                >
                  {node.title}
                </span>
              </>
            ) : (
              <span
                data-testid="reserved-slot"
                className={cn(
                  "size-3 rounded-full border-2 border-muted-foreground/40",
                  pulse && "animate-pulse motion-reduce:animate-none"
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The axis first; items slot in along it. */
function AxisItems({ nodes, pulse }: Part) {
  const slots = Math.max(6, nodes.length + 2)
  return (
    <div className="flex h-full min-h-60 flex-col justify-end gap-3">
      <div className="flex flex-col gap-2">
        {Array.from({ length: slots }, (_, i) => (
          <div
            key={i}
            style={{ marginLeft: `${((i * 37) % 60) + 2}%` }}
            className="w-1/3 min-w-40"
          >
            {nodes[i] ? (
              <Streamed node={nodes[i]} />
            ) : (
              <Placeholder pulse={pulse} className="h-8" />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-end justify-between border-t-2 border-border pt-1">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className="h-2 w-px bg-border" />
        ))}
      </div>
    </div>
  )
}

/** A dashed 2×2 grid; cards drop into its cells. */
function GridCards({ nodes, pulse }: Part) {
  return (
    <div className="grid h-full min-h-72 grid-cols-2 grid-rows-2 gap-3">
      {[0, 1, 2, 3].map((cell) => {
        const inCell = nodes.filter((_, i) => i % 4 === cell)
        return (
          <div
            key={cell}
            className="flex flex-col gap-2 rounded-xl border border-dashed p-3"
          >
            {inCell.map((n) => (
              <Streamed key={n.id} node={n} />
            ))}
            {inCell.length === 0 && (
              <Placeholder pulse={pulse} className="h-9 w-2/3" />
            )}
          </div>
        )
      })}
    </div>
  )
}
