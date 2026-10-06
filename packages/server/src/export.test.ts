// GET /export over PGlite and a memory blob store: our JSON (with and without
// Source files) round-trips through POST /import with the same counts, and the
// Markdown folder's links all resolve.
import {
  brokenMarkdownLinks,
  isLive,
  schema,
  type DomainState,
} from "@seply/domain"
import { eq } from "drizzle-orm"
import { strFromU8, unzipSync } from "fflate"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { memoryBlobStore } from "./blobs.ts"
import type { Db } from "./db.ts"
import type { ImportResponse } from "./import.ts"
import { loadState } from "./projection.ts"
import { signUp, TEST_ENV, testApp, testDb } from "./test-harness.ts"

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)))
const COMPUTE = read("../../domain/fixtures/compute.json")

async function setup() {
  const db = await testDb()
  const blobs = memoryBlobStore()
  const app = testApp(TEST_ENV, db, undefined, { blobs })
  const ada = await signUp(app, "ada")
  const importBody = async (body: BodyInit) => {
    const res = await app.request("/api/import", {
      method: "POST",
      headers: ada.headers,
      body,
    })
    expect(res.status).toBe(201)
    return (await res.json()) as ImportResponse
  }
  const { expedition } = await importBody(new Uint8Array(COMPUTE))
  const id = expedition.id
  const exportOf = (
    query: string,
    headers: Record<string, string> = ada.headers
  ) => app.request(`/api/export/${id}?${query}`, { headers })
  return { db, blobs, app, ada, id, importBody, exportOf }
}

/** What a round trip must keep: every count in the state. */
function counts(state: DomainState) {
  const live = (r: Record<string, { deletedAt: string | null }>) =>
    Object.values(r).filter(isLive).length
  return {
    concepts: live(state.concepts),
    relationships: live(state.relationships),
    views: live(state.views),
    sections: live(state.sections),
    sources: Object.keys(state.sources).length,
    kinds: Object.keys(state.kinds).length,
    relTypes: Object.keys(state.relTypes).length,
    attributes: live(state.attributes),
    tags: state.expedition.tags.length,
    conceptTags: Object.values(state.concepts).reduce(
      (n, c) => n + c.tags.length,
      0
    ),
  }
}
const countsOf = async (db: Db, id: string) =>
  counts((await loadState(db, id))!)

