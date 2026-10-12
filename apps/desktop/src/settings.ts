// The app's stored setting (spec §10.2): the chosen server and the window's
// bounds, as JSON in the user-data folder. Nothing secret. A missing, broken
// or tampered file reads as the defaults.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { DEFAULT_SERVER, parseServer } from "./server-url.ts"

export type Bounds = { x?: number; y?: number; width: number; height: number }

export type Settings = {
  /** The chosen server's origin. */
  server: string
  bounds?: Bounds
}

export const DEFAULT_SETTINGS: Settings = { server: DEFAULT_SERVER }

const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n)

function readBounds(value: unknown): Bounds | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const b = value as Record<string, unknown>
  if (!finite(b.width) || !finite(b.height)) return undefined
  if (b.width < 320 || b.height < 240) return undefined
  return {
    width: Math.round(b.width),
    height: Math.round(b.height),
    ...(finite(b.x) && finite(b.y)
      ? { x: Math.round(b.x), y: Math.round(b.y) }
      : {}),
  }
}

export function readSettings(file: string): Settings {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS }
  const { server, bounds } = raw as Record<string, unknown>
  // Only an address the picker would accept: the file is not trusted.
  const parsed = typeof server === "string" ? parseServer(server) : null
  return {
    server: parsed?.ok ? parsed.origin : DEFAULT_SERVER,
    ...(readBounds(bounds) ? { bounds: readBounds(bounds) } : {}),
  }
}

/** Writes the whole file, through a rename, so a crash can't leave half of it. */
export function writeSettings(file: string, settings: Settings): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`)
  renameSync(tmp, file)
}
