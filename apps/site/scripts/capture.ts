// The site's screenshots (WP-7.6, spec 9.3): every image slot in src/media.ts,
// in light and dark, at 1440 × 900 and 2× density, encoded to AVIF and WebP.
//
// Two sources, and no demo account (hosted sign-in is Google only):
//
// - Public showcases on learn.seply.app, read anonymously: the Views gallery
//   and the Examples. A shot whose Expedition isn't readable (still private)
//   is skipped and logged, and its slot keeps its placeholder; a shot can name
//   a fallback View to use instead.
// - Signed-in screens from a local app, as the e2e tests run it: the Worker
//   (`wrangler dev`) with test credentials, on a migrated Postgres, seeded with
//   the committed fixtures (packages/domain/fixtures) and the test-only fake
//   build job. Nothing private, no secrets. Give it CAPTURE_DATABASE_URL (or
//   E2E_DATABASE_URL) and a built apps/web, and it starts and stops the Worker
//   itself; or point CAPTURE_APP_URL at one already running.
//
//   pnpm --filter @seply/site capture                  # both
//   pnpm --filter @seply/site capture --public-only    # the showcases
//   pnpm --filter @seply/site capture --app-only       # the signed-in screens
//   … --only=01-learning-path,17-mid-build             # some shots
//   … --out=<dir>                                      # default public/media/shots
//   … --debug=<dir>     # a failed shot's pages, as PNGs (default: a temp dir)
//
// The output folder gets `<file>-<light|dark>.<avif|webp>` per shot and a
// `manifest.json` saying where each came from (and an alt text when a
// fallback View was used); src/media.ts reads both. A partial run keeps the
// other shots already in the folder. Exits 1 when a shot failed for any
// reason other than an unreadable Expedition.
import { spawn, type ChildProcess } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright"
import sharp from "sharp"

const SITE = fileURLToPath(new URL("..", import.meta.url))
const REPO = resolve(SITE, "../..")
const FIXTURES = join(REPO, "packages/domain/fixtures")

const VIEWPORT = { width: 1440, height: 900 }
const SCALE = 2
const THEMES = ["light", "dark"] as const
type Theme = (typeof THEMES)[number]

const PUBLIC_URL = (
  process.env.CAPTURE_PUBLIC_URL ?? "https://learn.seply.app"
).replace(/\/$/, "")
const APP_PORT = Number(process.env.CAPTURE_APP_PORT ?? 8790)
const DATABASE_URL =
  process.env.CAPTURE_DATABASE_URL ?? process.env.E2E_DATABASE_URL

/** The public showcases (src/learn/content.ts, SHOWCASE). */
const COMPUTE = "01M3STC1773KBXQTHN2R4XRERR"
const EBIKE = "01M3VTGRE7ZTFR1CZTM80555C3"
const SWISS = "01M3SXS5ZJRK9P48Z849QRJBVE"

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const option = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const OUT = resolve(option("out") ?? join(SITE, "public/media/shots"))
/** Where a failed shot's pages are saved, to see what went wrong. */
const DEBUG_DIR = resolve(option("debug") ?? join(tmpdir(), "seply-capture-debug"))
const ONLY = option("only")?.split(",").filter(Boolean) ?? null
const runPublic = !flag("app-only")
const runApp = !flag("public-only")

// --------------------------------------------------------------- shot list

/** One View of a public Expedition, read anonymously. */
type PublicSource = {
  expedition: string
  view: string
  /** Select this Concept (by title): the side panel opens on it. */
  select?: string
  /** The slot's alt text when this source, a fallback, is the one used. */
  alt?: string
}
type PublicShot = { file: string; sources: PublicSource[] }

