// @seply/ai: see README.md for this package's contract.

// The curator's tools and checks (spec §5.3)
export {
  createCuratorTools,
  TOOL_NAMES,
  type CommitResult,
  type CuratorCommit,
  type CuratorTool,
  type CuratorToolSet,
  type CuratorToolsOptions,
  type ToolResult,
} from "./tools.ts"
export { Stage, type StageResult } from "./stage.ts"
export { inspectView, type ViewInspection } from "./inspect.ts"
export {
  checkExpedition,
  checkView,
  MIN_FILL,
  MIN_ROWS,
  type Finding,
} from "./checks/index.ts"
export { normalizeTitle, searchExisting, type SearchHit } from "./search.ts"
export {
  memorySourceReader,
  type LayoutReport,
  type Segment,
  type SourceReader,
  type ViewReader,
  type ViewReading,
} from "./ports.ts"
