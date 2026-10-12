// The landing page's repeated content: the How it works steps, the Views
// gallery tabs and the Examples. Copy is the approved mockup's, word for word.
import type { ImageSlotId } from "../media"
import { APP_URL } from "../lib/env"

/** The public showcase Expeditions on learn.seply.app (spec 9.4). */
export const SHOWCASE = {
  compute: "01M3STC1773KBXQTHN2R4XRERR",
  ebike: "01M3VTGRE7ZTFR1CZTM80555C3",
  swissRail: "01M3SXS5ZJRK9P48Z849QRJBVE",
} as const

export const expeditionUrl = (id: string) => `${APP_URL}/e/${id}`

export const GITHUB_URL = "https://github.com/mshafir/seply-learn"
export const MCP_GUIDE_URL = `${GITHUB_URL}/blob/main/docs/spec/v1/06-mcp.md`
export const RELEASES_URL = `${GITHUB_URL}/releases`

export const STEPS: { title: string; body: string; shot: ImageSlotId }[] = [
  {
    title: "1. Start with a question",
    body: "Ask in the app, or ask your agent through MCP. If you already have chats, files or links on the subject, you can add them too.",
    shot: "how-question",
  },
  {
    title: "2. Seply Learn builds an Expedition",
    body: "The curator works out the Concepts involved and how they relate to each other. It notes where each one came from, so you can check it.",
    shot: "how-build",
  },
  {
    title: "3. Read it in the way that suits you",
    body: "Each View answers one question, such as what to learn first or how two options compare. Views are laid out automatically from the same Concepts, so they stay up to date as the Expedition grows.",
    shot: "how-read",
  },
]

export const GALLERY: {
  id: string
  label: string
  kicker: string
  question: string
  shot: ImageSlotId
  href: string
}[] = [
  {
    id: "learning-path",
    label: "Learning path",
    kicker: "AI COMPUTE · LEARNING PATH",
    question:
      "Every technique and the foundations they share. Click one to see what you need first, in order.",
    shot: "view-learning-path",
    href: expeditionUrl(SHOWCASE.compute),
  },
  {
    id: "map",
    label: "Map",
    kicker: "SWISS RAIL · MAP",
    question: "Where does the week go, and what is near each stay?",
    shot: "view-map",
    href: expeditionUrl(SHOWCASE.swissRail),
  },
  {
    id: "timeline",
    label: "Timeline",
    kicker: "SWISS RAIL · TIMELINE",
    question: "What happens when, from the first idea to the photo book?",
    shot: "view-timeline",
    href: expeditionUrl(SHOWCASE.swissRail),
  },
  {
    id: "comparison-table",
    label: "Comparison table",
    kicker: "E-BIKE · COMPARISON TABLE",
    question:
      "How do these bikes stack up on hill climbing, maintenance, weight, theft protection and price?",
    shot: "view-comparison-table",
    href: expeditionUrl(SHOWCASE.ebike),
  },
  {
    id: "cause-and-effect",
    label: "Cause and effect",
    kicker: "E-BIKE · CAUSE AND EFFECT",
    question:
      "If I pick mid-drive or hub, what follows: how steep I can climb, how quiet the ride is, what maintenance I face?",
    shot: "view-cause-and-effect",
    href: expeditionUrl(SHOWCASE.ebike),
  },
]

/** The six View Types the gallery names without a tab. */
export const MORE_VIEWS = [
  "Anatomy",
  "Quadrant",
  "Lineage",
  "Evidence",
  "Rates",
  "Outline",
]

/**
 * The Examples. The E-bike summary and the Swiss rail counts are the mockup's
 * placeholders until those Expeditions are tidied (spec 9.4); replace them here.
 */
export const EXAMPLES: {
  title: string
  summary: string
  counts: string
  shot: ImageSlotId
  href: string
}[] = [
  {
    title: "AI compute and model internals",
    summary:
      "Why capacity is scarce, why inference keeps getting cheaper, and how transformers and mixture of experts work.",
    counts: "206 CONCEPTS · 12 VIEWS",
    shot: "example-compute",
    href: expeditionUrl(SHOWCASE.compute),
  },
  {
    title: "E-bike for the commute",
    summary: "[One-line summary, written when the Expedition is tidied]",
    counts: "50 CONCEPTS · 4 VIEWS",
    shot: "example-ebike",
    href: expeditionUrl(SHOWCASE.ebike),
  },
  {
    title: "A week on the Swiss rail loop",
    summary:
      "A week by train through Swiss landmarks, planned from first idea to photo book.",
    counts: "[COUNTS AFTER REBUILD]",
    shot: "example-swiss-rail",
    href: expeditionUrl(SHOWCASE.swissRail),
  },
]
