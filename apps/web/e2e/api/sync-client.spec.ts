import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
} from "@playwright/test"
import {
  fetchTransport,
  MemoryPendingStore,
  openSyncClient,
  type PendingStore,
  type SyncClient,
  type SyncTransport,
} from "@umbel/sync"
import pg from "pg"

// The sync client (WP-1.3) against the real Worker and database: its fetch
// transport, push and pull, rebase and last-writer-wins, and pending ops
// surviving a "reload" (a new client over the same store). The browser-side
// IndexedDB mirroring is covered by packages/sync's Vitest suite (fake-indexeddb).
// Needs E2E_DATABASE_URL (a migrated Postgres); see playwright.config.ts.
test.skip(
  !process.env.E2E_DATABASE_URL && !process.env.CI,
  "set E2E_DATABASE_URL to a migrated Postgres to run the API tests"
)

/** fetch through a browser context's request API: its cookies, its baseURL. */
function fetchVia(request: APIRequestContext): typeof fetch {
  return (async (input: string, init: RequestInit = {}) => {
    const res = await request.fetch(input, {
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string> | undefined,
      data: init.body as string | undefined,
    })
    return new Response(await res.text(), {
      status: res.status(),
      headers: res.headers(),
    })
  }) as unknown as typeof fetch
}

async function person(browser: Browser, name: string) {
  const context = await browser.newContext()
  const email = `e2e-sync-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const signUp = await context.request.post("/api/auth/sign-up/email", {
    data: { email, password: "e2e password, long enough", name },
  })
  expect(signUp.status()).toBe(200)
  const me = await (await context.request.get("/api/me")).json()
  const transport = fetchTransport({ fetch: fetchVia(context.request) })
  return { context, id: me.user.id as string, transport }
}

function offlineable(t: SyncTransport) {
  const wrapped = {
    offline: false,
    push: (req: Parameters<SyncTransport["push"]>[0]) =>
      wrapped.offline
        ? Promise.reject(new TypeError("Failed to fetch"))
        : t.push(req),
    pull: (req: Parameters<SyncTransport["pull"]>[0]) =>
      wrapped.offline
        ? Promise.reject(new TypeError("Failed to fetch"))
        : t.pull(req),
  }
  return wrapped
}

test("sync client: rebase, last writer wins, and a reload loses no pending ops", async ({
  browser,
}) => {
  const ada = await person(browser, "Ada")
  const ed = await person(browser, "Ed")
  const created = await ada.context.request.post("/api/expeditions", {
    data: { title: "Compute" },
  })
  expect(created.status()).toBe(201)
  const exp: string = (await created.json()).id
  // No invite API yet (M3): add Ed as an editor directly.
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL })
  await db.connect()
  try {
    await db.query(
      "insert into collaborators (expedition_id, user_id, role) values ($1, $2, 'editor')",
      [exp, ed.id]
    )
  } finally {
    await db.end()
  }

  const clients: SyncClient[] = []
  const open = async (
    who: typeof ada,
    store: PendingStore,
    transport: SyncTransport = who.transport
  ) => {
    const c = await openSyncClient({
      expeditionId: exp,
      actor: who.id,
      transport,
      store,
      autoPush: false,
      collections: { id: `${who.id}:${clients.length}` },
    })
    clients.push(c)
    return c
  }

  try {
    const a = await open(ada, new MemoryPendingStore())
    const e = await open(ed, new MemoryPendingStore())
    expect(a.collections.expeditions.get(exp)?.title).toBe("Compute")

    // Ada adds two Concepts through the collections.
    for (const [id, title] of [
      ["c-kv", "KV cache"],
      ["c-attn", "Attention"],
    ])
      a.collections.concepts.insert({
        id,
        title,
        kind: "builtin:idea",
        aliases: [],
        tags: [],
        attributes: {},
        overviewProv: [],
        prov: [],
        deletedAt: null,
      })
    await a.push()
    await e.pull()
    expect(e.collections.concepts.size).toBe(2)

    // Both rename the same Concept: Ada pushes first, Ed second. Ed's stays on
    // top while it is pending, and wins everywhere once pushed.
    a.collections.concepts.update("c-kv", (d) => {
      d.title = "Ada's title"
    })
    e.collections.concepts.update("c-kv", (d) => {
      d.title = "Ed's title"
    })
    e.collections.concepts.update("c-attn", (d) => {
      d.summary = "Ed's summary"
    })
    await a.push()
    await e.pull()
    expect(e.collections.concepts.get("c-kv")?.title).toBe("Ed's title")
    await e.push()
    await a.pull()
    for (const c of [a, e]) {
      expect(c.collections.concepts.get("c-kv")?.title).toBe("Ed's title")
      expect(c.collections.concepts.get("c-attn")?.summary).toBe("Ed's summary")
      expect(c.engine.pending).toHaveLength(0)
    }

    // An op the server refuses (409): Ed links to a Concept Ada deletes first.
    e.collections.relationships.insert({
      key: "c-kv|builtin:prerequisite|c-attn",
      from: "c-kv",
      type: "builtin:prerequisite",
      to: "c-attn",
      prov: [],
      deletedAt: null,
    })
    a.collections.concepts.delete("c-attn")
    await a.push()
    await e.push() // 409 → pull → the rebase drops the link
    expect(e.engine.pending).toHaveLength(0)
    expect(e.collections.relationships.size).toBe(0)
    expect(e.collections.concepts.get("c-attn")).toBeUndefined()

    // Offline edits survive a reload (a new client over the same store).
    const store = new MemoryPendingStore()
    const flaky = offlineable(ada.transport)
    const before = await open(ada, store, flaky)
    flaky.offline = true
    before.collections.concepts.update("c-kv", (d) => {
      d.overview = "Written offline"
    })
    await expect(before.push()).rejects.toThrow(/Failed to fetch/)
    before.dispose()
    const after = await open(ada, store)
    expect(after.collections.concepts.get("c-kv")?.overview).toBe(
      "Written offline"
    )
    await after.push()
    await e.pull()
    expect(e.collections.concepts.get("c-kv")?.overview).toBe("Written offline")
  } finally {
    for (const c of clients) c.dispose()
    await ada.context.close()
    await ed.context.close()
  }
})
