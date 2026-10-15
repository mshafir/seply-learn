import { describe, expect, it } from "vitest"

import { linkInArgs, parseDeepLink } from "./deep-link.ts"
import {
  challengeOf,
  completeUrl,
  SIGN_IN_WINDOW_MS,
  startSignIn,
} from "./sign-in.ts"

const SERVER = "https://learn.seply.app"
const TOKEN = "Zk3vQ9xT1mB7cR5wYp2LhN8dJ6sAf4Gu"

describe("parseDeepLink", () => {
  it("reads a sign-in link for the chosen server", () => {
    expect(
      parseDeepLink(`seply://learn.seply.app/auth?token=${TOKEN}`, SERVER)
    ).toEqual({ kind: "auth", token: TOKEN })
    // A self-hosted server on a port.
    expect(
      parseDeepLink(
        `seply://localhost:3000/auth?token=${TOKEN}`,
        "http://localhost:3000"
      )
    ).toEqual({ kind: "auth", token: TOKEN })
  })

  it("never accepts a link for another server", () => {
    for (const link of [
      `seply://evil.example.com/auth?token=${TOKEN}`,
      `seply://learn.seply.app.evil.example.com/auth?token=${TOKEN}`,
      `seply://learn.seply.app:8443/auth?token=${TOKEN}`,
    ])
      expect(parseDeepLink(link, SERVER).kind, link).toBe("other-server")
    // A name before an @ is not the host.
    expect(
      parseDeepLink(
        `seply://learn.seply.app@evil.example.com/auth?token=${TOKEN}`,
        SERVER
      ).kind
    ).toBe("invalid")
  })

  it("refuses anything it doesn't know", () => {
    for (const link of [
      "",
      "not a link",
      `https://learn.seply.app/auth?token=${TOKEN}`,
      `file:///etc/passwd`,
      `seply:///auth?token=${TOKEN}`,
      "seply://learn.seply.app/auth",
      "seply://learn.seply.app/auth?token=",
      "seply://learn.seply.app/auth?token=short",
      `seply://learn.seply.app/auth?token=${TOKEN}%22%3E%3Cscript%3E`,
      `seply://learn.seply.app/auth/../x?token=${TOKEN}`,
      // Pages open with WP-8.3; until then they are not handled.
      "seply://learn.seply.app/e/01K",
      `seply://user:pass@learn.seply.app/auth?token=${TOKEN}`,
    ])
      expect(parseDeepLink(link, SERVER).kind, link).toBe("invalid")
  })
})

describe("linkInArgs", () => {
  it("finds the link a second instance was started with", () => {
    expect(
      linkInArgs(["/opt/seply/seply", "--flag", "seply://learn.seply.app/auth"])
    ).toBe("seply://learn.seply.app/auth")
    expect(linkInArgs(["/opt/seply/seply", "."])).toBeUndefined()
  })
})

describe("sign-in through the browser", () => {
  it("sends the browser a challenge and keeps the verifier", () => {
    const { pending, url } = startSignIn(SERVER, 1000)
    const sent = new URL(url)
    expect(sent.origin + sent.pathname).toBe(`${SERVER}/desktop/sign-in`)
    expect(sent.searchParams.get("challenge")).toBe(
      challengeOf(pending.verifier)
    )
    expect(url).not.toContain(pending.verifier)
    expect(pending.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(pending.expires).toBe(1000 + SIGN_IN_WINDOW_MS)
    // A new verifier every time.
    expect(startSignIn(SERVER).pending.verifier).not.toBe(pending.verifier)
  })

  it("finishes only a sign-in it started, on that server, in time", () => {
    const { pending } = startSignIn(SERVER, 1000)
    const done = completeUrl(pending, SERVER, TOKEN, 2000)!
    const u = new URL(done)
    expect(u.origin + u.pathname).toBe(`${SERVER}/desktop/complete`)
    expect(u.search).toBe("")
    expect(Object.fromEntries(new URLSearchParams(u.hash.slice(1)))).toEqual({
      token: TOKEN,
      verifier: pending.verifier,
    })

    expect(completeUrl(null, SERVER, TOKEN)).toBeNull()
    expect(
      completeUrl(pending, "https://other.example.com", TOKEN, 2000)
    ).toBeNull()
    expect(
      completeUrl(pending, SERVER, TOKEN, 1000 + SIGN_IN_WINDOW_MS + 1)
    ).toBeNull()
  })
})