const PUBLIC_SHOTS: PublicShot[] = [
  {
    file: "01-learning-path",
    sources: [
      {
        expedition: COMPUTE,
        view: "01M3STC1772HARX17S9VPZH9G3",
        select: "Multi-head Latent Attention (MLA)",
      },
      {
        expedition: EBIKE,
        view: "01M3VTGRE7KKEFQ2XS5SHZMV51",
        alt: "The Learning path View of E-bike for the commute: what to learn first",
      },
    ],
  },
  {
    file: "02-map",
    sources: [{ expedition: SWISS, view: "01M3SXS5ZJD3P0BJAPXDT8HPQZ" }],
  },
  {
    file: "03-timeline",
    sources: [
      { expedition: SWISS, view: "01M3SXS5ZJ0SSAH9JB6MZK3XRF" },
      {
        expedition: COMPUTE,
        view: "01M3STC177CS3P9QRCHJ1DBCQ4",
        alt: "The Timeline View of AI compute and model internals",
      },
    ],
  },
  {
    file: "05-comparison-table",
    sources: [{ expedition: EBIKE, view: "01M3VTGRE7HFPP1V4XZDYWE180" }],
  },
  {
    file: "07-cause-and-effect",
    sources: [{ expedition: EBIKE, view: "01M3VTGRE7YA63G0P3ZK97YQHK" }],
  },
  {
    file: "14-outline",
    sources: [{ expedition: COMPUTE, view: "01M3STC177M70079S6M3K1JYQQ" }],
  },
]

/** A signed-in screen: sets up `page` and returns it ready to shoot. */
type AppShot = {
  file: string
  from: string
  setup: (app: App) => Promise<Scene>
}
type Scene = {
  /** The page to shoot. */
  page: Page
  /** Brings the scene back after a theme switch (cursors, hover). */
  refresh?: () => Promise<void>
  close: () => Promise<void>
}

// ----------------------------------------------------------------- helpers

const log = (...a: unknown[]) => console.log("[capture]", ...a)

/** Hides what shouldn't be in a screenshot: toasts and text carets. */
const CLEAN_CSS = `
  [data-slot="toast-viewport"], [data-slot="toast"] { display: none !important; }
  * { caret-color: transparent !important; }
`

async function newContext(browser: Browser, baseURL: string) {
  const context = await browser.newContext({
    baseURL,
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    colorScheme: "light",
    reducedMotion: "reduce",
  })
  await context.addInitScript((css: string) => {
    const add = () => {
      const style = document.createElement("style")
      style.dataset.capture = ""
      style.textContent = css
      document.head.append(style)
    }
    if (document.head) add()
    else document.addEventListener("DOMContentLoaded", add)
  }, CLEAN_CSS)
  return context
}

/** The View is drawn and laid out: the app's own readiness signal. */
async function settled(page: Page) {
  await page
    .locator("[data-testid=canvas-pane][data-settled]")
    .waitFor({ timeout: 60_000 })
  await page.evaluate(() => document.fonts.ready.then(() => true))
  // Map tiles and images: wait for the network to go quiet, briefly.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {})
  // Two frames, so the last layout pass is painted.
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  )
}

/** Waits until an element's box stops changing (a panel sliding open). */
async function steady(el: Locator) {
  let last = ""
  for (let i = 0; i < 50; i++) {
    const box = await el.boundingBox()
    const now = JSON.stringify(box)
    if (box && now === last) return
    last = now
    await el.page().waitForTimeout(100)
  }
}

async function encode(png: Buffer, stem: string) {
  await sharp(png).webp({ quality: 82, effort: 5 }).toFile(join(OUT, `${stem}.webp`))
  await sharp(png).avif({ quality: 55, effort: 4 }).toFile(join(OUT, `${stem}.avif`))
}

/** Shoots the page in both themes and writes the four files. */
async function shoot(scene: Scene, file: string) {
  for (const theme of THEMES) {
    await scene.page.emulateMedia({ colorScheme: theme })
    await scene.refresh?.()
    // Let theme-dependent canvases redraw.
    await scene.page.evaluate(
      () =>
        new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    )
    await scene.page.waitForTimeout(300)
    await scene.page.mouse.move(VIEWPORT.width - 2, VIEWPORT.height - 2)
    const png = await scene.page.screenshot({ animations: "disabled" })
    await encode(png, `${file}-${theme satisfies Theme}`)
  }
}

// ---------------------------------------------------------------- manifest

type Manifest = {
  capturedAt: string
  shots: Record<string, { from: string; alt?: string; capturedAt: string }>
  skipped: Record<string, string>
}