describe("GET /export/:expeditionId", () => {
  it("exports our JSON, and importing it keeps every count", async () => {
    const { db, id, importBody, exportOf } = await setup()
    const res = await exportOf("format=json")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/json")
    expect(res.headers.get("content-disposition")).toContain(
      `filename*=UTF-8''${encodeURIComponent("AI compute & model internals.json")}`
    )
    const doc = (await res.json()) as { schemaVersion: number; id: string }
    expect(doc).toMatchObject({ schemaVersion: 1, id })

    const out = await importBody(JSON.stringify(doc))
    expect(out.counts).toEqual({
      concepts: 201,
      relationships: 425,
      views: 12,
      sources: 1,
      sourceFiles: 0,
    })
    expect(await countsOf(db, out.expedition.id)).toEqual(
      await countsOf(db, id)
    )
  })

  it("adds the Source files on request, as a zip that imports with them", async () => {
    const { db, blobs, app, ada, id, importBody, exportOf } = await setup()
    // Two more Sources with files (the fixture's own has none): a pasted
    // chat and an uploaded file.
    const paste = await app.request(`/api/sources/${id}`, {
      method: "POST",
      headers: ada.headers,
      body: JSON.stringify({
        type: "paste",
        title: "A pasted chat",
        text: read("../fixtures/sources/pasted-chat.txt").toString("utf8"),
      }),
    })
    expect(paste.status).toBe(201)
    const notes = read("../fixtures/sources/notes.md")
    const form = new FormData()
    form.set("file", new File([new Uint8Array(notes)], "notes.md"))
    const { "content-type": _drop, ...formHeaders } = ada.headers
    void _drop
    const upload = await app.request(`/api/sources/${id}`, {
      method: "POST",
      headers: formHeaders,
      body: form,
    })
    expect(upload.status).toBe(201)
    const uploaded = (await upload.json()) as { source: { title: string } }

    // Without the box ticked: our JSON alone.
    const plain = await exportOf("format=json")
    expect(plain.headers.get("content-type")).toBe("application/json")
    expect(
      ((await plain.json()) as { sources: unknown[] }).sources
    ).toHaveLength(3)

    const res = await exportOf("format=json&sources=1")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/zip")
    expect(res.headers.get("x-source-files")).toBe("2")
    const bytes = new Uint8Array(await res.arrayBuffer())
    const files = unzipSync(bytes)
    const paths = Object.keys(files).sort()
    expect(paths).toContain("expedition.json")
    expect(paths.filter((p) => p.endsWith("/segments.json"))).toHaveLength(2)
    expect(
      paths.find(
        (p) =>
          p.endsWith(`/${uploaded.source.title}`) || p.endsWith("/notes.md")
      )
    ).toBeDefined()

    const before = blobs.keys().length
    const out = await importBody(bytes)
    expect(out.counts).toMatchObject({ sources: 3, sourceFiles: 2 })
    expect(await countsOf(db, out.expedition.id)).toEqual(
      await countsOf(db, id)
    )
    // Both Sources' files are stored under the new Expedition, and read back.
    expect(blobs.keys().length).toBe(before + 4)
    const imported = (await loadState(db, out.expedition.id))!
    const withFiles = Object.values(imported.sources).filter((s) => s.blobKey)
    expect(withFiles).toHaveLength(2)
    for (const s of withFiles) {
      expect(s.blobKey).toMatch(`sources/${out.expedition.id}/${s.id}/`)
      const file = await app.request(
        `/api/sources/${out.expedition.id}/${s.id}/file`,
        { headers: ada.headers }
      )
      expect(file.status).toBe(200)
      const seg = await app.request(
        `/api/sources/${out.expedition.id}/${s.id}`,
        {
          headers: ada.headers,
        }
      )
      expect(seg.status).toBe(200)
      if (s.title === uploaded.source.title)
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(
          new Uint8Array(notes)
        )
    }
  })

  it("exports a Markdown folder whose links all resolve", async () => {
    const { id, exportOf } = await setup()
    const res = await exportOf("format=markdown")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/zip")
    expect(res.headers.get("content-disposition")).toContain(
      encodeURIComponent("AI compute & model internals (Markdown).zip")
    )
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
    const paths = Object.keys(files)
    // One folder, named for the Expedition, opened as an Obsidian vault.
    const folders = new Set(paths.map((p) => p.split("/")[0]))
    expect([...folders]).toEqual(["AI compute & model internals"])
    // One note per Concept and View, and the Expedition's own.
    expect(paths.filter((p) => p.endsWith(".md"))).toHaveLength(201 + 12 + 1)
    const notes = paths.map((path) => ({ path, text: strFromU8(files[path]!) }))
    expect(brokenMarkdownLinks(notes, paths)).toEqual([])
    const wikilinks = notes.flatMap(
      (n) => n.text.match(/\[\[[^\]]+\]\]/g) ?? []
    )
    expect(wikilinks.length).toBeGreaterThanOrEqual(2 * 425)
    void id
  })

  it("lets anyone who can view export, and nobody else", async () => {
    const { db, app, id, exportOf } = await setup()
    const bob = await signUp(app, "bob")
    // Private: the owner can, a stranger and the signed-out can't.
    expect((await exportOf("format=json", bob.headers)).status).toBe(404)
    expect((await exportOf("format=markdown", {})).status).toBe(404)
    // Unlisted: anyone with the link, signed in or not.
    await db
      .update(schema.expeditions)
      .set({ visibility: "unlisted" })
      .where(eq(schema.expeditions.id, id))
    expect((await exportOf("format=json", bob.headers)).status).toBe(200)
    expect((await exportOf("format=markdown", {})).status).toBe(200)
    // Not an Expedition, or a bad format.
    expect((await app.request("/api/export/nope?format=json")).status).toBe(404)
    expect((await exportOf("format=pdf")).status).toBe(400)
  })
})

describe("POST /import (zip)", () => {
  it("refuses a zip without expedition.json, and a broken zip", async () => {
    const { app, ada } = await setup()
    const { zipSync, strToU8 } = await import("fflate")
    for (const body of [
      zipSync({ "readme.txt": strToU8("hi") }),
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]),
    ]) {
      const res = await app.request("/api/import", {
        method: "POST",
        headers: ada.headers,
        body,
      })
      expect(res.status).toBe(400)
    }
  })
})
