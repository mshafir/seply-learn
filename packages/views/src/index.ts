// @umbel/views: see README.md for this package's contract.

// TODO(M1): replace with @umbel/domain types
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

// Live data: an Expedition's @umbel/sync collections → what the Views draw
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

// Anatomy (nested parts with pins; not a canvas)
export { anatomy, anatomyStats, formatAnatomyStats, litParts, type AnatomyModel, type AnatomyPart } from "./anatomy/anatomy.ts";
export { Anatomy, type AnatomyProps } from "./anatomy/Anatomy.tsx";

// Canvas (React Flow 12)
export { Canvas, type CanvasProps, type PositionMemory } from "./canvas/Canvas.tsx";
export { LearningPathCanvas, type LearningPathCanvasProps } from "./canvas/LearningPathCanvas.tsx";
export { ViewCanvas, type ViewCanvasProps } from "./canvas/ViewCanvas.tsx";
export { KindIcon } from "./canvas/KindIcon.tsx";
export { buildEdges } from "./canvas/edges.ts";
