// Visibility, Fork and Trash (WP-5.2, spec §1.4, §1.8, §3.9). Who may call
// each route is in permissions-matrix.test.ts; this file covers what they do.
import {
  isLive,
  makeOps,
  schema,
  ulidSequence,
  type OpBody,
} from "@seply/domain"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import { memoryBlobStore } from "./blobs.ts"
import type { HistoryPage } from "./history.ts"
import { loadState } from "./projection.ts"
import type { Relay } from "./relay.ts"
import type { SearchResults } from "./search.ts"
import type { Sharing } from "./sharing.ts"
import { forkLabel, type ForkResult } from "./fork.ts"
import { purgeTrash, TRASH_DAYS, trashExpedition } from "./trash.ts"
import type { TrashedCard } from "./trash.ts"
import {
  signUp,
  TEST_ENV,
  testApp,
  testDb,
  type TestUser,
} from "./test-harness.ts"

const DAY = 24 * 60 * 60 * 1000

async function setup() {
  const db = await testDb()
  const blobs = memoryBlobStore()
  const kicks: { exp: string; userId: string | null; reason: string }[] = []
  const relay: Relay = {
    published() {},
    kick: (exp, userId, reason) => void kicks.push({ exp, userId, reason }),
  }
  const app = testApp(TEST_ENV, db, relay, { blobs })
  const ada = await signUp(app, "ada")
  const bob = await signUp(app, "bob")
  const res = await app.request("/api/expeditions", {
    method: "POST",
    headers: ada.headers,
    body: JSON.stringify({ title: "Compute" }),
  })
  const { id } = (await res.json()) as { id: string }
  let clock = Date.now() + 1000
  /** Pushes `bodies` as one Change as `who`; returns the Change id. */
  const push = async (who: TestUser, label: string, bodies: OpBody[]) => {
    const changeId = `ch-${label.replace(/\W/g, "")}-${clock}`
    const r = await app.request("/api/push", {
      method: "POST",
      headers: who.headers,
      body: JSON.stringify({
        expeditionId: id,
        ops: makeOps(bodies, {
          expeditionId: id,
          actor: who.id,
          changeId,
          nextOpId: ulidSequence((clock += 1000)),
        }),
        changes: [{ id: changeId, label }],
      }),
    })
    expect(r.status, await r.clone().text()).toBe(200)
    return changeId
  }
  const call = (
    who: TestUser | null,
    path: string,
    init: { method?: string; body?: unknown } = {}
  ) =>
    app.request(path, {
      method: init.method ?? "GET",
      headers: who?.headers ?? { "content-type": "application/json" },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
    })
  const setVisibility = (who: TestUser, visibility: string) =>
    call(who, `/api/expeditions/${id}/visibility`, {
      method: "PATCH",
      body: { visibility },
    })
  return { db, blobs, kicks, app, ada, bob, id, push, call, setVisibility }
}

const concept = (target: string, title: string): OpBody => ({
  kind: "concept.create",
  target,
  value: { title, kind: "builtin:idea" },
})

