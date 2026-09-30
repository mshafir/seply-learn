// Global search over PGlite, with the committed migrations (0001: the
// search columns, their triggers, GIN and pg_trgm indexes). PGlite runs
// plpgsql triggers and loads pg_trgm as a contrib extension, so the same SQL
// runs here and on CI's Postgres (the e2e job migrates and searches it too).
import { schema } from "@seply/domain"
import { eq, sql } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"
import type { Db } from "./db.ts"
import { importExpedition } from "./import.ts"
import {
  buildSearchQueries,
  parseQuery,
  search,
  type SearchResults,
} from "./search.ts"
import { signUp, TEST_ENV, testApp, testDb } from "./test-harness.ts"

const compute = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../domain/fixtures/compute.json", import.meta.url)
    ),
    "utf8"
  )
) as { title: string; concepts: { title: string }[] }

/** A small synthetic Expedition in our JSON. */
function synthetic(title: string, concepts: object[], tags: string[] = []) {
  return {
    schemaVersion: 1,
    id: "synthetic",
    title,
    summary: `${title}, a synthetic Expedition for search tests.`,
    tags,
    concepts: concepts.map((c, i) => ({
      id: `c${i}`,
      kind: "builtin:idea",
      ...c,
    })),
    relationships: [],
    views: [],
  }
}

async function addUser(db: Db, name: string) {
  const id = `user-${name}`
  await db.insert(schema.users).values({
    id,
    name,
    email: `${name}@example.com`,
  })
  return id
}

const setVisibility = (
  db: Db,
  id: string,
  visibility: "private" | "unlisted" | "public"
) =>
  db
    .update(schema.expeditions)
    .set({ visibility })
    .where(eq(schema.expeditions.id, id))

const ids = (r: SearchResults) => ({
  expeditions: r.expeditions.map((e) => e.id),
  conceptExpeditions: [...new Set(r.concepts.map((c) => c.expeditionId))],
})

describe("parseQuery", () => {
  it("splits free text from #tags", () => {
    expect(parseQuery("  mixture of  experts ")).toEqual({
      text: "mixture of experts",
      tags: [],
      tagPrefix: "mixture of experts",
    })
    expect(parseQuery("#Technique attention #GPU, #technique")).toEqual({
      text: "attention",
      tags: ["technique", "gpu"],
      tagPrefix: "attention",
    })
  })

  it("suggests tags from the last #tag when there is no text", () => {
    expect(parseQuery("#model #tech")).toMatchObject({
      text: "",
      tags: ["model", "tech"],
      tagPrefix: "tech",
    })
    expect(parseQuery("#")).toEqual({ text: "", tags: [], tagPrefix: "" })
    expect(parseQuery("")).toEqual({ text: "", tags: [], tagPrefix: "" })
  })
})

describe("buildSearchQueries", () => {
  const dialect = new PgDialect()

  it("returns nothing to run for an empty query", () => {
    expect(buildSearchQueries({ userId: "u", q: "  " })).toBeNull()
    expect(buildSearchQueries({ userId: "u", q: "#" })).toBeNull()
  })

  it("binds the user, text and tags as parameters, never inline", () => {
    const q = buildSearchQueries({
      userId: "u1'; drop table users; --",
      q: "o'brien #it's",
    })!
    const { sql: text, params } = dialect.sqlToQuery(q.concepts)
    expect(text).not.toContain("drop table")
    expect(text).not.toContain("o'brien")
    expect(params).toContain("u1'; drop table users; --")
    expect(params).toContain("o'brien")
    expect(params).toContain("it's")
    expect(text).toContain("websearch_to_tsquery('english'")
    expect(text).toContain("<%")
  })

  it("scopes to collaborators, with public only when asked", () => {
    const mine = dialect.sqlToQuery(
      buildSearchQueries({ userId: "u", q: "x" })!.expeditions
    )
    expect(mine.sql).toContain("e.deleted_at IS NULL")
    expect(mine.sql).toContain("e.visibility = 'public'")
    expect(mine.params).toContain(false)
    const all = dialect.sqlToQuery(
      buildSearchQueries({ userId: "u", q: "x", includePublic: true })!
        .expeditions
    )
    expect(all.params).toContain(true)
  })

  it("escapes LIKE wildcards in the tag prefix", () => {
    const q = buildSearchQueries({ userId: "u", q: "#50%_off" })!
    expect(dialect.sqlToQuery(q.tags!).params).toContain("50\\%\\_off%")
  })
})

