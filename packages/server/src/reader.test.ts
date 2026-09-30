// Per-reader state: GET/POST /reader and Continue reading, over PGlite.
import {
  keyBetween,
  makeOps,
  schema,
  ulidSequence,
  type ReaderBatch,
} from "@seply/domain"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import type { ReaderSnapshot } from "./reader.ts"
import type { Relay } from "./relay.ts"
import {
  signUp,
  TEST_ENV,
  testApp,
  testDb,
  type TestUser,
} from "./test-harness.ts"

const at = (s: number) => new Date(Date.UTC(2026, 8, 1, 0, 0, s)).toISOString()

async function setup(relay?: Relay) {
  const db = await testDb()
  const app = testApp(TEST_ENV, db, relay)
  const ada = await signUp(app, "ada")
  const ed = await signUp(app, "ed")
  const create = async (user: TestUser, title: string) => {
    const res = await app.request("/api/expeditions", {
      method: "POST",
      headers: user.headers,
      body: JSON.stringify({ title }),
    })
    return ((await res.json()) as { id: string }).id
  }
  const exp = await create(ada, "Compute")
  // One Learning path View, so personal settings have a View Type.
  const ops = makeOps(
    [
      {
        kind: "view.create",
        target: "v1",
        value: {
          viewType: "learning-path",
          label: "Path",
          orderKey: keyBetween(null, null),
          settings: { relationshipTypes: ["builtin:prerequisite"] },
        },
      },
    ],
    {
      expeditionId: exp,
      actor: ada.id,
      changeId: "ch1",
      nextOpId: ulidSequence(Date.now() + 1000),
    }
  )
  const pushed = await app.request("/api/push", {
    method: "POST",
    headers: ada.headers,
    body: JSON.stringify({ expeditionId: exp, ops }),
  })
  if (pushed.status !== 200) throw new Error(await pushed.text())

  const save = (user: TestUser | null, body: unknown) =>
    app.request("/api/reader", {
      method: "POST",
      headers: user?.headers ?? { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  const state = async (user: TestUser, id = exp) => {
    const res = await app.request(`/api/reader/expeditions/${id}`, {
      headers: user.headers,
    })
    expect(res.status).toBe(200)
    return (await res.json()) as ReaderSnapshot
  }
  return { db, app, ada, ed, exp, create, save, state }
}

const mark = (
  exp: string,
  conceptId: string,
  state: "unread" | "read" | "known",
  s: number
) => ({ expeditionId: exp, conceptId, state, at: at(s) })

describe("per-reader state", () => {
  it("needs a session", async () => {
    const { save, app, exp } = await setup()
    expect((await save(null, { reading: [] })).status).toBe(401)
    expect((await app.request(`/api/reader/expeditions/${exp}`)).status).toBe(
      401
    )
  })

  it("saves Reading status; the newest mark wins and ties keep the row", async () => {
    const { save, state, ada, exp } = await setup()
    const res = await save(ada, {
      reading: [mark(exp, "c1", "read", 2), mark(exp, "c2", "known", 2)],
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      saved: { reading: 2, viewSettings: 0, positions: 0 },
      skipped: [],
    })
    // An older mark (another device's, queued offline) doesn't win.
    await save(ada, { reading: [mark(exp, "c1", "unread", 1)] })
    // A newer one does; duplicates in one batch keep the newest.
    await save(ada, {
      reading: [mark(exp, "c2", "unread", 5), mark(exp, "c2", "read", 4)],
    })
    const st = await state(ada)
    const by = Object.fromEntries(st.reading.map((r) => [r.conceptId, r]))
    expect(by.c1).toEqual(mark(exp, "c1", "read", 2))
    expect(by.c2).toEqual(mark(exp, "c2", "unread", 5))
  })

  it("is private: another reader sees only their own", async () => {
    const { save, state, ada, ed, exp, db } = await setup()
    await save(ada, { reading: [mark(exp, "c1", "read", 1)] })
    // Ed can't view Ada's private Expedition: his marks are skipped.
    const res = await save(ed, { reading: [mark(exp, "c1", "known", 2)] })
    expect(await res.json()).toMatchObject({
      saved: { reading: 0 },
      skipped: [exp],
    })
    // Made public, Ed can mark it, and each sees only their own.
    await db
      .update(schema.expeditions)
      .set({ visibility: "public" })
      .where(eq(schema.expeditions.id, exp))
    await save(ed, { reading: [mark(exp, "c1", "known", 2)] })
    expect((await state(ada)).reading.map((r) => r.state)).toEqual(["read"])
    expect((await state(ed)).reading.map((r) => r.state)).toEqual(["known"])
  })

  it("validates personal settings against the View Type", async () => {
    const { save, state, ada, exp } = await setup()
    const vs = (viewId: string, settings: unknown, s = 1) => ({
      expeditionId: exp,
      viewId,
      settings,
      at: at(s),
    })
    const res = await save(ada, {
      viewSettings: [
        vs("v1", { hideRead: true }),
        vs("v1", { hideRead: "yes" }, 2), // invalid: skipped
        vs("v1", { colour: "red" }, 3), // not a personal setting: skipped
        vs("nope", { hideRead: true }), // no such View: skipped
      ],
    })
    expect(await res.json()).toMatchObject({ saved: { viewSettings: 1 } })
    expect((await state(ada)).viewSettings).toEqual([
      vs("v1", { hideRead: true }),
    ])
    // Reset: an empty object.
    await save(ada, { viewSettings: [vs("v1", {}, 9)] })
    expect((await state(ada)).viewSettings[0]!.settings).toEqual({})
  })

  it("rejects malformed batches", async () => {
    const { save, ada, exp } = await setup()
    const bad = await save(ada, {
      reading: [{ ...mark(exp, "c1", "read", 1), state: "seen" }],
    })
    expect(bad.status).toBe(400)
  })

  it("clamps marks from the future to now", async () => {
    const { save, state, ada, exp } = await setup()
    const future = new Date(Date.now() + 86_400_000).toISOString()
    await save(ada, {
      reading: [{ ...mark(exp, "c1", "read", 1), at: future }],
    })
    const [row] = (await state(ada)).reading
    expect(Date.parse(row!.at)).toBeLessThanOrEqual(Date.now())
  })

  it("keeps one position per Expedition; Continue reading lists the newest first", async () => {
    const { save, app, ada, exp, create } = await setup()
    const other = await create(ada, "Other")
    const third = await create(ada, "Third")
    const pos = (e: string, s: number, viewId: string | null = null) => ({
      expeditionId: e,
      viewId,
      focusConceptId: "c1",
      step: null,
      panelDepth: "overview" as const,
      at: at(s),
    })
    await save(ada, {
      positions: [pos(exp, 1, "v1"), pos(exp, 3, "v1"), pos(other, 2)],
    })
    await save(ada, { positions: [pos(third, 4)] })
    const res = await app.request("/api/reader/recent?limit=2", {
      headers: ada.headers,
    })
    const { items } = (await res.json()) as {
      items: { expedition: { id: string; title: string }; position: unknown }[]
    }
    expect(items.map((i) => i.expedition.title)).toEqual(["Third", "Compute"])
    expect(items[1]!.position).toEqual(pos(exp, 3, "v1"))
  })

  it("tells the relay's reader channel, and only about the saver", async () => {
    const heard: { userId: string; marks: ReaderBatch }[] = []
    const relay: Relay = {
      published() {},
      reader: (userId, marks) => {
        heard.push({ userId, marks })
      },
    }
    const { save, ada, exp } = await setup(relay)
    await save(ada, { reading: [mark(exp, "c1", "read", 1)] })
    await save(ada, { reading: [] })
    expect(heard).toHaveLength(1)
    expect(heard[0]!.userId).toBe(ada.id)
    expect(heard[0]!.marks.reading).toEqual([mark(exp, "c1", "read", 1)])
  })
})