describe("Visibility", () => {
  it("opens an unlisted link to anonymous readers, read-only, and closes it again when private", async () => {
    const s = await setup()
    await s.push(s.ada, "Added Attention", [concept("c-att", "Attention")])
    const pull = () => s.call(null, `/api/pull?expedition=${s.id}&since=0`)
    expect((await pull()).status).toBe(404)

    const res = await s.setVisibility(s.ada, "unlisted")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ visibility: "unlisted" })
    expect((await pull()).status).toBe(200)
    // Anyone may read, nobody but Collaborators may write.
    const anonPush = await s.call(null, "/api/push", {
      method: "POST",
      body: { expeditionId: s.id, ops: [{}] },
    })
    expect(anonPush.status).toBe(401)
    expect(s.kicks).toEqual([])

    // The share dialog says what each caller may do.
    const mine = (await (
      await s.call(s.ada, `/api/expeditions/${s.id}/sharing`)
    ).json()) as Sharing
    expect(mine.visibility).toBe("unlisted")
    expect(mine.may).toMatchObject({
      changeVisibility: true,
      fork: true,
      trashExpedition: true,
    })
    const bobs = (await (
      await s.call(s.bob, `/api/expeditions/${s.id}/sharing`)
    ).json()) as Sharing
    expect(bobs.role).toBeNull()
    expect(bobs.may).toMatchObject({
      invite: false,
      changeVisibility: false,
      fork: true,
      trashExpedition: false,
    })
    expect(bobs.collaborators.every((p) => p.email === "")).toBe(true)

    // Back to private: readers of the link are kicked, and lose access.
    expect((await s.setVisibility(s.ada, "private")).status).toBe(200)
    expect(s.kicks).toEqual([
      {
        exp: s.id,
        userId: null,
        reason: "The owner made this Expedition private",
      },
    ])
    expect((await pull()).status).toBe(404)
  })

  it("lists public Expeditions in search, never unlisted ones", async () => {
    const s = await setup()
    await s.push(s.ada, "Added Attention", [concept("c-att", "Attention")])
    const find = async () =>
      (await (
        await s.call(s.bob, "/api/search?q=Attention&public=1")
      ).json()) as SearchResults
    expect((await find()).concepts).toHaveLength(0)
    await s.setVisibility(s.ada, "unlisted")
    expect((await find()).concepts).toHaveLength(0)
    await s.setVisibility(s.ada, "public")
    const hits = await find()
    expect(hits.concepts.map((c) => c.title)).toEqual(["Attention"])
    // Without the toggle, only my own.
    const own = (await (
      await s.call(s.bob, "/api/search?q=Attention")
    ).json()) as SearchResults
    expect(own.concepts).toHaveLength(0)
  })

  it("refuses an unknown Visibility", async () => {
    const s = await setup()
    expect((await s.setVisibility(s.ada, "secret")).status).toBe(400)
  })
})

