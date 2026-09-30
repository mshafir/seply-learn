import { expect, test, type Page } from "@playwright/test"
import { spawn, type ChildProcess } from "node:child_process"
import {
  createDecipheriv,
  createECDH,
  createHmac,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

// WP-3.2's "done when": a fake multi-step job survives a forced step failure
// and a Worker restart, and its progress events reach the browser. This spec
// runs its own `wrangler dev` (the Worker, its Expedition room Durable Object
// and its jobs Workflow, persisted to a temp dir) so it can kill and restart
// it mid-job, plus a fake web push service to catch the notification.
// Needs E2E_DATABASE_URL (a migrated Postgres); see playwright.config.ts.
test.skip(
  !process.env.E2E_DATABASE_URL && !process.env.CI,
  "set E2E_DATABASE_URL to a migrated Postgres to run the API tests"
)
test.describe.configure({ mode: "serial" })

const PORT = Number(process.env.E2E_JOBS_PORT ?? 8789)
const ORIGIN = `http://localhost:${PORT}`
const WORKER_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../worker"
)
const WRANGLER = join(WORKER_DIR, "node_modules/.bin/wrangler")

type Msg = {
  t: string
  jobId?: string
  viewId?: string
  status?: string
  step?: string
  reason?: string
  previewNodes?: unknown[]
  builds?: unknown[]
}

// --- The Worker, restartable -------------------------------------------------

let persistTo = ""
let worker: ChildProcess | null = null
let workerLog = ""

function vapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  })
  const pub = publicKey.export({ format: "jwk" })
  const b64 = (s: string) => Buffer.from(s, "base64url")
  return {
    publicKey: Buffer.concat([
      Buffer.from([4]),
      b64(pub.x!),
      b64(pub.y!),
    ]).toString("base64url"),
    privateKey: privateKey.export({ format: "jwk" }).d!,
  }
}
const vapid = vapidKeys()

async function startWorker() {
  workerLog = ""
  const vars = {
    BETTER_AUTH_URL: ORIGIN,
    BETTER_AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else",
    AUTH_TEST_CREDENTIALS: "1",
    DB_BRANCH: "e2e-jobs",
    JOBS_WAKE_ON_START: "1",
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "mailto:e2e@example.com",
  }
  const args = [
    "dev",
    "--port",
    String(PORT),
    "--inspector-port",
    String(PORT + 1000),
    "--persist-to",
    persistTo,
    ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`]),
  ]
  const child = spawn(WRANGLER, args, {
    cwd: WORKER_DIR,
    // Its own process group, so a kill takes workerd with it.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
        process.env.E2E_DATABASE_URL,
      WRANGLER_SEND_METRICS: "false",
    },
  })
  child.stdout!.on("data", (d) => (workerLog += d))
  child.stderr!.on("data", (d) => (workerLog += d))
  worker = child
  const end = Date.now() + 90_000
  while (Date.now() < end) {
    if (child.exitCode !== null)
      throw new Error(`wrangler exited:\n${workerLog}`)
    try {
      const res = await fetch(`${ORIGIN}/api/health`)
      if (res.ok) return
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`wrangler did not start:\n${workerLog}`)
}

/** Kills the Worker outright (workerd included): no graceful shutdown. */
async function killWorker() {
  const child = worker
  if (!child || child.exitCode !== null) return
  const exited = new Promise((r) => child.once("exit", r))
  process.kill(-child.pid!, "SIGKILL")
  await exited
  worker = null
  // Let the port go.
  await new Promise((r) => setTimeout(r, 500))
}

// --- A fake push service -----------------------------------------------------

let pushServer: Server
const pushed: Buffer[] = []

test.beforeAll(async () => {
  test.setTimeout(120_000)
  persistTo = mkdtempSync(join(tmpdir(), "seply-e2e-jobs-"))
  pushServer = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => {
      pushed.push(Buffer.concat(chunks))
      res.writeHead(201).end()
    })
  })
  await new Promise<void>((r) => pushServer.listen(0, "127.0.0.1", r))
  await startWorker()
})

test.afterAll(async () => {
  await killWorker()
  await new Promise((r) => pushServer?.close(r))
  if (persistTo) rmSync(persistTo, { recursive: true, force: true })
})

// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus)
    await testInfo.attach("wrangler.log", { body: workerLog })
})

/** A browser on the Worker's origin, signed in, subscribed to web push. */
async function reader(page: Page) {
  await page.goto(`${ORIGIN}/`)
  const email = `e2e-jobs-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const signUp = await page.request.post(`${ORIGIN}/api/auth/sign-up/email`, {
    headers: { origin: ORIGIN },
    data: { email, password: "e2e password, long enough", name: "Job Tester" },
  })
  expect(signUp.ok()).toBe(true)
  const created = await page.request.post(`${ORIGIN}/api/expeditions`, {
    headers: { origin: ORIGIN },
    data: { title: "Jobs" },
  })
  expect(created.status()).toBe(201)
  const exp: string = (await created.json()).id

  // This browser's push subscription, pointed at the fake push service.
  const ecdh = createECDH("prime256v1")
  ecdh.generateKeys()
  const auth = randomBytes(16)
  const { port } = pushServer.address() as AddressInfo
  const sub = await page.request.post(`${ORIGIN}/api/web-push/subscriptions`, {
    headers: { origin: ORIGIN },
    data: {
      endpoint: `http://localhost:${port}/push/${exp}`,
      keys: {
        p256dh: ecdh.getPublicKey().toString("base64url"),
        auth: auth.toString("base64url"),
      },
    },
  })
  expect(sub.status()).toBe(201)
  return { exp, decrypt: (body: Buffer) => decrypt(body, ecdh, auth) }
}

/** Connects the page to the Expedition's room, reconnecting as a client does. */
async function listen(page: Page, exp: string) {
  await page.evaluate((url) => {
    const w = window as unknown as { room: { msgs: unknown[] } }
    w.room = { msgs: [] }
    const connect = () => {
      const ws = new WebSocket(url)
      ws.onmessage = (e) => w.room.msgs.push(JSON.parse(e.data))
      ws.onclose = () => setTimeout(connect, 300)
    }
    connect()
  }, `ws://localhost:${PORT}/api/expeditions/${exp}/live`)
}

const received = (page: Page): Promise<Msg[]> =>
  page.evaluate(
    () => (window as unknown as { room: { msgs: Msg[] } }).room.msgs
  )

async function waitFor(
  page: Page,
  pred: (m: Msg) => boolean,
  timeout = 60_000
) {
  await expect
    .poll(async () => (await received(page)).some(pred), { timeout })
    .toBe(true)
}

async function db<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL })
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

