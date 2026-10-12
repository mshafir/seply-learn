import { describe, expect, it } from "vitest"

import {
  checkServer,
  isLocalHost,
  isSeplyInstance,
  parseServer,
} from "./server-url.ts"

describe("parseServer", () => {
  it("reduces an address to its origin", () => {
    expect(parseServer("https://learn.example.com/e/123?x=1#y")).toEqual({
      ok: true,
      origin: "https://learn.example.com",
      encrypted: true,
    })
    expect(parseServer("  https://user:pw@Learn.Example.com:8443/  ")).toEqual({
      ok: true,
      origin: "https://learn.example.com:8443",
      encrypted: true,
    })
  })

  it("assumes https, or http for a local address, when no scheme is typed", () => {
    expect(parseServer("learn.example.com")).toMatchObject({
      origin: "https://learn.example.com",
    })
    expect(parseServer("localhost:3000")).toEqual({
      ok: true,
      origin: "http://localhost:3000",
      encrypted: false,
    })
    expect(parseServer("nas.local:3000/")).toMatchObject({
      origin: "http://nas.local:3000",
    })
    expect(parseServer("192.168.1.20:3000")).toMatchObject({
      origin: "http://192.168.1.20:3000",
    })
  })

  it("refuses plain http anywhere but a local address", () => {
    expect(parseServer("http://learn.example.com")).toEqual({
      ok: false,
      reason: "insecure",
    })
    expect(parseServer("http://8.8.8.8:3000")).toEqual({
      ok: false,
      reason: "insecure",
    })
    expect(parseServer("http://100.100.1.2:3000")).toMatchObject({ ok: true })
    expect(parseServer("http://[::1]:3000")).toMatchObject({ ok: true })
  })

  it("refuses what isn't a web address", () => {
    expect(parseServer("")).toEqual({ ok: false, reason: "empty" })
    expect(parseServer("   ")).toEqual({ ok: false, reason: "empty" })
    expect(parseServer("file:///etc/passwd")).toEqual({
      ok: false,
      reason: "invalid",
    })
    expect(parseServer("javascript://alert(1)")).toEqual({
      ok: false,
      reason: "invalid",
    })
    expect(parseServer("not a url")).toEqual({ ok: false, reason: "invalid" })
  })
})

describe("isLocalHost", () => {
  it("knows this machine and private networks", () => {
    for (const h of [
      "localhost",
      "app.localhost",
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.10",
      "nas.local",
      "[::1]",
      "fd12:3456::1",
    ])
      expect(isLocalHost(h), h).toBe(true)
    for (const h of [
      "learn.seply.app",
      "172.32.0.1",
      "11.0.0.1",
      "192.169.0.1",
      "local.example.com",
      "100.128.0.1",
    ])
      expect(isLocalHost(h), h).toBe(false)
  })
})

describe("isSeplyInstance", () => {
  it("wants the product name", () => {
    expect(isSeplyInstance({ product: "seply-learn", hosted: false })).toBe(
      true
    )
    expect(isSeplyInstance({ product: "other" })).toBe(false)
    expect(isSeplyInstance({ ok: true })).toBe(false)
    expect(isSeplyInstance(null)).toBe(false)
    expect(isSeplyInstance("seply-learn")).toBe(false)
  })
})

describe("checkServer", () => {
  const answers =
    (body: unknown, status = 200) =>
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
      })

  it("passes a Seply Learn server, asking its /api/instance", async () => {
    let asked = ""
    const res = await checkServer("learn.example.com/e/1", async (url) => {
      asked = url
      return new Response(JSON.stringify({ product: "seply-learn" }))
    })
    expect(asked).toBe("https://learn.example.com/api/instance")
    expect(res).toEqual({
      ok: true,
      origin: "https://learn.example.com",
      encrypted: true,
    })
  })

  it("refuses a server that isn't Seply Learn", async () => {
    expect(await checkServer("example.com", answers({ ok: true }))).toEqual({
      ok: false,
      reason: "not-seply",
    })
    expect(await checkServer("example.com", answers("<html>", 200))).toEqual({
      ok: false,
      reason: "not-seply",
    })
    expect(await checkServer("example.com", answers({}, 404))).toEqual({
      ok: false,
      reason: "not-seply",
    })
  })

  it("says when nothing answers, or too slowly", async () => {
    expect(
      await checkServer("example.com", async () => {
        throw new TypeError("fetch failed")
      })
    ).toEqual({ ok: false, reason: "unreachable" })
    expect(
      await checkServer(
        "example.com",
        (_url, { signal }) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason))
          ),
        20
      )
    ).toEqual({ ok: false, reason: "unreachable" })
  })

  it("never asks a server it wouldn't save", async () => {
    let asked = false
    const res = await checkServer("http://learn.example.com", async () => {
      asked = true
      return new Response("{}")
    })
    expect(res).toEqual({ ok: false, reason: "insecure" })
    expect(asked).toBe(false)
  })
})