function readManifest(): Manifest {
  const path = join(OUT, "manifest.json")
  if (!existsSync(path)) return { capturedAt: "", shots: {}, skipped: {} }
  return JSON.parse(readFileSync(path, "utf8")) as Manifest
}

// ------------------------------------------------------------ public shots

async function readable(expedition: string) {
  const res = await fetch(
    `${PUBLIC_URL}/api/pull?expedition=${expedition}&limit=1`
  )
  return res.ok
}

/** Folds an Expedition's op log into its live Concepts and Views. */
async function fold(request: (path: string) => Promise<unknown>, expedition: string) {
  const concepts = new Map<string, string>()
  const views = new Map<string, string>()
  let since = 0
  for (;;) {
    const page = (await request(
      `/api/pull?expedition=${expedition}&since=${since}&limit=1000`
    )) as {
      ops: { serverSeq: number; kind: string; target: string; path?: string; value?: unknown }[]
      more: boolean
    }
    for (const op of page.ops) {
      const value = op.value as { title?: string; label?: string } | undefined
      if (op.kind === "concept.create" && value?.title)
        concepts.set(value.title, op.target)
      if (op.kind === "concept.set" && op.path === "title")
        concepts.set(String(op.value), op.target)
      if (op.kind === "view.create" && value?.label)
        views.set(value.label, op.target)
      if (op.kind === "view.set" && op.path === "label")
        views.set(String(op.value), op.target)
    }
    if (!page.more || page.ops.length === 0) break
    since = page.ops.at(-1)!.serverSeq
  }
  return { concepts, views }
}

const publicFetch = async (path: string) => {
  const res = await fetch(PUBLIC_URL + path)
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}

async function capturePublic(browser: Browser, shot: PublicShot, manifest: Manifest) {
  for (const source of shot.sources) {
    if (!(await readable(source.expedition))) {
      log(`${shot.file}: ${source.expedition} isn't readable anonymously; skipped`)
      continue
    }
    let query = ""
    if (source.select) {
      const { concepts } = await fold(publicFetch, source.expedition)
      const id = concepts.get(source.select)
      if (id) query = `?concept=${id}`
      else log(`${shot.file}: no Concept "${source.select}"; nothing selected`)
    }
    const context = await newContext(browser, PUBLIC_URL)
    try {
      const page = await context.newPage()
      await page.goto(`/e/${source.expedition}/${source.view}${query}`)
      await settled(page)
      if (query) await steady(page.getByTestId("side-panel"))
      await shoot({ page, close: async () => {} }, shot.file)
    } finally {
      await context.close()
    }
    const from = `${PUBLIC_URL}/e/${source.expedition}/${source.view}`
    manifest.shots[shot.file] = {
      from,
      ...(source.alt ? { alt: source.alt } : {}),
      capturedAt: new Date().toISOString(),
    }
    delete manifest.skipped[shot.file]
    log(`${shot.file}: captured from ${from}`)
    return
  }
  manifest.skipped[shot.file] = "no readable source (private Expedition?)"
  delete manifest.shots[shot.file]
  // An older capture of a showcase that is no longer public goes too.
  for (const theme of THEMES)
    for (const ext of ["webp", "avif"])
      rmSync(join(OUT, `${shot.file}-${theme}.${ext}`), { force: true })
}

// --------------------------------------------------------- signed-in shots

type App = {
  browser: Browser
  baseURL: string
  /** A fresh reader, signed in, on its own page (and context). */
  reader: (name: string) => Promise<Reader>
  /** Every page opened, for a debug screenshot when a shot fails. */
  pages: Page[]
}
type Reader = {
  context: BrowserContext
  page: Page
  email: string
  get: (path: string) => Promise<unknown>
  post: (path: string, data: unknown) => Promise<unknown>
  put: (path: string, data: unknown) => Promise<unknown>
}