describe("Fork", () => {
  it("copies the current state with a fresh history and its own Sources", async () => {
    const s = await setup()
    await s.push(s.ada, "Added Attention", [concept("c-att", "Attention")])
    await s.push(s.ada, "Added MLA", [
      concept("c-mla", "MLA"),
      {
        kind: "relationship.add",
        target: "c-mla|builtin:prerequisite|c-att",
        value: {},
      },
    ])
    const added = await s.call(s.ada, `/api/sources/${s.id}`, {
      method: "POST",
      body: {
        type: "paste",
        text: "User: what is MLA?\nAssistant: A cache trick.",
      },
    })
    expect(added.status).toBe(201)
    const { source } = (await added.json()) as { source: { id: string } }
    await s.setVisibility(s.ada, "unlisted")

    // Bob, a reader of the link, forks it.
    const res = await s.call(s.bob, `/api/expeditions/${s.id}/fork`, {
      method: "POST",
      body: {},
    })
    expect(res.status, await res.clone().text()).toBe(201)
    const fork = (await res.json()) as ForkResult
    const [orig] = await s.db
      .select({ headSeq: schema.expeditions.headSeq })
      .from(schema.expeditions)
      .where(eq(schema.expeditions.id, s.id))
    expect(fork.forkedFrom).toEqual({ exp: s.id, seq: orig!.headSeq })
    expect(fork.expedition).toMatchObject({
      title: "Compute",
      visibility: "private",
      role: "owner",
    })
    const [row] = await s.db
      .select()
      .from(schema.expeditions)
      .where(eq(schema.expeditions.id, fork.expedition.id))
    expect(row).toMatchObject({
      ownerId: s.bob.id,
      forkedFrom: fork.forkedFrom,
    })

    // A fresh history: one Change, Bob's.
    const history = (await (
      await s.call(s.bob, `/api/history?expedition=${fork.expedition.id}`)
    ).json()) as HistoryPage
    expect(history.changes.map((c) => [c.label, c.author.id])).toEqual([
      [forkLabel("Compute"), s.bob.id],
    ])

    // The same Concepts and Relationships, under fresh ids.
    const state = (await loadState(s.db, fork.expedition.id))!
    const titles = Object.values(state.concepts)
      .filter(isLive)
      .map((c) => c.title)
      .sort()
    expect(titles).toEqual(["Attention", "MLA"])
    expect(state.concepts["c-att"]).toBeUndefined()
    expect(Object.values(state.relationships).filter(isLive)).toHaveLength(1)

    // The Source, with its own copy of the files.
    const [copy] = Object.values(state.sources)
    expect(copy!.id).not.toBe(source.id)
    expect(copy!.blobKey).toBe(`sources/${fork.expedition.id}/${copy!.id}/raw`)
    const read = await s.call(
      s.bob,
      `/api/sources/${fork.expedition.id}/${copy!.id}`
    )
    expect(read.status).toBe(200)
    expect(JSON.stringify(await read.json())).toContain("A cache trick.")

    // Edits to one never reach the other.
    await s.push(s.ada, "Renamed", [
      { kind: "expedition.set", target: s.id, path: "title", value: "Changed" },
    ])
    expect((await loadState(s.db, fork.expedition.id))!.expedition.title).toBe(
      "Compute"
    )
  })

  it("forks as of a Change (owners and editors), and refuses a viewer", async () => {
    const s = await setup()
    const first = await s.push(s.ada, "Added Attention", [
      concept("c-att", "Attention"),
    ])
    await s.push(s.ada, "Added MLA", [
      concept("c-mla", "MLA"),
      { kind: "expedition.set", target: s.id, path: "title", value: "Later" },
    ])
    const res = await s.call(s.ada, `/api/expeditions/${s.id}/fork`, {
      method: "POST",
      body: { asOf: first },
    })
    expect(res.status, await res.clone().text()).toBe(201)
    const fork = (await res.json()) as ForkResult
    const [change] = await s.db
      .select({ lastSeq: schema.changes.lastSeq })
      .from(schema.changes)
      .where(eq(schema.changes.id, first))
    expect(fork.forkedFrom).toEqual({ exp: s.id, seq: change!.lastSeq })
    const state = (await loadState(s.db, fork.expedition.id))!
    expect(state.expedition.title).toBe("Compute")
    expect(
      Object.values(state.concepts)
        .filter(isLive)
        .map((c) => c.title)
    ).toEqual(["Attention"])

    // An unknown Change is a 400.
    const bad = await s.call(s.ada, `/api/expeditions/${s.id}/fork`, {
      method: "POST",
      body: { asOf: "ch-nope" },
    })
    expect(bad.status).toBe(400)

    // Viewers and readers of a link see the latest state only.
    await s.db.insert(schema.collaborators).values({
      expeditionId: s.id,
      userId: s.bob.id,
      role: "viewer",
    })
    const viewer = await s.call(s.bob, `/api/expeditions/${s.id}/fork`, {
      method: "POST",
      body: { asOf: first },
    })
    expect(viewer.status).toBe(403)
  })
})