describe("search over PGlite", () => {
  let db: Db
  let ada: string // owns the compute sample (private) and "Sourdough" (public)
  let bob: string // a stranger: owns nothing of Ada's
  let cy: string // Ada's viewer on the compute sample
  let computeId: string
  let breadId: string
  let unlistedId: string

  beforeAll(async () => {
    db = await testDb()
    ada = await addUser(db, "ada")
    bob = await addUser(db, "bob")
    cy = await addUser(db, "cy")
    computeId = (await importExpedition(db, { userId: ada, file: compute }))
      .expedition.id
    breadId = (
      await importExpedition(db, {
        userId: ada,
        file: synthetic(
          "Sourdough baking",
          [
            {
              title: "Levain",
              aliases: ["Starter"],
              summary: "A live culture of flour and water.",
              tags: ["fermentation"],
            },
            {
              title: "Autolyse",
              summary: "Resting flour and water before the salt.",
              tags: ["technique"],
              sections: [
                {
                  id: "s1",
                  heading: "Why it works",
                  md: "Enzymes break starch into sugars; gluten bonds form unaided.",
                },
              ],
            },
          ],
          ["baking"]
        ),
      })
    ).expedition.id
    await setVisibility(db, breadId, "public")
    unlistedId = (
      await importExpedition(db, {
        userId: ada,
        file: synthetic("Unlisted notes on levain", [
          { title: "Levain hydration", tags: ["fermentation"] },
        ]),
      })
    ).expedition.id
    await setVisibility(db, unlistedId, "unlisted")
    await db
      .insert(schema.collaborators)
      .values({ expeditionId: computeId, userId: cy, role: "viewer" })
  })

  it("maintains the search columns by trigger", async () => {
    const [row] = (
      (await db.execute(
        sql`SELECT search_title, search::text AS v FROM concepts
            WHERE expedition_id = ${breadId} AND title = 'Levain'`
      )) as unknown as { rows: { search_title: string; v: string }[] }
    ).rows
    expect(row!.search_title).toBe("Levain Starter")
    expect(row!.v).toContain("'levain':1A")
    expect(row!.v).toContain("'cultur")
  })

  it("finds Concepts by title, summary, overview and article text", async () => {
    const t = computeTitle("Grouped-Query Attention (GQA)")
    const byTitle = await search(db, { userId: ada, q: "grouped query" })
    expect(byTitle.concepts[0]?.title).toBe(t)
    expect(byTitle.concepts[0]?.expeditionTitle).toBe(compute.title)

    // Only in the article section (weight D).
    const byArticle = await search(db, { userId: ada, q: "enzymes gluten" })
    expect(byArticle.concepts.map((c) => c.title)).toEqual(["Autolyse"])

    // An alias.
    const byAlias = await search(db, { userId: ada, q: "starter" })
    expect(byAlias.concepts.map((c) => c.title)).toContain("Levain")
  })

  it("ranks a title match above a body match", async () => {
    const r = await search(db, { userId: ada, q: "levain" })
    expect(r.concepts[0]?.title).toMatch(/^Levain/)
  })

  it("matches titles fuzzily with pg_trgm", async () => {
    const r = await search(db, { userId: ada, q: "Autolise" })
    expect(r.concepts.map((c) => c.title)).toContain("Autolyse")
  })

  it("finds Expeditions by title and summary", async () => {
    const r = await search(db, { userId: ada, q: "sourdough" })
    expect(r.expeditions.map((e) => e.id)).toEqual([breadId])
    expect(r.expeditions[0]).toMatchObject({
      visibility: "public",
      role: "owner",
    })
  })

  it("re-indexes a Concept when its article changes", async () => {
    await db.execute(
      sql`UPDATE article_sections SET md = 'Now about pterodactyls.'
          WHERE expedition_id = ${breadId} AND concept_id =
            (SELECT id FROM concepts WHERE title = 'Autolyse')`
    )
    expect(
      (await search(db, { userId: ada, q: "pterodactyls" })).concepts
    ).toHaveLength(1)
    expect(
      (await search(db, { userId: ada, q: "enzymes" })).concepts
    ).toHaveLength(0)
    await db.execute(
      sql`UPDATE article_sections SET deleted_at = now()
          WHERE expedition_id = ${breadId} AND concept_id =
            (SELECT id FROM concepts WHERE title = 'Autolyse')`
    )
    expect(
      (await search(db, { userId: ada, q: "pterodactyls" })).concepts
    ).toHaveLength(0)
  })

  it("filters by #tag, and suggests tags by prefix", async () => {
    const r = await search(db, { userId: ada, q: "#fermentation" })
    expect(r.concepts.map((c) => c.title).sort()).toEqual([
      "Levain",
      "Levain hydration",
    ])
    expect(r.tags).toEqual([{ tag: "fermentation", count: 2 }])

    const both = await search(db, { userId: ada, q: "#technique autolyse" })
    expect(both.concepts.map((c) => c.title)).toEqual(["Autolyse"])

    const partial = await search(db, { userId: ada, q: "#tech" })
    expect(partial.concepts).toEqual([])
    expect(partial.tags[0]?.tag).toBe("technique")
    expect(partial.tags[0]!.count).toBeGreaterThan(40)

    const exp = await search(db, { userId: ada, q: "#baking" })
    expect(exp.expeditions.map((e) => e.id)).toEqual([breadId])
  })

  it("never shows a private Expedition to a stranger", async () => {
    for (const includePublic of [false, true]) {
      for (const q of ["attention", "grouped query", compute.title, "#technique"]) {
        const r = ids(await search(db, { userId: bob, q, includePublic }))
        expect(r.expeditions).not.toContain(computeId)
        expect(r.conceptExpeditions).not.toContain(computeId)
      }
      const tags = await search(db, { userId: bob, q: "#open", includePublic })
      expect(tags.tags.map((t) => t.tag)).not.toContain("open-model")
    }
  })

  it("shows public Expeditions to strangers only with the toggle", async () => {
    const off = ids(await search(db, { userId: bob, q: "levain" }))
    expect(off).toEqual({ expeditions: [], conceptExpeditions: [] })
    const on = await search(db, {
      userId: bob,
      q: "levain",
      includePublic: true,
    })
    expect(ids(on).conceptExpeditions).toEqual([breadId])
    expect(
      (await search(db, { userId: bob, q: "sourdough", includePublic: true }))
        .expeditions
    ).toEqual([expect.objectContaining({ id: breadId, role: null })])
  })

  it("never shows an unlisted Expedition in global search to a stranger", async () => {
    const r = ids(
      await search(db, { userId: bob, q: "levain", includePublic: true })
    )
    expect(r.expeditions).not.toContain(unlistedId)
    expect(r.conceptExpeditions).not.toContain(unlistedId)
    // Its owner still finds it.
    const mine = ids(await search(db, { userId: ada, q: "levain hydration" }))
    expect(mine.conceptExpeditions).toContain(unlistedId)
  })

  it("searches Expeditions shared with me, in any role", async () => {
    const r = await search(db, { userId: cy, q: "grouped query" })
    expect(ids(r).conceptExpeditions).toEqual([computeId])
  })

  it("leaves out Trash and deleted Concepts", async () => {
    await db.execute(
      sql`UPDATE concepts SET deleted_at = now()
          WHERE expedition_id = ${breadId} AND title = 'Levain'`
    )
    expect(
      (await search(db, { userId: ada, q: "starter" })).concepts.map(
        (c) => c.title
      )
    ).not.toContain("Levain")
    await db
      .update(schema.expeditions)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(schema.expeditions.id, breadId))
    const r = ids(await search(db, { userId: ada, q: "autolyse" }))
    expect(r.conceptExpeditions).not.toContain(breadId)
  })
})

describe("GET /api/search", () => {
  it("needs a session, validates, and answers in groups", async () => {
    const db = await testDb()
    const app = testApp(TEST_ENV, db)
    expect((await app.request("/api/search?q=x")).status).toBe(401)
    const ada = await signUp(app, "ada")
    await importExpedition(db, { userId: ada.id, file: compute })
    const bad = await app.request("/api/search?q=x&public=maybe", {
      headers: ada.headers,
    })
    expect(bad.status).toBe(400)
    const res = await app.request(
      `/api/search?q=${encodeURIComponent("#technique")}&public=1`,
      { headers: ada.headers }
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as SearchResults
    expect(Object.keys(body).sort()).toEqual(["concepts", "expeditions", "tags"])
    expect(body.concepts.length).toBeGreaterThan(10)
    expect(body.tags[0]).toEqual({ tag: "technique", count: 50 })
  })
})

function computeTitle(title: string) {
  const c = compute.concepts.find((c) => c.title === title)
  if (!c) throw new Error(`no ${title} in the compute sample`)
  return c.title
}
