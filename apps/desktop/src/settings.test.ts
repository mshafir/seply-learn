import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { DEFAULT_SERVER } from "./server-url.ts"
import { readSettings, writeSettings } from "./settings.ts"

const file = () =>
  join(mkdtempSync(join(tmpdir(), "seply-desktop-")), "a", "settings.json")

describe("settings", () => {
  it("starts on the hosted server", () => {
    expect(readSettings(file())).toEqual({ server: DEFAULT_SERVER })
  })

  it("keeps the chosen server and the window's bounds", () => {
    const f = file()
    writeSettings(f, {
      server: "http://nas.local:3000",
      bounds: { x: 10, y: 20, width: 1200, height: 800 },
    })
    expect(readSettings(f)).toEqual({
      server: "http://nas.local:3000",
      bounds: { x: 10, y: 20, width: 1200, height: 800 },
    })
    expect(readFileSync(f, "utf8")).toContain('"server"')
  })

  it("reads a broken file as the defaults", () => {
    const f = file()
    writeSettings(f, { server: DEFAULT_SERVER })
    for (const text of ["", "{", "null", "[]", '"x"']) {
      writeFileSync(f, text)
      expect(readSettings(f), text).toEqual({ server: DEFAULT_SERVER })
    }
  })

  it("never trusts a server the picker wouldn't save", () => {
    const f = file()
    writeSettings(f, { server: DEFAULT_SERVER })
    for (const server of [
      "http://evil.example.com",
      "file:///etc/passwd",
      "javascript:alert(1)",
      42,
    ]) {
      writeFileSync(f, JSON.stringify({ server }))
      expect(readSettings(f).server, String(server)).toBe(DEFAULT_SERVER)
    }
    // A stored address is reduced to its origin, like a typed one.
    writeFileSync(f, JSON.stringify({ server: "https://learn.example.com/x" }))
    expect(readSettings(f).server).toBe("https://learn.example.com")
  })

  it("drops bounds that make no sense", () => {
    const f = file()
    writeSettings(f, { server: DEFAULT_SERVER })
    for (const bounds of [
      { width: 0, height: 0 },
      { width: "wide", height: 600 },
      { width: -900, height: 600 },
      "big",
    ]) {
      writeFileSync(f, JSON.stringify({ server: DEFAULT_SERVER, bounds }))
      expect(readSettings(f).bounds).toBeUndefined()
    }
    writeFileSync(
      f,
      JSON.stringify({
        server: DEFAULT_SERVER,
        bounds: { width: 900.4, height: 700, x: "left" },
      })
    )
    expect(readSettings(f).bounds).toEqual({ width: 900, height: 700 })
  })
})
