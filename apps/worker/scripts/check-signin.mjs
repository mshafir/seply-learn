#!/usr/bin/env node
// Checks a deployed Worker's Google sign-in without a Google account:
//   node scripts/check-signin.mjs <worker url> <production url>
// Starts sign-in the way the browser does and checks that the redirect goes to
// Google with production's callback as redirect_uri (for a preview, that means
// the OAuth proxy is on). Writes redirect_uri to $GITHUB_OUTPUT when set.
import { appendFileSync } from "node:fs"

const [url, production] = process.argv.slice(2)
if (!url || !production) {
  console.error("usage: check-signin.mjs <worker url> <production url>")
  process.exit(2)
}

const expected = `${new URL(production).origin}/api/auth/callback/google`
const res = await fetch(`${url}/api/auth/sign-in/social`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: new URL(url).origin },
  body: JSON.stringify({ provider: "google", callbackURL: "/" }),
})
const body = await res.json().catch(() => ({}))
if (!res.ok || typeof body.url !== "string") {
  console.error(
    `::error::sign-in/social answered ${res.status}: ${JSON.stringify(body)}`
  )
  process.exit(1)
}
const google = new URL(body.url)
const redirectUri = google.searchParams.get("redirect_uri")
console.log(`redirects to ${google.origin}, redirect_uri=${redirectUri}`)
if (
  google.origin !== "https://accounts.google.com" ||
  redirectUri !== expected
) {
  console.error(`::error::expected Google with redirect_uri=${expected}`)
  process.exit(1)
}
if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `redirect_uri=${redirectUri}\n`)