function appOf(browser: Browser, baseURL: string): App {
  const pages: Page[] = []
  return {
    browser,
    baseURL,
    pages,
    async reader(name) {
      const context = await newContext(browser, baseURL)
      const page = await context.newPage()
      pages.push(page)
      const email = `capture-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
      const call = async (method: "get" | "post" | "put", path: string, data?: unknown) => {
        const res = await page.request[method](path, data === undefined ? {} : { data })
        if (!res.ok()) throw new Error(`${method.toUpperCase()} ${path}: ${res.status()} ${await res.text()}`)
        return res.headers()["content-type"]?.includes("json") ? res.json() : res.text()
      }
      await call("post", "/api/auth/sign-up/email", {
        email,
        password: "capture password, long enough",
        name,
      })
      return {
        context,
        page,
        email,
        get: (path) => call("get", path),
        post: (path, data) => call("post", path, data),
        put: (path, data) => call("put", path, data),
      }
    },
  }
}

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as unknown

async function importFixture(r: Reader, name: string) {
  const out = (await r.post("/api/import", fixture(name))) as {
    expedition: { id: string }
  }
  return out.expedition.id
}

/** Moves the mouse onto an element, in a few steps (a live cursor follows). */
async function pointAt(page: Page, el: Locator, at = 0.4) {
  const box = await el.boundingBox()
  if (!box) throw new Error("nothing to point at")
  await page.mouse.move(box.x + box.width * at, box.y + box.height * 0.5, {
    steps: 5,
  })
}

/** An E-bike start, written for the screenshot (synthetic, not a real chat). */
const QUESTION = "Which e-bike gets me up the hills on my 14 km commute?"
const SKIM_VIEW = (
  id: string,
  viewType: string,
  label: string,
  question: string,
  why: string,
  on: boolean
) => ({ id, viewType, label, question, why, on, confidence: "high" })
const SKIM = {
  title: "E-bike for the commute",
  summary:
    "Choosing an e-bike for a hilly 14 km commute: what matters on a climb, and how three bikes compare.",
  views: [
    SKIM_VIEW("v-path", "learning-path", "What to learn first", "What do I need to understand before I choose?", "You're new to e-bikes and asked where to start", true),
    SKIM_VIEW("v-compare", "comparison-table", "Compare the bikes", "How do these bikes stack up on climbing, upkeep, weight and price?", "You're choosing between a few bikes", true),
    SKIM_VIEW("v-motor", "cause-and-effect", "Mid-drive or hub", "If I pick mid-drive or hub, what follows?", "The motor decides how a bike climbs", true),
    SKIM_VIEW("v-costs", "timeline", "Three years of costs", "What will it cost me over three years?", "Running costs add up over time", false),
  ],
}

const APP_SHOTS: AppShot[] = [
  {
    file: "16-new-expedition",
    from: "the create flow, with a synthetic question and a stubbed skim",
    async setup(app) {
      const ada = await app.reader("Ada Lovelace")
      // Bring-your-own-key mode: a (fake) key makes the estimate available.
      await ada.put("/api/ai/keys/anthropic", { apiKey: "sk-ant-capture-not-a-real-key" })
      const { page } = ada
      await page.route("**/api/expeditions/*/skim", (route) =>
        route.fulfill({ json: { skim: SKIM, run: { ms: 400, usd: 0.008, model: "stub" } } })
      )
      await page.goto("/")
      await page.getByRole("button", { name: "New", exact: true }).click()
      await page.getByRole("tab", { name: "Just a prompt" }).click()
      await page.getByLabel("What do you want to understand?").fill(QUESTION)
      await page.getByRole("button", { name: "Add this prompt" }).click()
      await page.getByRole("button", { name: "Next: choose Views" }).click()
      await page.getByTestId("view-card").nth(SKIM.views.length - 1).waitFor()
      await page.evaluate(() => window.scrollTo(0, 0))
      return { page, close: () => ada.context.close() }
    },
  },
  {
    file: "17-mid-build",
    from: "an empty Expedition and the test-only fake build job, with E-bike titles",
    async setup(app) {
      const ada = await app.reader("Ada Lovelace")
      const { id } = (await ada.post("/api/expeditions", { title: SKIM.title })) as { id: string }
      const { page } = ada
      await page.goto(`/e/${id}`)
      await page.getByRole("heading", { name: SKIM.title }).waitFor()
      const ebike = fixture("ebike") as { concepts: { title: string; kind: string }[] }
      const previews = ebike.concepts
        .filter((c) => c.kind !== "builtin:topic")
        .slice(0, 7)
        .map((c) => c.title)
      await ada.post(`/api/expeditions/${id}/jobs`, {
        kind: "fake",
        input: {
          views: 3,
          stepMs: 30_000,
          labels: SKIM.views.slice(0, 3).map((v) => v.label),
          // Valid (empty) settings for each View Type; the fake job builds nothing.
          viewTypes: [
            { viewType: "learning-path", settings: { relationshipTypes: [] } },
            { viewType: "comparison-table", settings: { rows: {}, columns: [] } },
            {
              viewType: "cause-and-effect",
              settings: { mode: "mechanism", positive: [], negative: [], outcomes: [], levers: {} },
            },
          ],
          previews: [previews],
        },
      })
      const building = page.getByTestId("view-building")
      await building
        .getByTestId("preview-node")
        .nth(previews.length - 1)
        .waitFor()
        .catch(async (err: unknown) => {
          const jobs = await ada.get(`/api/expeditions/${id}/jobs`)
          throw new Error(`${err}\njobs: ${JSON.stringify(jobs)}`)
        })
      return {
        page,
        close: async () => {
          const { jobs } = (await ada.get(`/api/expeditions/${id}/jobs`)) as { jobs: { id: string }[] }
          for (const j of jobs) await ada.post(`/api/jobs/${j.id}/cancel`, {}).catch(() => {})
          await ada.context.close()
        },
      }
    },
  },
  {
    file: "15-concept-panel",
    from: "the compute fixture: Grouped-Query Attention at article depth",
    async setup(app) {
      const ada = await app.reader("Ada Lovelace")
      const id = await importFixture(ada, "compute")
      const { concepts, views } = await fold(ada.get, id)
      const view = [...views].find(([label]) => /Techniques/.test(label))?.[1] ?? ""
      const gqa = concepts.get("Grouped-Query Attention (GQA)")
      const { page } = ada
      await page.goto(`/e/${id}/${view}?concept=${gqa}`)
      await settled(page)
      const panel = page.getByTestId("side-panel")
      await panel.getByRole("button", { name: /Read the full article/ }).click()
      await panel.getByTestId("article-section").first().waitFor()
      await steady(panel)
      return { page, close: () => ada.context.close() }
    },
  },
  {
    file: "19-two-readers",
    from: "the E-bike fixture, three readers on its Learning path",
    async setup(app) {
      const ada = await app.reader("Ada Lovelace")
      const ed = await app.reader("Ed Hopper")
      const bo = await app.reader("Bo Lindqvist")
      const id = await importFixture(ada, "ebike")
      for (const r of [ed, bo])
        await ada.post(`/api/expeditions/${id}/invites`, { email: r.email, role: "editor" })
      const { views } = await fold(ada.get, id)
      const view = [...views].find(([label]) => /Learning path/.test(label))?.[1] ?? ""
      for (const r of [ada, ed, bo]) {
        await r.page.goto(`/e/${id}/${view}`)
        await settled(r.page)
      }
      const concepts = (p: Page) =>
        p.getByTestId("canvas-pane").locator("[data-concept]")
      const point = async () => {
        await pointAt(ada.page, concepts(ada.page).nth(1), 0.3)
        await pointAt(bo.page, concepts(bo.page).nth(4), 0.6)
      }
      await point()
      const cursors = ed.page.getByTestId("live-cursor")
      await cursors.nth(1).waitFor()
      await ed.page.getByTestId("presence-avatar").nth(1).waitFor()
      return {
        page: ed.page,
        refresh: async () => {
          // Nudge both cursors so they stay fresh across the theme switch.
          await ada.page.mouse.move(0, 0)
          await bo.page.mouse.move(0, 0)
          await point()
          await cursors.nth(1).waitFor()
        },
        close: async () => {
          for (const r of [ada, ed, bo]) await r.context.close()
        },
      }
    },
  },
]

/** Starts the Worker as the e2e tests do (apps/web/playwright.config.ts). */
async function startWorker(): Promise<{ url: string; stop: () => void }> {
  const url = `http://localhost:${APP_PORT}`
  const vars = {
    BETTER_AUTH_URL: url,
    BETTER_AUTH_SECRET: "capture-only-secret-not-used-anywhere-else",
    AUTH_TEST_CREDENTIALS: "1",
    DB_BRANCH: "capture",
    AI_KEY_MODE: "byok",
    AI_KEYS_MASTER_KEY: "ZTJlLW9ubHktbWFzdGVyLWtleS0zMi1ieXRlcy1sb24=",
  }
  const child: ChildProcess = spawn(
    "pnpm",
    [
      "--filter",
      "@seply/worker",
      "exec",
      "wrangler",
      "dev",
      "--port",
      String(APP_PORT),
      ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`]),
    ],
    {
      cwd: REPO,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: DATABASE_URL,
        WRANGLER_SEND_METRICS: "false",
      },
    }
  )
  let output = ""
  child.stdout?.on("data", (d) => (output += d))
  child.stderr?.on("data", (d) => (output += d))
  const stop = () => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM")
    } catch {
      // Already gone.
    }
  }
  const end = Date.now() + 120_000
  while (Date.now() < end) {
    if (child.exitCode !== null) break
    try {
      if ((await fetch(`${url}/api/health`)).ok) return { url, stop }
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  stop()
  throw new Error(`The Worker didn't start on ${url}:\n${output.slice(-4000)}`)
}

// -------------------------------------------------------------------- main

async function main() {
  mkdirSync(OUT, { recursive: true })
  mkdirSync(DEBUG_DIR, { recursive: true })
  const manifest = readManifest()
  const wanted = (file: string) => !ONLY || ONLY.includes(file)
  const failed: string[] = []
  // MapLibre needs WebGL; headless Chromium gets it from SwiftShader.
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  })
  let worker: { url: string; stop: () => void } | null = null
  try {
    if (runPublic)
      for (const shot of PUBLIC_SHOTS.filter((s) => wanted(s.file))) {
        try {
          await capturePublic(browser, shot, manifest)
        } catch (err) {
          failed.push(shot.file)
          console.error(`[capture] ${shot.file} failed:`, err)
        }
      }

    const appShots = runApp ? APP_SHOTS.filter((s) => wanted(s.file)) : []
    let baseURL = process.env.CAPTURE_APP_URL?.replace(/\/$/, "")
    if (appShots.length && !baseURL) {
      if (DATABASE_URL) {
        log(`starting the Worker on :${APP_PORT}`)
        worker = await startWorker()
        baseURL = worker.url
      } else {
        log("no CAPTURE_DATABASE_URL or CAPTURE_APP_URL: signed-in shots skipped")
        for (const s of appShots) manifest.skipped[s.file] ??= "no app to capture from"
      }
    }
    if (baseURL) {
      const app = appOf(browser, baseURL)
      for (const shot of appShots) {
        let scene: Scene | null = null
        try {
          scene = await shot.setup(app)
          await shoot(scene, shot.file)
          manifest.shots[shot.file] = {
            from: shot.from,
            capturedAt: new Date().toISOString(),
          }
          delete manifest.skipped[shot.file]
          log(`${shot.file}: captured from ${shot.from}`)
        } catch (err) {
          failed.push(shot.file)
          console.error(`[capture] ${shot.file} failed:`, err)
          for (const [i, page] of app.pages.entries()) {
            const path = join(DEBUG_DIR, `${shot.file}-${i}.png`)
            if (await page.screenshot({ path }).catch(() => null))
              console.error(`[capture] what it looked like: ${path}`)
          }
        } finally {
          await scene?.close().catch(() => {})
          app.pages.length = 0
        }
      }
    }
  } finally {
    await browser.close()
    worker?.stop()
  }

  manifest.capturedAt = new Date().toISOString()
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
  const skipped = Object.entries(manifest.skipped)
  if (skipped.length)
    log(`skipped (placeholder stays): ${skipped.map(([f, why]) => `${f} (${why})`).join(", ")}`)
  if (failed.length) {
    console.error(`[capture] failed: ${failed.join(", ")}`)
    process.exitCode = 1
  }
}

await main()
