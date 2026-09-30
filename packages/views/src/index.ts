// @seply/views: see README.md for this package's contract.

// TODO(M1): replace with @seply/domain types
export * from "./model.ts";

// Scope and structure
export {
  computeWeights,
  learningMap,
  learningScope,
  leversOf,
  matchesFilter,
  readingOrder,
  scopeFor,
  sign,
  topicRoots,
  trace,
  type LearningMap,
  type NetEffect,
  type Scope,
  type Topic,
  type Trace,
} from "./scope.ts";

// Pure layouts
export {
  canonicalScope,
  conceptSize,
  layout,
  nodeSize,
  type Band,
  type Extras,
  type LayoutResult,
  type Point,
  type Positions,
  type Tick,
  type Visible,
} from "./layouts.ts";

// Straight-line geometry, shared by the layouts' tidy-up and the metrics
export { drawnCost, untangle } from "./geometry.ts";

// What a canvas View draws, shared by the renderer and the metrics
export { drawnRelationships, type DrawnRelationship } from "./drawn.ts";

// Layout metrics (spec §4.4)
export {
  expeditionLayoutMetrics,
  formatLayoutMetrics,
  layoutMetrics,
  overlappingConcepts,
  READS_WELL,
  type LayoutMetrics,
} from "./metrics.ts";

// What a reader sees, as text, with layout metrics: the curator's ViewReader
// (also `@seply/views/inspect`, without React)
export { expeditionFromState, MAX_LINES, readView, type ViewReading } from "./inspect.ts";

// Overlays
export {
  actsOn,
  badgesFor,
  focusTree,
  learningPathOverlay,
  steps,
  type Badge,
  type BadgeTone,
  type LearningPathState,
  type Overlay,
} from "./overlay.ts";

// Live data: an Expedition's @seply/sync collections → what the Views draw
export { expeditionFromRows, type ExpeditionRows } from "./data.ts";
export { readExpedition, useLiveExpedition, type ExpeditionCollections } from "./live.ts";

// The component the app mounts: live collections + the selected View
export {
  ExpeditionView,
  pickView,
  ViewRenderer,
  type ExpeditionViewProps,
  type ReaderInteraction,
  type ViewInteraction,
  type ViewStatusChip,
  type ViewRendererProps,
} from "./ExpeditionView.tsx";

// Comparison Table
export {
  comparisonTable,
  formatValue,
  verdictTone,
  type ComparisonTableModel,
  type Standing,
  type TableBand,
  type TableCell,
  type TableColumn,
  type TableRow,
  type VerdictTone,
} from "./table.ts";
export { ComparisonTable, type ComparisonTableProps } from "./table/ComparisonTable.tsx";

// Outline, Quadrant, Rates & estimates
export {
  ancestorsOf,
  defaultOpen,
  outlineTree,
  UNSORTED,
  type OutlineItem,
  type OutlineModel,
  type OutlineOptions,
  type OutlineViewSettings,
} from "./outline/outline.ts";
export { Outline, type OutlineProps } from "./outline/Outline.tsx";
export { quadrantGrid, type QuadrantAxis, type QuadrantCard, type QuadrantModel, type QuadrantViewSettings } from "./quadrant/quadrant.ts";
export { Quadrant, type QuadrantProps } from "./quadrant/Quadrant.tsx";
export { logAxis, rateLabel, ratesModel, type LogAxis, type RateEstimate, type RatesModel, type RatesViewSettings } from "./rates/rates.ts";
export { Rates, type RatesProps } from "./rates/Rates.tsx";
// Anatomy (nested parts with pins; not a canvas)
export { anatomy, anatomyStats, formatAnatomyStats, litParts, type AnatomyModel, type AnatomyPart } from "./anatomy/anatomy.ts";
export { Anatomy, type AnatomyProps } from "./anatomy/Anatomy.tsx";

// Canvas (React Flow 12)
export { Canvas, type CanvasProps, type PositionMemory } from "./canvas/Canvas.tsx";
export { LearningPathCanvas, type LearningPathCanvasProps } from "./canvas/LearningPathCanvas.tsx";
export { ViewCanvas, type ViewCanvasProps } from "./canvas/ViewCanvas.tsx";
export { KindIcon } from "./canvas/KindIcon.tsx";
export { buildEdges } from "./canvas/edges.ts";

// Map (MapLibre + our PMTiles) and Timeline (vis-timeline): pure models here;
// ExpeditionView loads their renderers lazily.
export { mapModel, placeLabels, type MapModel, type Pin } from "./map/pins.ts";
export {
  fallbackStyleUrl,
  OPENFREEMAP_STYLES,
  PROTOMAPS_ASSETS,
  protomapsStyle,
  withCoarseWorld,
  type BasemapConfig,
  type MapTheme,
} from "./map/basemap.ts";
export {
  formatCalendarDate,
  formatWhen,
  parseCalendarDate,
  timelineModel,
  type CalendarDate,
  type Precision,
  type TimelineItem,
  type TimelineLane,
  type TimelineModel,
} from "./timeline/items.ts";
