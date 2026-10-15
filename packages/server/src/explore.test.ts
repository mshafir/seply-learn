// Explore over PGlite: public Expeditions only, for anyone, paged by latest
// Change, with search and a Tag filter. Synthetic Expeditions only.
import { schema } from "@seply/domain"
import { eq, sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"
import type { Db } from "./db.ts"
import { explore, type ExplorePage } from "./explore.ts"
import { importExpedition } from "./import.ts"
import { signUp, TEST_ENV, testApp, testDb } from "./test-harness.ts"

function synthetic(title: string, tags: string[] = []) {
  return {
    schemaVersion: 1,
    id: "synthetic",
    title,
    summary: `${title}, a synthetic Expedition for Explore tests.`,
    tags,
    concepts: [
      { id: "c0", kind: "builtin:idea", title: `${title} basics` },
      { id: "c1", kind: "builtin:idea", title: `${title} in practice` },
    ],
    relationships: [],
    views: [],
  }
}

describe("explore", () => {
  let db: Db
  let app: ReturnType<typeof testApp>
  let owner: string
  const ids: Record<string, string> = {}

  /** Imports one, sets its Visibility and its latest Change's time. */
  async function add(
    key: string,
    visibility: "private" | "unlisted" | "public",
    minute: number,
    tags: string[] = []
  ) {
    const { expedition } = await importExpedition(db, {
      userId: owner,
      file: synthetic(key, tags),
    })
    ids[key] = expedition.id
    await db
      .update(schema.expeditions)
      .set({ visibility })
      .where(eq(schema.expeditions.id, expedition.id))
    await db.execute(
      sql`UPDATE changes SET at = ${new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString()}
          WHERE expedition_id = ${expedition.id}`
    )
  }

  const titles = (page: ExplorePage) => page.expeditions.map((e) => e.title)

  beforeAll(async () => {
    db = await testDb()
    app = testApp(TEST_ENV, db)
    owner = (await signUp(app, "ada")).id
    await add("Sourdough", "public", 1, ["baking", "Fermentation"])
    await add("Tide pools", "public", 3, ["oceans"])
    await add("Kimchi", "public", 2, ["fermentation"])
    await add("Secret recipes", "private", 4, ["baking"])
    await add("Unlisted notes", "unlisted", 5, ["baking"])
    await add("Old atlas", "public", 6, ["oceans"])
    await db
      .update(schema.expeditions)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(schema.expeditions.id, ids["Old atlas"]!))
  })

  it("lists public Expeditions only, latest Change first", async () => {
    const page = await explore(db, {})
    expect(titles(page)).toEqual(["Tide pools", "Kimchi", "Sourdough"])
    expect(page.nextCursor).toBeNull()
  })

  it("never lists private, unlisted or Trash", async () => {
    const page = await explore(db, { q: "#baking" })
    expect(titles(page)).toEqual(["Sourdough"])
    const all = titles(await explore(db, {}))
    expect(all).not.toContain("Secret recipes")
    expect(all).not.toContain("Unlisted notes")
    expect(all).not.toContain("Old atlas")
  })

  it("cards carry counts, Tags and a date, and no people", async () => {
    const page = await explore(db, { q: "sourdough" })
    expect(page.expeditions).toEqual([
      {
        id: ids.Sourdough,
        title: "Sourdough",
        summary: "Sourdough, a synthetic Expedition for Explore tests.",
        tags: ["Fermentation", "baking"],
        counts: { concepts: 2, views: 0 },
        bestViewType: null,
        updatedAt: "2026-01-01T00:01:00.000Z",
      },
    ])
  })

  it("searches titles and summaries, fuzzily too", async () => {
    expect(titles(await explore(db, { q: "tide" }))).toEqual(["Tide pools"])
    expect(titles(await explore(db, { q: "Kimchee" }))).toEqual(["Kimchi"])
    expect(titles(await explore(db, { q: "recipes" }))).toEqual([])
  })

  it("filters by Tag, ignoring case", async () => {
    expect(titles(await explore(db, { tag: "fermentation" }))).toEqual([
      "Kimchi",
      "Sourdough",
    ])
    expect(titles(await explore(db, { tag: "#Oceans" }))).toEqual([
      "Tide pools",
    ])
    expect(
      titles(await explore(db, { tag: "fermentation", q: "#baking" }))
    ).toEqual(["Sourdough"])
  })

  it("lists the Tags of public Expeditions only, most used first", async () => {
    const { tags } = await explore(db, {})
    expect(tags).toEqual([
      { tag: "fermentation", count: 2 },
      { tag: "baking", count: 1 },
      { tag: "oceans", count: 1 },
    ])
  })

  it("pages with a cursor, without repeats", async () => {
    const first = await explore(db, { limit: 2 })
    expect(titles(first)).toEqual(["Tide pools", "Kimchi"])
    expect(first.nextCursor).toMatch(/^\d+_/)
    const second = await explore(db, { limit: 2, cursor: first.nextCursor! })
    expect(titles(second)).toEqual(["Sourdough"])
    expect(second.nextCursor).toBeNull()
    expect(second.tags).toEqual([])
  })

  it("answers anonymous callers over HTTP, with no people", async () => {
    const res = await app.request("/api/explore")
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain("ada")
    expect(text).not.toContain("collaborators")
    const body = JSON.parse(text) as ExplorePage
    expect(titles(body)).toEqual(["Tide pools", "Kimchi", "Sourdough"])
  })

  it("answers signed-in callers the same", async () => {
    const bob = await signUp(app, "bob")
    const res = await app.request("/api/explore?q=%23oceans", {
      headers: bob.headers,
    })
    expect(titles((await res.json()) as ExplorePage)).toEqual(["Tide pools"])
  })

  it("rejects a malformed cursor", async () => {
    const res = await app.request("/api/explore?cursor=nope")
    expect(res.status).toBe(400)
  })
})