/** RFC 8291 decryption, as a browser does it. */
function decrypt(
  body: Buffer,
  ecdh: ReturnType<typeof createECDH>,
  auth: Buffer
) {
  const hmac = (k: Buffer, d: Buffer) =>
    createHmac("sha256", k).update(d).digest()
  const expand = (prk: Buffer, info: Buffer, n: number) =>
    hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, n)
  const salt = body.subarray(0, 16)
  const idlen = body[20]!
  const sender = body.subarray(21, 21 + idlen)
  const ct = body.subarray(21 + idlen)
  const ikm = expand(
    hmac(auth, ecdh.computeSecret(sender)),
    Buffer.concat([
      Buffer.from("WebPush: info\0"),
      ecdh.getPublicKey(),
      sender,
    ]),
    32
  )
  const prk = hmac(salt, ikm)
  const d = createDecipheriv(
    "aes-128-gcm",
    expand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
    expand(prk, Buffer.from("Content-Encoding: nonce\0"), 12)
  )
  d.setAuthTag(ct.subarray(-16))
  const plain = Buffer.concat([d.update(ct.subarray(0, -16)), d.final()])
  return JSON.parse(plain.subarray(0, -1).toString("utf8"))
}

test("a fake job survives a forced step failure and a Worker restart, and the browser sees its progress", async ({
  page,
}) => {
  test.setTimeout(240_000)
  const { exp, decrypt } = await reader(page)
  await listen(page, exp)
  await waitFor(page, (m) => m.t === "hello")

  // Three Views; View 1's build step throws on its first try; each step
  // takes 3 s, long enough to kill the Worker in the middle of one.
  const start = await page.request.post(
    `${ORIGIN}/api/expeditions/${exp}/jobs`,
    {
      headers: { origin: ORIGIN },
      data: { kind: "fake", input: { views: 3, stepMs: 3000, failOnce: [1] } },
    }
  )
  expect(start.status()).toBe(201)
  const jobId: string = (await start.json()).job.id

  // View 1 is committed (after its retry) and View 2 is building: kill it.
  await waitFor(page, (m) => m.t === "build" && m.step === "Built 1 of 3")
  await waitFor(
    page,
    (m) => m.t === "build" && m.step === "Building Test View 2"
  )
  const hellosBefore = (await received(page)).filter(
    (m) => m.t === "hello"
  ).length
  await killWorker()
  const mid = await db((c) =>
    c.query("select status from jobs where id = $1", [jobId])
  )
  expect(mid.rows[0].status).toBe("running")

  await startWorker()
  // The page reconnects to the room, which greets it with the running build.
  await expect
    .poll(
      async () => (await received(page)).filter((m) => m.t === "hello").length,
      {
        timeout: 30_000,
      }
    )
    .toBeGreaterThan(hellosBefore)
  const hello = (await received(page)).filter((m) => m.t === "hello").at(-1)!
  expect(hello.builds!.length).toBeGreaterThan(0)

  // …and the job finishes from where it was.
  await waitFor(
    page,
    (m) =>
      m.t === "build" &&
      !m.viewId &&
      m.jobId === jobId &&
      m.status === "complete",
    120_000
  )
  // wrangler dev doesn't resume Workflows by itself; the restarted Worker woke it.
  expect(workerLog).toMatch(/jobs: woke \d+ running job/)
  const msgs = await received(page)
  const views = await db((c) =>
    c.query(
      "select id, label, status from views where expedition_id = $1 and deleted_at is null order by label",
      [exp]
    )
  )
  expect(views.rows.map((v) => [v.label, v.status])).toEqual([
    ["Test View 1", "ready"],
    ["Test View 2", "ready"],
    ["Test View 3", "ready"],
  ])
  for (const v of views.rows) {
    const statuses = msgs.filter((m) => m.viewId === v.id).map((m) => m.status)
    expect(statuses).toContain("building")
    expect(statuses.at(-1)).toBe("ready")
  }
  expect(msgs.find((m) => m.status === "building")!.previewNodes).toHaveLength(
    2
  )
  // Every commit logged once, in order, despite the retry and the restart.
  const changes = await db((c) =>
    c.query(
      "select origin, label from changes where expedition_id = $1 order by first_seq",
      [exp]
    )
  )
  expect(changes.rows.map((r) => `${r.origin}: ${r.label}`)).toEqual([
    "human: Created the Expedition",
    "build: Queued the test Views",
    "build: Built Test View 1",
    "build: Built Test View 2",
    "build: Built Test View 3",
  ])
  const job = await page.request.get(`${ORIGIN}/api/jobs/${jobId}`)
  expect((await job.json()).job).toMatchObject({
    status: "complete",
    progress: 1,
  })

  // The reader's browser got a web push.
  await expect.poll(() => pushed.length, { timeout: 30_000 }).toBeGreaterThan(0)
  expect(decrypt(pushed.at(-1)!)).toEqual({
    title: "Test build finished",
    body: "Every test View is ready.",
    url: `/e/${exp}`,
    tag: `job-${jobId}`,
  })
})

