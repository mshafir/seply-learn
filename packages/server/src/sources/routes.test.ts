// The Source routes over PGlite and a memory blob store: upload, paste and
// prompt Sources, the op log entry, the blobs, reading segments back, and who
// may do what.
import { schema, type LoggedOp, type SegmentsDoc } from "@seply/domain"
import { eq } from "drizzle-orm"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { memoryBlobStore, sourceBlobKeys } from "../blobs.ts"
import { loadState } from "../projection.ts"
import type { Relay } from "../relay.ts"
import {
  signUp,
  TEST_ENV,
  testApp,
  testDb,
  type TestUser,
} from "../test-harness.ts"

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/sources/${name}`, import.meta.url))

type Added = {
  source: {
    id: string
    kind: string
    title: string
    blobKey: string
    segmentsKey: string
    size: number
  }
  segments: { kind: string; format: string; count: number; chars: number }
}

async function setup(relay?: Relay) {
  const db = await testDb()
  const blobs = memoryBlobStore()
  const app = testApp(TEST_ENV, db, relay, blobs)
  const ada = await signUp(app, "ada")
  const res = await app.request("/api/expeditions", {
    method: "POST",
    headers: ada.headers,
    body: JSON.stringify({ title: "Tides" }),
  })
  const { id } = (await res.json()) as { id: string }
  const upload = (name: string, user: TestUser = ada, bytes?: Uint8Array) => {
    const form = new FormData()
    form.set("file", new File([new Uint8Array(bytes ?? fixture(name))], name))
    const { "content-type": _drop, ...headers } = user.headers
    void _drop
    return app.request(`/api/sources/${id}`, {
      method: "POST",
      headers,
      body: form,
    })
  }
  const paste = (body: unknown, user: TestUser = ada) =>
    app.request(`/api/sources/${id}`, {
      method: "POST",
      headers: user.headers,
      body: JSON.stringify(body),
    })
  return { db, blobs, app, ada, id, upload, paste }
}

describe("POST /sources/:expeditionId", () => {
  it("uploads a file: blobs stored, source.add logged as its own Change", async () => {
    const published: LoggedOp[][] = []
    const { db, blobs, id, upload } = await setup({
      published: (_, batch) => void published.push([...batch]),
    })
    const res = await upload("claude-conversations.json")
    expect(res.status).toBe(201)
    const out = (await res.json()) as Added
    expect(out.segments).toEqual({
      kind: "chat",
      format: "claude-export",
      count: 4,
      chars: expect.any(Number),
    })
    const keys = sourceBlobKeys(id, out.source.id)
    expect(out.source).toMatchObject({
      kind: "chat",
      title: "Photosynthesis, briefly",
      blobKey: keys.raw,
      segmentsKey: keys.segments,
      size: fixture("claude-conversations.json").byteLength,
    })
    expect(blobs.keys().sort()).toEqual([keys.raw, keys.segments])
    expect((await blobs.get(keys.raw))!.body).toEqual(
      new Uint8Array(fixture("claude-conversations.json"))
    )

    const state = await loadState(db, id)
    expect(state!.sources[out.source.id]).toMatchObject({
      title: "Photosynthesis, briefly",
    })
    const changes = await db
      .select()
      .from(schema.changes)
      .where(eq(schema.changes.expeditionId, id))
    expect(changes.map((c) => c.label)).toContain(
      "Added the Source “Photosynthesis, briefly”"
    )
    expect(published.at(-1)!.map((o) => o.kind)).toEqual(["source.add"])
  })

  it("adds a pasted chat, pasted notes and a prompt", async () => {
    const { paste } = await setup()
    const chat = (await (
      await paste({
        type: "paste",
        text: fixture("pasted-chat.txt").toString("utf8"),
      })
    ).json()) as Added
    expect(chat.source.kind).toBe("chat")
    expect(chat.segments).toMatchObject({ format: "chat-paste", count: 6 })

    const notes = (await (
      await paste({ type: "paste", text: "# Neap tides\n\nSmaller ones." })
    ).json()) as Added
    expect(notes.source).toMatchObject({ kind: "file", title: "Neap tides" })

    const res = await paste({ type: "prompt", text: "Teach me tides" })
    expect(res.status).toBe(201)
    const prompt = (await res.json()) as Added
    expect(prompt.source).toMatchObject({
      kind: "prompt",
      title: "Teach me tides",
    })
    expect(prompt.segments).toMatchObject({ format: "prompt", count: 1 })
  })

  it("refuses unreadable files and bad bodies, storing nothing", async () => {
    const { blobs, upload, paste } = await setup()
    const bin = await upload(
      "x.bin",
      undefined,
      new Uint8Array([0xff, 0xfe, 0x81])
    )
    expect(bin.status).toBe(415)
    expect(((await bin.json()) as { message: string }).message).toMatch(
      /isn't supported/
    )
    expect((await paste({ type: "paste", text: "" })).status).toBe(400)
    expect((await paste({ type: "nope", text: "x" })).status).toBe(400)
    expect(blobs.keys()).toEqual([])
  })

  it("refuses files over 25 MB with 413", async () => {
    const { upload, blobs } = await setup()
    const res = await upload(
      "big.txt",
      undefined,
      new Uint8Array(25 * 1024 * 1024 + 1).fill(97)
    )
    expect(res.status).toBe(413)
    expect(blobs.keys()).toEqual([])
  })

  it("needs sign-in, and owner or editor", async () => {
    const { app, db, id, upload, paste, blobs } = await setup()
    const anon = await app.request(`/api/sources/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "prompt", text: "x" }),
    })
    expect(anon.status).toBe(401)

    const bo = await signUp(app, "bo")
    // A stranger can't see it at all.
    expect((await paste({ type: "prompt", text: "x" }, bo)).status).toBe(404)
    // A viewer can see it but may not add Sources.
    await db
      .insert(schema.collaborators)
      .values({ expeditionId: id, userId: bo.id, role: "viewer" })
    expect((await paste({ type: "prompt", text: "x" }, bo)).status).toBe(403)
    expect((await upload("notes.md", bo)).status).toBe(403)
    expect(blobs.keys()).toEqual([])
    // An editor may.
    await db
      .update(schema.collaborators)
      .set({ role: "editor" })
      .where(eq(schema.collaborators.userId, bo.id))
    expect((await paste({ type: "prompt", text: "x" }, bo)).status).toBe(201)
  })

  it("503 without a blob store", async () => {
    const db = await testDb()
    const app = testApp(TEST_ENV, db)
    const ada = await signUp(app, "ada")
    const res = await app.request("/api/sources/x", {
      method: "POST",
      headers: ada.headers,
      body: JSON.stringify({ type: "prompt", text: "x" }),
    })
    expect(res.status).toBe(503)
  })
})

