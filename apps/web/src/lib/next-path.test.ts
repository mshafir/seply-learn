import { describe, expect, it } from "vitest"

import { sameOriginPath } from "@/lib/next-path.ts"

describe("sameOriginPath", () => {
  it("keeps a path on this origin, with its query", () => {
    expect(sameOriginPath("/e/01ABC?fork=1")).toBe("/e/01ABC?fork=1")
    expect(sameOriginPath("/explore")).toBe("/explore")
    expect(sameOriginPath("/")).toBe("/")
  })

  it("refuses anything that leaves the origin", () => {
    expect(sameOriginPath("//evil.example/x")).toBe("/")
    expect(sameOriginPath("/\\evil.example")).toBe("/")
    expect(sameOriginPath("https://evil.example")).toBe("/")
    expect(sameOriginPath("javascript:alert(1)")).toBe("/")
    expect(sameOriginPath("e/1")).toBe("/")
    expect(sameOriginPath("")).toBe("/")
  })
})
