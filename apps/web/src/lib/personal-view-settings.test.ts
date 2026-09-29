import { describe, expect, it } from "vitest"

import { LocalPersonalViewSettings } from "./personal-view-settings.ts"

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  }
}

describe("LocalPersonalViewSettings", () => {
  it("keeps each reader's settings apart", () => {
    const storage = memoryStorage()
    const store = new LocalPersonalViewSettings(() => storage, null)
    store.set("ada", "v1", { showAllSteps: true })
    expect(store.get("ada", "v1")).toEqual({ showAllSteps: true })
    expect(store.get("ed", "v1")).toEqual({})
    expect(store.get("ada", "v2")).toEqual({})
  })

  it("returns the same object until the value changes, and notifies", () => {
    const storage = memoryStorage()
    const store = new LocalPersonalViewSettings(() => storage, null)
    let calls = 0
    const off = store.subscribe(() => calls++)
    const a = store.get("ada", "v1")
    expect(store.get("ada", "v1")).toBe(a)
    store.set("ada", "v1", { hideRead: true })
    expect(calls).toBe(1)
    expect(store.get("ada", "v1")).not.toBe(a)
    off()
    store.set("ada", "v1", {})
    expect(calls).toBe(1)
  })

  it("reads broken or missing storage as nothing saved", () => {
    const broken = {
      getItem: () => "{not json",
      setItem: () => {
        throw new Error("quota")
      },
    }
    const store = new LocalPersonalViewSettings(() => broken, null)
    expect(store.get("ada", "v1")).toEqual({})
    expect(() => store.set("ada", "v1", { a: 1 })).not.toThrow()
    expect(
      new LocalPersonalViewSettings(() => null, null).get("a", "b")
    ).toEqual({})
  })
})
