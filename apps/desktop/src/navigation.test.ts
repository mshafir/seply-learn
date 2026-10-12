import { describe, expect, it } from "vitest"

import { ALLOWED_PERMISSIONS, navigation, onServer } from "./navigation.ts"

const SERVER = "https://learn.example.com"

describe("navigation", () => {
  it("keeps the server's own pages in the window", () => {
    expect(navigation(`${SERVER}/e/1`, SERVER)).toBe("allow")
    expect(
      navigation(`${SERVER}/api/auth/callback/google?code=x`, SERVER)
    ).toBe("allow")
  })

  it("sends other web links to the system browser", () => {
    expect(navigation("https://accounts.google.com/o/oauth2", SERVER)).toBe(
      "external"
    )
    expect(navigation("http://example.com/", SERVER)).toBe("external")
    expect(navigation("mailto:ada@example.com", SERVER)).toBe("external")
    // The same host on another scheme or port is another origin.
    expect(navigation("http://learn.example.com/", SERVER)).toBe("external")
    expect(navigation("https://learn.example.com:8443/", SERVER)).toBe(
      "external"
    )
    // A lookalike host.
    expect(navigation("https://learn.example.com.evil.test/", SERVER)).toBe(
      "external"
    )
  })

  it("refuses everything else", () => {
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "seply://learn.example.com/auth?token=x",
      "chrome://settings",
      "not a url",
      "",
    ])
      expect(navigation(url, SERVER), url).toBe("deny")
  })
})

describe("onServer", () => {
  it("is true only on the chosen server's origin", () => {
    expect(onServer(`${SERVER}/`, SERVER)).toBe(true)
    expect(onServer("https://other.example.com/", SERVER)).toBe(false)
    expect(onServer("file:///app/index.html", SERVER)).toBe(false)
    expect(onServer("about:blank", SERVER)).toBe(false)
  })
})

describe("ALLOWED_PERMISSIONS", () => {
  it("is notifications and copying, nothing more", () => {
    expect([...ALLOWED_PERMISSIONS].sort()).toEqual([
      "clipboard-sanitized-write",
      "notifications",
    ])
  })
})
