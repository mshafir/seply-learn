// Personal View settings (spec §1.6, §1.7): each reader's own choices for a
// View ("Show all steps", "Hide what I've read"). They are never shared and
// never logged; defaults come from the View Type's personal schema only.
//
// The spec keeps them server-side in `personal_view_settings`, behind the
// per-reader API WP-2.5 builds. Until that lands, this interface is the one
// seam: the app reads and writes through `PersonalViewSettingsStore`, and the
// store here keeps them in this browser (localStorage), per user and View.
// Other tabs of the same browser see changes through the `storage` event.
import * as React from "react"
import { parsePersonalSettings, type ViewTypeId } from "@umbel/domain"

export type PersonalValues = Record<string, unknown>

export interface PersonalViewSettingsStore {
  /** What the reader saved for a View (not yet parsed; may be empty). */
  get(userId: string, viewId: string): PersonalValues
  set(userId: string, viewId: string, values: PersonalValues): void
  /** Called whenever any saved value may have changed. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void
}

const PREFIX = "umbel:personal-view-settings:"

type KeyValueStorage = Pick<Storage, "getItem" | "setItem">

/** localStorage, per user and View. Storage failures read as "nothing saved". */
export class LocalPersonalViewSettings implements PersonalViewSettingsStore {
  private listeners = new Set<() => void>()
  private cache = new Map<
    string,
    { raw: string | null; value: PersonalValues }
  >()

  constructor(
    private readonly storage: () => KeyValueStorage | null = () =>
      typeof localStorage === "undefined" ? null : localStorage,
    events: Pick<Window, "addEventListener"> | null = typeof window ===
    "undefined"
      ? null
      : window
  ) {
    events?.addEventListener("storage", (e) => {
      if (!e.key || e.key.startsWith(PREFIX)) this.emit()
    })
  }

  private key(userId: string, viewId: string) {
    return `${PREFIX}${userId}:${viewId}`
  }

  get(userId: string, viewId: string): PersonalValues {
    const key = this.key(userId, viewId)
    let raw: string | null
    try {
      raw = this.storage()?.getItem(key) ?? null
    } catch {
      raw = null
    }
    // Same object for the same stored text, so React sees a stable snapshot.
    const hit = this.cache.get(key)
    if (hit && hit.raw === raw) return hit.value
    let value: PersonalValues = {}
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : {}
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        value = parsed as PersonalValues
    } catch {
      value = {}
    }
    this.cache.set(key, { raw, value })
    return value
  }

  set(userId: string, viewId: string, values: PersonalValues): void {
    try {
      this.storage()?.setItem(this.key(userId, viewId), JSON.stringify(values))
    } catch (e) {
      console.warn("personal View settings: saving failed", e)
    }
    this.emit()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const l of this.listeners) l()
  }
}

let defaultStore: PersonalViewSettingsStore | null = null
export function personalViewSettingsStore(): PersonalViewSettingsStore {
  defaultStore ??= new LocalPersonalViewSettings()
  return defaultStore
}

/**
 * A reader's personal settings for a View, with the View Type's defaults
 * filled in, and a setter for one of them. Saved values the schema no longer
 * accepts fall back to the defaults.
 */
export function usePersonalViewSettings(
  userId: string,
  view: { id: string; viewType: ViewTypeId } | null,
  store: PersonalViewSettingsStore = personalViewSettingsStore()
): {
  values: PersonalValues
  set: (key: string, value: unknown) => void
} {
  const saved = React.useSyncExternalStore(
    React.useCallback((l: () => void) => store.subscribe(l), [store]),
    () => (view ? store.get(userId, view.id) : EMPTY)
  )
  const values = React.useMemo(() => {
    if (!view) return EMPTY
    const parsed = parsePersonalSettings(view.viewType, saved)
    if (parsed.success) return parsed.data
    const defaults = parsePersonalSettings(view.viewType, {})
    return defaults.success ? defaults.data : EMPTY
  }, [view, saved])
  const set = React.useCallback(
    (key: string, value: unknown) => {
      if (!view) return
      store.set(userId, view.id, {
        ...store.get(userId, view.id),
        [key]: value,
      })
    },
    [store, userId, view]
  )
  return { values, set }
}

const EMPTY: PersonalValues = {}