describe("GET /sources/:expeditionId/:sourceId", () => {
  it("returns the Source and its segments; the file downloads", async () => {
    const { app, ada, id, upload } = await setup()
    const added = (await (await upload("sample.pdf")).json()) as Added
    const res = await app.request(`/api/sources/${id}/${added.source.id}`, {
      headers: ada.headers,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      source: Record<string, unknown>
      segments: SegmentsDoc
    }
    expect(body.source).toMatchObject({
      id: added.source.id,
      kind: "file",
      title: "Volcanoes: a field guide",
    })
    // Blob keys stay on the server.
    expect(body.source.blobKey).toBeUndefined()
    expect(body.segments.segments.map((s) => s.id)).toEqual(["p1", "p2", "p3"])

    const file = await app.request(
      `/api/sources/${id}/${added.source.id}/file`,
      {
        headers: ada.headers,
      }
    )
    expect(file.status).toBe(200)
    expect(file.headers.get("content-type")).toBe("application/pdf")
    expect(file.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''Volcanoes%20%20a%20field%20guide.pdf"
    )
    expect(file.headers.get("x-content-type-options")).toBe("nosniff")
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(
      new Uint8Array(fixture("sample.pdf"))
    )
  })

  it("follows Visibility: private needs a role, unlisted needs none", async () => {
    const { app, db, id, upload } = await setup()
    const added = (await (await upload("notes.md")).json()) as Added
    const path = `/api/sources/${id}/${added.source.id}`
    const bo = await signUp(app, "bo")
    expect((await app.request(path)).status).toBe(404)
    expect((await app.request(path, { headers: bo.headers })).status).toBe(404)
    expect(
      (await app.request(`${path}/file`, { headers: bo.headers })).status
    ).toBe(404)
    await db
      .update(schema.expeditions)
      .set({ visibility: "unlisted" })
      .where(eq(schema.expeditions.id, id))
    expect((await app.request(path)).status).toBe(200)
    expect((await app.request(`${path}/file`)).status).toBe(200)
  })

  it("404s a Source without stored text, and never reads another Expedition's blobs", async () => {
    const { app, ada, db, id, blobs, upload } = await setup()
    // Ada's other Expedition, with a Source.
    const other = (await (
      await app.request("/api/expeditions", {
        method: "POST",
        headers: ada.headers,
        body: JSON.stringify({ title: "Other" }),
      })
    ).json()) as { id: string }
    const theirs = (await (await upload("notes.md")).json()) as Added

    // A Source pushed by a client, naming the first Expedition's blobs.
    const push = await app.request("/api/push", {
      method: "POST",
      headers: ada.headers,
      body: JSON.stringify({
        expeditionId: other.id,
        ops: [
          {
            opId: "01K00000000000000000000001",
            expeditionId: other.id,
            actor: ada.id,
            changeId: "01K00000000000000000000002",
            clientSeq: 0,
            schemaV: 1,
            kind: "source.add",
            target: "stolen",
            value: {
              kind: "file",
              title: "Stolen",
              blobKey: theirs.source.blobKey,
              segmentsKey: theirs.source.segmentsKey,
              addedBy: ada.id,
              addedAt: new Date().toISOString(),
            },
          },
        ],
      }),
    })
    expect(push.status).toBe(200)
    const read = await app.request(`/api/sources/${other.id}/stolen`, {
      headers: ada.headers,
    })
    expect(read.status).toBe(404)
    expect(
      (
        await app.request(`/api/sources/${other.id}/stolen/file`, {
          headers: ada.headers,
        })
      ).status
    ).toBe(404)
    expect(
      (
        await app.request(`/api/sources/${id}/missing`, {
          headers: ada.headers,
        })
      ).status
    ).toBe(404)
    void db
    void blobs
  })
})
