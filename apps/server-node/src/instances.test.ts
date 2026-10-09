// WP-6.1's "done when": two Node instances on one database share live edits
// through Postgres LISTEN/NOTIFY. Two real server-node processes; an edit
// pushed to one reaches a WebSocket client of the other as `ops`, a large
// batch as `poke`, and collaborators on different instances see each other's
// presence and leave. Needs TEST_DATABASE_URL.
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  makeOps,
  parseRoomMessage,
  ulid,
  type OpBody,
  type RoomMessage,
} from "@seply/domain"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { freshDatabase, TEST_DATABASE_URL } from "./test/db.ts"

const APP_DIR = fileURLToPath(new URL("..", import.meta.url))

const freePort = () =>
  new Promise<number>((ok) => {
    const s = createServer()
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number }
      s.close(() => ok(port))
    })
  })

type Proc = { port: number; child: ChildProcess; log: string }

/** One server-node process, as `pnpm start` runs it. */
async function startInstance(
  env: Record<string, string>,
  port?: number
): Promise<Proc> {
  port ??= await freePort()
  const proc: Proc = { port, child: null!, log: "" }
  proc.child = spawn(
    process.execPath,
    [
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      "src/main.ts",
    ],
    {
      cwd: APP_DIR,
      env: { ...process.env, ...env, PORT: String(port), HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  proc.child.stdout!.on("data", (d) => (proc.log += d))
  proc.child.stderr!.on("data", (d) => (proc.log += d))
  const end = Date.now() + 60_000
  while (Date.now() < end) {
    if (proc.child.exitCode !== null)
      throw new Error(`server-node exited:\n${proc.log}`)
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return proc
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`server-node did not start:\n${proc.log}`)
}

/** A socket in a room, keeping what it hears. */
async function listen(port: number, exp: string, cookie: string) {
  const heard: RoomMessage[] = []
  const ws = new WebSocket(
    `ws://127.0.0.1:${port}/api/expeditions/${exp}/live`,
    {
      headers: { cookie },
    }
  )
  ws.on("message", (d) => {
    const m = parseRoomMessage(d.toString())
    if (m) heard.push(m)
  })
  await new Promise((ok, fail) => {
    ws.once("open", ok)
    ws.once("error", fail)
  })
  await until(() => heard.some((m) => m.t === "hello"))
  return { ws, heard }
}

async function until(pred: () => boolean, ms = 15_000) {
  const end = Date.now() + ms
  while (!pred()) {
    if (Date.now() > end) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe.skipIf(!TEST_DATABASE_URL)("two instances on one database", () => {
  let database: Awaited<ReturnType<typeof freshDatabase>>
  let a: Proc
  let b: Proc
  let origin = ""
  let cookie = ""
  let userId = ""

  beforeAll(async () => {
    database = await freshDatabase("instances")
    const shared = {
      DATABASE_URL: database.url,
      BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long!!",
      AUTH_TEST_CREDENTIALS: "1",
      WEB_DIST: "off",
      BLOB_DIR: mkdtempSync(join(tmpdir(), "seply-instances-")),
      SHUTDOWN_GRACE_SECONDS: "1",
    }
    // Both serve one origin (behind one load balancer); A's port names it.
    const portA = await freePort()
    origin = `http://localhost:${portA}`
    a = await startInstance({ ...shared, BETTER_AUTH_URL: origin }, portA)
    b = await startInstance({
      ...shared,
      BETTER_AUTH_URL: origin,
      MIGRATE_ON_START: "0",
    })

    const signUp = await fetch(
      `http://127.0.0.1:${a.port}/api/auth/sign-up/email`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({
          email: "ada@example.com",
          password: "correct horse battery staple",
          name: "Ada",
        }),
      }
    )
    expect(signUp.status).toBe(200)
    cookie = signUp.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ")
    const me = await api(b, "GET", "/me")
    userId = ((await me.json()) as { user: { id: string } }).user.id
  }, 180_000)

  afterAll(async () => {
    for (const p of [a, b]) {
      if (!p || p.child.exitCode !== null) continue
      const exited = new Promise((r) => p.child.once("exit", r))
      p.child.kill("SIGTERM")
      await exited
    }
    await database?.drop()
  })

  const api = (p: Proc, method: string, path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${p.port}/api${path}`, {
      method,
      headers: { cookie, origin, "content-type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })

  const newExpedition = async () => {
    const res = await api(a, "POST", "/expeditions", { title: "Shared" })
    expect(res.status).toBe(201)
    return ((await res.json()) as { id: string }).id
  }

  const push = async (p: Proc, exp: string, bodies: OpBody[]) => {
    const ops = makeOps(bodies, {
      expeditionId: exp,
      actor: userId,
      changeId: ulid(Date.now()),
      nextOpId: () => ulid(Date.now()),
    })
    const res = await api(p, "POST", "/push", { expeditionId: exp, ops })
    expect(res.status, await res.clone().text()).toBe(200)
    return ((await res.json()) as { headSeq: number }).headSeq
  }

  it("an edit pushed to one instance reaches a client of the other as ops", async () => {
    const exp = await newExpedition()
    const onB = await listen(b.port, exp, cookie)
    const headSeq = await push(a, exp, [
      {
        kind: "expedition.set",
        target: exp,
        path: "title",
        value: "Renamed on A",
      },
    ])
    await until(() => onB.heard.some((m) => m.t === "ops"))
    const ops = onB.heard.find((m) => m.t === "ops")!
    expect(ops).toMatchObject({ t: "ops", to: headSeq })
    expect(ops.t === "ops" && ops.ops[0]).toMatchObject({
      kind: "expedition.set",
      value: "Renamed on A",
      serverSeq: headSeq,
    })
    // …and the other way round.
    const onA = await listen(a.port, exp, cookie)
    const next = await push(b, exp, [
      { kind: "expedition.set", target: exp, path: "summary", value: "From B" },
    ])
    await until(() => onA.heard.some((m) => m.t === "ops" && m.to === next))
    onA.ws.close()
    onB.ws.close()
  })

  it("a batch too large for NOTIFY reaches the other instance as a poke", async () => {
    const exp = await newExpedition()
    const onB = await listen(b.port, exp, cookie)
    const onA = await listen(a.port, exp, cookie)
    const long = "x".repeat(9000)
    const headSeq = await push(a, exp, [
      { kind: "expedition.set", target: exp, path: "summary", value: long },
    ])
    // A's own clients get the ops; B's are poked and pull.
    await until(() => onA.heard.some((m) => m.t === "ops" && m.to === headSeq))
    await until(() =>
      onB.heard.some((m) => m.t === "poke" && m.headSeq === headSeq)
    )
    expect(onB.heard.some((m) => m.t === "ops")).toBe(false)
    onA.ws.close()
    onB.ws.close()
  })

  it("collaborators on different instances see each other's presence and leave", async () => {
    const exp = await newExpedition()
    const onA = await listen(a.port, exp, cookie)
    const onB = await listen(b.port, exp, cookie)
    const helloA = onA.heard.find((m) => m.t === "hello")!
    const idA = helloA.t === "hello" ? helloA.you! : ""
    onA.ws.send(
      JSON.stringify({
        t: "presence",
        view: null,
        cursor: { x: 0.25, y: 0.5 },
        selection: [],
      })
    )
    await until(() => onB.heard.some((m) => m.t === "presence" && m.id === idA))
    expect(
      onB.heard.find((m) => m.t === "presence" && m.id === idA)
    ).toMatchObject({
      userId,
      name: "Ada",
      cursor: { x: 0.25, y: 0.5 },
    })
    // A newcomer on B hears about A's collaborator in its hello.
    const late = await listen(b.port, exp, cookie)
    const hello = late.heard.find((m) => m.t === "hello")!
    expect(hello.t === "hello" && hello.presence.map((p) => p.id)).toContain(
      idA
    )

    onA.ws.close()
    await until(() => onB.heard.some((m) => m.t === "leave" && m.id === idA))
    late.ws.close()
    onB.ws.close()
  })

  it("a build's progress on one instance reaches the room on the other", async () => {
    const exp = await newExpedition()
    const onB = await listen(b.port, exp, cookie)
    const res = await api(a, "POST", `/expeditions/${exp}/jobs`, {
      kind: "fake",
      input: { views: 1 },
    })
    expect(res.status).toBe(201)
    const { job } = (await res.json()) as { job: { id: string } }
    await until(
      () =>
        onB.heard.some(
          (m) =>
            m.t === "build" &&
            m.jobId === job.id &&
            !m.viewId &&
            m.status === "complete"
        ),
      30_000
    )
    onB.ws.close()
  })
})
