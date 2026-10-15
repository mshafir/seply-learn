#!/usr/bin/env node
// Checks a deployed site (.github/workflows/preview.yml, after each deploy):
//
//   node apps/site/scripts/check-deploy.mjs <url> <preview|production> [tries]
//
// The home page answers 200 with HTML, an unknown path answers 404 with the
// 404 page, og.png and sitemap.xml are there, the explainer (when deployed)
// answers byte ranges with 206 and 416, and previews send
// `X-Robots-Tag: noindex` while production doesn't. Retries the home page
// first (every 10 s, default 18 tries), since a new workers.dev hostname or
// custom domain takes a moment to answer, then runs the other checks up to
// 4 rounds, 10 s apart, while any fails. Writes the home page's status line
// to $GITHUB_OUTPUT as `summary=` when that is set.
import { appendFileSync } from "node:fs"

const [url, kind, triesArg] = process.argv.slice(2)
if (!url || !["preview", "production"].includes(kind)) {
  console.error("usage: check-deploy.mjs <url> <preview|production> [tries]")
  process.exit(2)
}
const base = url.replace(/\/$/, "")
const tries = Number(triesArg ?? 18)

async function get(path) {
  return fetch(base + path, { redirect: "manual" })
}

let home
for (let i = 1; i <= tries; i++) {
  try {
    home = await get("/")
    if (home.ok) break
    console.log(`GET ${base}/: ${home.status} (try ${i}/${tries})`)
  } catch (err) {
    console.log(`GET ${base}/: ${err.cause?.code ?? err.message} (try ${i}/${tries})`)
  }
  home = undefined
  if (i < tries) await new Promise((r) => setTimeout(r, 10_000))
}

if (!home) {
  console.error(`::error::${base}/ did not answer 200`)
  process.exit(1)
}

let failures = []
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`)
  if (!ok) failures.push(message)
}
let robots = ""

// Right after a deploy, some requests can still reach the old version or a
// hostname that isn't fully up, so a failing round is tried again.
async function checkAll() {
  const page = await get("/")
  const html = await page.text()
  check(/text\/html/.test(page.headers.get("content-type") ?? ""), "/ is HTML")
  check(html.includes("<h1"), "/ has a heading")
  robots = page.headers.get("x-robots-tag") ?? ""
  if (kind === "preview") check(/noindex/.test(robots), "/ sends X-Robots-Tag: noindex")
  else check(!/noindex/.test(robots), "/ does not send noindex")

  const missing = await get("/this-page-does-not-exist")
  check(missing.status === 404, `an unknown path answers 404 (got ${missing.status})`)
  check((await missing.text()).includes("There is no page at this address."), "an unknown path shows the 404 page")

  const og = await get("/og.png")
  check(og.status === 200 && og.headers.get("content-type") === "image/png", "/og.png is a PNG")
  const sitemap = await get("/sitemap.xml")
  check(sitemap.status === 200 && (await sitemap.text()).includes("<urlset"), "/sitemap.xml is a sitemap")

  // The video answers byte ranges (worker/index.ts), when the build has it.
  const VIDEO = "/media/video/explainer.mp4"
  const whole = await fetch(base + VIDEO, { method: "HEAD" })
  if (whole.status === 200) {
    const size = Number(whole.headers.get("content-length"))
    check(whole.headers.get("accept-ranges") === "bytes", `${VIDEO} sends Accept-Ranges: bytes`)
    const part = await fetch(base + VIDEO, { headers: { Range: "bytes=0-99" } })
    const body = await part.arrayBuffer()
    check(
      part.status === 206 && part.headers.get("content-range") === `bytes 0-99/${size}` && body.byteLength === 100,
      `${VIDEO} answers a Range with 206 (got ${part.status} ${part.headers.get("content-range")})`
    )
    const past = await fetch(base + VIDEO, { headers: { Range: `bytes=${size}-` } })
    await past.arrayBuffer()
    check(past.status === 416, `${VIDEO} answers a Range past the end with 416 (got ${past.status})`)
  } else {
    console.log(`skip ${VIDEO}: ${whole.status} (no video in this build)`)
  }
}

const ROUNDS = 4
for (let round = 1; round <= ROUNDS; round++) {
  failures = []
  await checkAll()
  if (!failures.length || round === ROUNDS) break
  console.log(`retrying in 10 s (round ${round}/${ROUNDS})`)
  await new Promise((r) => setTimeout(r, 10_000))
}

if (process.env.GITHUB_OUTPUT)
  appendFileSync(process.env.GITHUB_OUTPUT, `summary=${home.status} ${robots ? `(X-Robots-Tag: ${robots})` : ""}\n`)

if (failures.length) {
  console.error(`::error::${base}: ${failures.join("; ")}`)
  process.exit(1)
}
