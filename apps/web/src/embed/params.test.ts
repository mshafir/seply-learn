import { describe, expect, it } from "vitest"

import { appHref, embedParams } from "./params.ts"

const at = (path: string) =>
  embedParams(new URL(path, "https://learn.seply.app"))

describe("embedParams", () => {
  it("reads the Expedition, View and theme", () => {
    expect(at("/e/exp1/embed?view=v2&theme=dark")).toEqual({
      expeditionId: "exp1",
      viewId: "v2",
      theme: "dark",
    })
    expect(at("/e/exp1/embed/")).toEqual({
      expeditionId: "exp1",
      viewId: null,
      theme: "system",
    })
  })

  it("follows the system for an unknown theme and ignores an empty View", () => {
    expect(at("/e/exp1/embed?theme=sepia&view=")).toMatchObject({
      viewId: null,
      theme: "system",
    })
  })

  it("is null anywhere but an embed's path", () => {
    expect(at("/embed")).toBeNull()
    expect(at("/embed.html")).toBeNull()
    expect(at("/e/exp1")).toBeNull()
    expect(at("/e/exp1/embed/more")).toBeNull()
    expect(at("/e/%E0%A4%A/embed")).toBeNull()
  })
})

describe("appHref", () => {
  it("links to the Expedition in the app, on the View when there is one", () => {
    expect(appHref("https://learn.seply.app", "exp1", "v2")).toBe(
      "https://learn.seply.app/e/exp1/v2"
    )
    expect(appHref("https://learn.seply.app", "exp1", null)).toBe(
      "https://learn.seply.app/e/exp1"
    )
  })
})
