// The media manifest: every screenshot, video and embed slot on the site
// (spec 9.3). Media is never committed. CI (WP-7.4 for video, WP-7.6 for
// screenshots) drops the files into apps/site/public/media/ before
// `astro build`, at the paths below; a slot whose file is missing renders a
// labelled placeholder, the label naming the shot from the design doc.
//
//   public/media/shots/<file>-light.avif|webp   1440 × 900 at 2× (2880 × 1800)
//   public/media/shots/<file>-dark.avif|webp    optional; else the light one
//   public/media/video/explainer.mp4|webm, explainer.vtt, explainer-poster.webp
//   public/media/video/hero-loop.mp4|webm, hero-loop-poster.webp
import { existsSync } from "node:fs"
import { join } from "node:path"

/**
 * Where the media lives while building. `astro build` runs in apps/site (CI and
 * `pnpm --filter`); MEDIA_DIR overrides it, e.g. for the tests.
 */
const MEDIA_DIR =
  process.env.MEDIA_DIR ?? join(process.cwd(), "public", "media")
const has = (file: string) => existsSync(join(MEDIA_DIR, file))

export type ImageSlot = {
  /** Shot list entry and contents, shown on the placeholder. */
  label: string
  /** The alternative text once the screenshot is there. */
  alt: string
  /** File name stem under public/media/shots/. */
  file: string
}

export const IMAGE_SLOTS = {
  "how-question": {
    label:
      "SHOT 16 · NEW EXPEDITION: A QUESTION, OPTIONAL SOURCES, CHOSEN VIEWS",
    alt: "Starting a new Expedition: the question, optional Sources and the chosen Views",
    file: "16-new-expedition",
  },
  "how-build": {
    label: "SHOT 17 · A VIEW MID-BUILD, CONCEPTS STREAMING IN",
    alt: "A View while the Expedition is being built, with Concepts arriving",
    file: "17-mid-build",
  },
  "how-read": {
    label: "SHOT 15 · CONCEPT PANEL AT ARTICLE DEPTH, WITH PROVENANCE",
    alt: "A Concept panel open at article depth, showing where each statement came from",
    file: "15-concept-panel",
  },
  "view-learning-path": {
    label: "SHOT 1 · LEARNING PATH, ONE TECHNIQUE SELECTED, PREREQUISITES LIT",
    alt: "The Learning path View of AI compute, with one technique selected and its prerequisites highlighted",
    file: "01-learning-path",
  },
  "view-map": {
    label: "SHOT 2 · THE ROUTE ACROSS SWITZERLAND, STAYS AND DAY TRIPS",
    alt: "The Map View of the Swiss rail week: the route, the stays and the day trips",
    file: "02-map",
  },
  "view-timeline": {
    label: "SHOT 3 · THE WEEK ON ONE AXIS",
    alt: "The Timeline View of the Swiss rail week",
    file: "03-timeline",
  },
  "view-comparison-table": {
    label: "SHOT 5 · BIKES SIDE BY SIDE ON TORQUE, BATTERY, WEIGHT, PRICE",
    alt: "The Comparison table View: e-bikes side by side on torque, battery, weight and price",
    file: "05-comparison-table",
  },
  "view-cause-and-effect": {
    label: "SHOT 7 · MID-DRIVE OR HUB, TRACED",
    alt: "The Cause and effect View tracing what follows from a mid-drive or hub motor",
    file: "07-cause-and-effect",
  },
  "example-compute": {
    label: "SHOT 14 · OUTLINE",
    alt: "The Outline View of AI compute and model internals",
    file: "14-outline",
  },
  "example-ebike": {
    label: "SHOT 5 · COMPARE THE BIKES",
    alt: "Comparing the bikes in E-bike for the commute",
    file: "05-comparison-table",
  },
  "example-swiss-rail": {
    label: "SHOT 2 · THE ROUTE",
    alt: "The route of A week on the Swiss rail loop on a map",
    file: "02-map",
  },
  "read-together": {
    label: "FALLBACK: SHOT 19 · TWO READERS ON ONE VIEW",
    alt: "Two people reading the same View, each with their own cursor",
    file: "19-two-readers",
  },
} satisfies Record<string, ImageSlot>

export type ImageSlotId = keyof typeof IMAGE_SLOTS

export type ResolvedImage = ImageSlot & {
  /** Public URLs by theme and format, or null when the file is missing. */
  light: { avif?: string; webp: string } | null
  dark: { avif?: string; webp: string } | null
}

function shot(stem: string) {
  if (!has(`shots/${stem}.webp`)) return null
  return {
    webp: `/media/shots/${stem}.webp`,
    avif: has(`shots/${stem}.avif`) ? `/media/shots/${stem}.avif` : undefined,
  }
}

export function image(id: ImageSlotId): ResolvedImage {
  const slot: ImageSlot = IMAGE_SLOTS[id]
  return {
    ...slot,
    light: shot(`${slot.file}-light`),
    dark: shot(`${slot.file}-dark`),
  }
}

export type ResolvedVideo = {
  label: string
  mp4?: string
  webm?: string
  poster?: string
  captions?: string
  /** True when at least one video file is there. */
  present: boolean
}

function video(stem: string, label: string): ResolvedVideo {
  const url = (ext: string) =>
    has(`video/${stem}${ext}`) ? `/media/video/${stem}${ext}` : undefined
  const v = {
    label,
    mp4: url(".mp4"),
    webm: url(".webm"),
    poster: url("-poster.webp"),
    captions: url(".vtt"),
  }
  return { ...v, present: Boolean(v.mp4 || v.webm) }
}

/** The 60-second explainer (WP-7.4): MP4 and WebM, WebVTT captions, a poster frame. */
export const explainer = () =>
  video("explainer", "EXPLAINER · 60 S · CAPTIONS ON")

/** The 12-second hero loop cut from the explainer (WP-7.4). Until it exists, the hero shows the E-bike sketch. */
export const heroLoop = () =>
  video("hero-loop", "HERO LOOP · 12 S · CUT FROM THE EXPLAINER")

/**
 * The live embed in Read together (WP-7.5): a public View, read-only, from
 * learn.seply.app/e/:id/embed?view=<id>. Unset until that route exists; the
 * slot then shows the read-together screenshot (or its placeholder).
 */
export const EMBED = {
  url: process.env.SITE_EMBED_URL || undefined,
  label: "LIVE EMBED: A PUBLIC VIEW, READ-ONLY",
  title: "A public View of an Expedition, read-only",
  fallback: "read-together" as ImageSlotId,
}