test("a View that fails shows its reason, and Retry finishes the job", async ({
  page,
}) => {
  test.setTimeout(120_000)
  const { exp } = await reader(page)
  await listen(page, exp)
  await waitFor(page, (m) => m.t === "hello")
  const start = await page.request.post(
    `${ORIGIN}/api/expeditions/${exp}/jobs`,
    {
      headers: { origin: ORIGIN },
      data: { kind: "fake", input: { views: 2, failView: { n: 2 } } },
    }
  )
  const jobId: string = (await start.json()).job.id

  const reason = "Forced failure while building Test View 2"
  await waitFor(
    page,
    (m) => !m.viewId && m.jobId === jobId && m.status === "failed"
  )
  const failed = (await received(page)).filter((m) => m.status === "failed")
  expect(failed.map((m) => [m.viewId ? "view" : "job", m.reason])).toEqual([
    ["view", reason],
    ["job", reason],
  ])
  const failedView = await db((c) =>
    c.query(
      "select status, fail_reason from views where expedition_id = $1 and label = $2",
      [exp, "Test View 2"]
    )
  )
  expect(failedView.rows[0]).toEqual({ status: "failed", fail_reason: reason })

  const retry = await page.request.post(`${ORIGIN}/api/jobs/${jobId}/retry`, {
    headers: { origin: ORIGIN },
  })
  expect((await retry.json()).job).toMatchObject({
    status: "queued",
    attempt: 2,
  })
  await waitFor(
    page,
    (m) => !m.viewId && m.jobId === jobId && m.status === "complete"
  )
  const views = await db((c) =>
    c.query(
      "select label, status from views where expedition_id = $1 order by label",
      [exp]
    )
  )
  expect(views.rows).toEqual([
    { label: "Test View 1", status: "ready" },
    { label: "Test View 2", status: "ready" },
  ])
})