describe("Trash", () => {
  it("hides an Expedition from everyone, kicks them, and the owner restores it", async () => {
    const s = await setup()
    await s.db.insert(schema.collaborators).values({
      expeditionId: s.id,
      userId: s.bob.id,
      role: "editor",
    })
    const del = await s.call(s.ada, `/api/expeditions/${s.id}`, {
      method: "DELETE",
    })
    expect(del.status).toBe(200)
    const { purgeAfter } = (await del.json()) as { purgeAfter: string }
    const days = (Date.parse(purgeAfter) - Date.now()) / DAY
    expect(days).toBeGreaterThan(TRASH_DAYS - 0.01)
    expect(days).toBeLessThanOrEqual(TRASH_DAYS)
    expect(s.kicks.map((k) => k.userId).sort()).toEqual(
      [s.ada.id, s.bob.id, null].sort()
    )

    // Gone from both Libraries and unreadable; only Ada's Trash lists it.
    const library = async (u: TestUser) =>
      (
        (await (await s.call(u, "/api/expeditions")).json()) as {
          expeditions: { id: string }[]
        }
      ).expeditions
    const trash = async (u: TestUser) =>
      (
        (await (await s.call(u, "/api/expeditions/trash")).json()) as {
          expeditions: TrashedCard[]
        }
      ).expeditions
    expect(await library(s.ada)).toEqual([])
    expect(await library(s.bob)).toEqual([])
    expect((await s.call(s.bob, `/api/pull?expedition=${s.id}`)).status).toBe(
      404
    )
    const [card] = await trash(s.ada)
    expect(card).toMatchObject({ id: s.id, title: "Compute", purgeAfter })
    expect(await trash(s.bob)).toEqual([])

    // Bob (an editor) can't restore it; Ada can.
    const restore = (u: TestUser) =>
      s.call(u, `/api/expeditions/${s.id}/restore`, { method: "POST" })
    expect((await restore(s.bob)).status).toBe(404)
    const back = await restore(s.ada)
    expect(back.status).toBe(200)
    expect(await back.json()).toMatchObject({ id: s.id, role: "owner" })
    expect((await library(s.bob)).map((e) => e.id)).toEqual([s.id])
    expect(await trash(s.ada)).toEqual([])
    expect((await restore(s.ada)).status).toBe(409)
  })

  it("purges everything after 30 days, Source files included; Forks are unaffected", async () => {
    const s = await setup()
    await s.push(s.ada, "Added Attention", [concept("c-att", "Attention")])
    const added = await s.call(s.ada, `/api/sources/${s.id}`, {
      method: "POST",
      body: { type: "paste", text: "User: what is attention?" },
    })
    expect(added.status).toBe(201)
    const forked = (await (
      await s.call(s.ada, `/api/expeditions/${s.id}/fork`, {
        method: "POST",
        body: {},
      })
    ).json()) as ForkResult
    const fork = forked.expedition.id
    const keysOf = (exp: string) =>
      s.blobs.keys().filter((k) => k.startsWith(`sources/${exp}/`))
    expect(keysOf(s.id)).toHaveLength(2)
    expect(keysOf(fork)).toHaveLength(2)

    const deletedAt = Date.now() - (TRASH_DAYS + 1) * DAY
    await trashExpedition(s.db, {
      expeditionId: s.id,
      userId: s.ada.id,
      now: () => deletedAt,
    })
    // Another one in Trash, not due yet.
    const other = (await (
      await s.call(s.ada, "/api/expeditions", {
        method: "POST",
        body: { title: "Recent" },
      })
    ).json()) as { id: string }
    await trashExpedition(s.db, { expeditionId: other.id, userId: s.ada.id })

    expect(await purgeTrash(s.db, s.blobs)).toEqual([s.id])
    expect(keysOf(s.id)).toEqual([])
    const rowsOf = async (exp: string) =>
      (
        await Promise.all(
          [
            schema.expeditions,
            schema.collaborators,
            schema.concepts,
            schema.sources,
            schema.changes,
            schema.ops,
          ].map((t) =>
            s.db
              .select()
              .from(t)
              .where(
                eq(
                  "expeditionId" in t ? t.expeditionId : schema.expeditions.id,
                  exp
                )
              )
          )
        )
      ).flat().length
    expect(await rowsOf(s.id)).toBe(0)
    const trashRows = await s.db.select().from(schema.trash)
    expect(trashRows.map((t) => t.expeditionId)).toEqual([other.id])
    // The Fork and the recent one are untouched.
    expect(await rowsOf(fork)).toBeGreaterThan(0)
    expect(await rowsOf(other.id)).toBeGreaterThan(0)
    expect(keysOf(fork)).toHaveLength(2)
    // Nothing more is due.
    expect(await purgeTrash(s.db, s.blobs)).toEqual([])
  })

  it("never purges an Expedition restored before its time", async () => {
    const s = await setup()
    await trashExpedition(s.db, {
      expeditionId: s.id,
      userId: s.ada.id,
      now: () => Date.now() - (TRASH_DAYS + 1) * DAY,
    })
    const back = await s.call(s.ada, `/api/expeditions/${s.id}/restore`, {
      method: "POST",
    })
    expect(back.status).toBe(200)
    expect(await purgeTrash(s.db, s.blobs)).toEqual([])
    expect((await s.call(s.ada, `/api/pull?expedition=${s.id}`)).status).toBe(
      200
    )
  })
})
