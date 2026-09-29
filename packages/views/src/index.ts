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

// What a canvas View draws, shared by the renderer and the metrics
export { drawnRelationships, type DrawnRelationship } from "./drawn.ts";

// Layout metrics (spec §4.4)
export {
  expeditionLayoutMetrics,
  formatLayoutMetrics,
  layoutMetrics,
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

// Canvas (React Flow 12)
export { Canvas, type CanvasProps } from "./canvas/Canvas.tsx";
export { LearningPathCanvas, type LearningPathCanvasProps } from "./canvas/LearningPathCanvas.tsx";
export { ViewCanvas, type ViewCanvasProps } from "./canvas/ViewCanvas.tsx";
export { KindIcon } from "./canvas/KindIcon.tsx";
export { buildEdges } from "./canvas/edges.ts";
