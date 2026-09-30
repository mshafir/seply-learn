// Display names: View Types (docs/view-types/) with their icons, and Kinds.
import { BUILTIN_KINDS, type ViewTypeId } from "@seply/domain"
import {
  BoxesIcon,
  CalendarRangeIcon,
  Grid2x2Icon,
  ListTreeIcon,
  MapIcon,
  NetworkIcon,
  RouteIcon,
  ScaleIcon,
  Table2Icon,
  TrendingUpIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react"

export const VIEW_TYPE_META: Record<
  ViewTypeId,
  { name: string; icon: LucideIcon }
> = {
  "comparison-table": { name: "Comparison Table", icon: Table2Icon },
  outline: { name: "Outline", icon: ListTreeIcon },
  evidence: { name: "Evidence", icon: ScaleIcon },
  "cause-and-effect": { name: "Cause & Effect", icon: WorkflowIcon },
  map: { name: "Map", icon: MapIcon },
  timeline: { name: "Timeline", icon: CalendarRangeIcon },
  anatomy: { name: "Anatomy", icon: BoxesIcon },
  "learning-path": { name: "Learning path", icon: RouteIcon },
  lineage: { name: "Lineage", icon: NetworkIcon },
  quadrant: { name: "Quadrant", icon: Grid2x2Icon },
  rates: { name: "Rates & estimates", icon: TrendingUpIcon },
}

export function viewTypeMeta(id: string) {
  return (
    VIEW_TYPE_META[id as ViewTypeId] ?? { name: id, icon: ListTreeIcon }
  )
}

/** A Kind's label: the Expedition's own definition, else the built-in one. */
export function kindLabel(
  kindId: string,
  kindDefs: readonly { id: string; label?: string }[]
): string {
  const custom = kindDefs.find((k) => k.id === kindId)?.label
  if (custom) return custom
  return BUILTIN_KINDS.find((k) => k.id === kindId)?.label ?? "Concept"
}
