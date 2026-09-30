// POST /import over PGlite: our JSON as a new private Expedition, one
// "Imported from file" Change on the op log.
import {
  applyAll,
  emptyState,
  isLive,
  schema,
  type LoggedOp,
} from "@seply/domain"
import { eq } from "drizzle-orm"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { Db } from "./db.ts"
import type { LibraryCard } from "./expeditions.ts"
import type { ImportResponse } from "./import.ts"
import { loadState } from "./projection.ts"
import type { Relay } from "./relay.ts"
import { signUp, TEST_ENV, testApp, testDb } from "./test-harness.ts"

type Doc = {
  id: string
  concepts: { id: string }[]
  relationships: unknown[]
  views: { id: string }[]
}
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../../domain/fixtures/${name}.json`, import.meta.url)
      ),
      "utf8"
    )
  ) as Doc

async function setup(relay?: Relay) {
  const db = await testDb()
  const app = testApp(TEST_ENV, db, relay)
  const ada = await signUp(app, "ada")
  const importFile = (body: string, headers = ada.headers) =>
    app.request("/api/import", { method: "POST", headers, body })
  return { db, app, ada, importFile }
}

const rows = async (db: Db, id: string) => ({
  changes: await db
    .select()
    .from(schema.changes)
    .where(eq(schema.changes.expeditionId, id)),
  ops: await db
    .select()
    .from(schema.ops)
    .where(eq(schema.ops.expeditionId, id)),
  collaborators: await db
    .select()
    .from(schema.collaborators)
    .where(eq(schema.collaborators.expeditionId, id)),
  expedition: (
    await db
      .select()
      .from(schema.expeditions)
      .where(eq(schema.expeditions.id, id))
  )[0]!,
})

describe("POST /import", () => {
  for (const name of ["compute", "research-doc"]) {
    it(`imports the ${name} fixture with its Concept, Relationship and View counts`, async () => {
      const published: LoggedOp[][] = []
      const { db, ada, importFile } = await setup({
        published: (_, batch) => void published.push([...batch]),
      })
      const doc = fixture(name)
      const res = await importFile(JSON.stringify(doc))
      expect(res.status).toBe(201)
      const out = (await res.json()) as ImportResponse
      const expected = {
        concepts: doc.concepts.length,
        relationships: doc.relationships.length,
        views: doc.views.length,
      }
      expect(out.counts).toEqual(expected)
      expect(out.expedition).toMatchObject({
        visibility: "private",
        status: "ready",
        role: "owner",
      })
      const id = out.expedition.id

      // The tables hold the same counts.
      const state = (await loadState(db, id))!
      const live = <T extends { deletedAt: string | null }>(
        r: Record<string, T>
      ) => Object.values(r).filter(isLive).length
      expect({
        concepts: live(state.concepts),
        relationships: live(state.relationships),
        views: live(state.views),
      }).toEqual(expected)

      // One "Imported from file" Change by the importer, the owner, on the log.
      const r = await rows(db, id)
      expect(r.changes).toEqual([
        expect.objectContaining({
          author: ada.id,
          origin: "import",
          label: "Imported from file",
          firstSeq: 1,
          lastSeq: r.ops.length,
        }),
      ])
      expect(r.expedition).toMatchObject({
        ownerId: ada.id,
        visibility: "private",
        headSeq: r.ops.length,
      })
      expect(r.collaborators).toEqual([
        expect.objectContaining({ userId: ada.id, role: "owner" }),
      ])
      expect(published.flat()).toHaveLength(r.ops.length)

      // Replaying the log gives the tables.
      const log = published.flat()
      expect(applyAll(emptyState(id), log)).toEqual(state)

      // Fresh ids: none of the file's ids made it in.
      expect(id).not.toBe(doc.id)
      expect(state.concepts[doc.concepts[0]!.id]).toBeUndefined()
      expect(state.views[doc.views[0]!.id]).toBeUndefined()
    })
  }

  it("mints new ids for each import of the same file", async () => {
    const { db, importFile } = await setup()
    const body = JSON.stringify(fixture("research-doc"))
    const a = (await (await importFile(body)).json()) as ImportResponse
    const b = (await (await importFile(body)).json()) as ImportResponse
    expect(a.expedition.id).not.toBe(b.expedition.id)
    const idsOf = async (id: string) =>
      new Set(
        (
          await db
            .select({ id: schema.concepts.id })
            .from(schema.concepts)
            .where(eq(schema.concepts.expeditionId, id))
        ).map((r) => r.id)
      )
    const [ia, ib] = [
      await idsOf(a.expedition.id),
      await idsOf(b.expedition.id),
    ]
    expect(ia.size).toBe(b.counts.concepts)
    for (const id of ib) expect(ia.has(id)).toBe(false)
  })

  it("lists the import among my Expeditions", async () => {
    const { app, ada, importFile } = await setup()
    const out = (await (
      await importFile(JSON.stringify(fixture("research-doc")))
    ).json()) as ImportResponse
    const list = (await (
      await app.request("/api/expeditions", { headers: ada.headers })
    ).json()) as { expeditions: { id: string; title: string }[] }
    expect(list.expeditions).toEqual([
      expect.objectContaining({
        id: out.expedition.id,
        title: "Open-source tools for learning graphs (generated)",
      }),
    ])
  })

  it("rejects invalid files and writes nothing", async () => {
    const { db, importFile } = await setup()
    const doc = fixture("research-doc")
    const cases: [string, RegExp][] = [
      ["not json", /not JSON/],
      [JSON.stringify([1, 2]), /expected a JSON object/],
      [JSON.stringify({ ...doc, schemaVersion: 99 }), /newer/],
      [
        JSON.stringify({
          ...doc,
          relationships: [{ from: "ghost", type: "builtin:uses", to: "ghost" }],
        }),
        /unknown Concept ghost/,
      ],
    ]
    for (const [body, match] of cases) {
      const res = await importFile(body)
      expect(res.status).toBe(400)
      const err = (await res.json()) as {
        error: string
        message?: string
        issues?: { path: string; message: string }[]
      }
      expect(
        [
          err.error,
          err.message,
          ...(err.issues ?? []).map((i) => i.message),
        ].join("\n")
      ).toMatch(match)
    }
    expect(await db.select().from(schema.expeditions)).toEqual([])
    expect(await db.select().from(schema.ops)).toEqual([])
  })

  it("requires sign-in", async () => {
    const { importFile } = await setup()
    const res = await importFile(JSON.stringify(fixture("research-doc")), {
      "content-type": "application/json",
    } as Record<string, string>)
    expect(res.status).toBe(401)
  })
})

describe("GET /expeditions (Library cards)", () => {
  it("lists the imported fixture with its counts, best View Type, Collaborators and date", async () => {
    const { app, ada, importFile } = await setup()
    const before = Date.now()
    expect((await importFile(JSON.stringify(fixture("compute")))).status).toBe(
      201
    )
    const empty = await app.request("/api/expeditions", {
      method: "POST",
      headers: { ...ada.headers, "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(empty.status).toBe(201)

    const res = await app.request("/api/expeditions", { headers: ada.headers })
    const { expeditions } = (await res.json()) as {
      expeditions: LibraryCard[]
    }
    const [blank, compute] = expeditions
    expect(compute).toMatchObject({
      title: "AI compute & model internals",
      status: "ready",
      role: "owner",
      tags: [],
      counts: { concepts: 201, views: 12 },
      bestViewType: "outline",
      collaborators: [{ name: "ada", role: "owner", image: null }],
    })
    expect(Date.parse(compute!.updatedAt)).toBeGreaterThanOrEqual(before - 1000)
    expect(compute!.collaborators[0]).not.toHaveProperty("email")
    expect(blank).toMatchObject({
      status: "draft",
      counts: { concepts: 0, views: 0 },
      bestViewType: null,
    })
    expect(Number.isNaN(Date.parse(blank!.updatedAt))).toBe(false)
  })
})
