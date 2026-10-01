import { schema } from "@seply/domain"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import type { Relay, RoomJoin } from "./relay.ts"
import { signUp, TEST_ENV, testApp, testDb } from "./test-harness.ts"

async function setup() {
  const db = await testDb()
  const joins: RoomJoin[] = []
  const relay: Relay = {
    published: () => {},
    handleUpgrade: (_req, join) => {
      joins.push(join)
      return new Response("upgraded")
    },
  }
  const app = testApp(TEST_ENV, db, relay)
  const ada = await signUp(app, "ada")
  const created = await app.request("/api/expeditions", {
    method: "POST",
    headers: ada.headers,
    body: JSON.stringify({ title: "Compute" }),
  })
  const { id: exp } = (await created.json()) as { id: string }
  const live = (headers: Record<string, string>) =>
    app.request(`/api/expeditions/${exp}/live`, {
      headers: { ...headers, upgrade: "websocket" },
    })
  return { db, app, joins, ada, exp, live }
}

describe("the live route", () => {
  it("hands a collaborator's upgrade to the relay with the head seq, and refuses others", async () => {
    const s = await setup()
    const res = await s.live(s.ada.headers)
    expect(await res.text()).toBe("upgraded")
    expect(s.joins).toEqual([
      {
        expeditionId: s.exp,
        userId: s.ada.id,
        name: "ada",
        access: "collaborator",
        headSeq: 1,
      },
    ])

    const plain = await s.app.request(`/api/expeditions/${s.exp}/live`, {
      headers: s.ada.headers,
    })
    expect(plain.status).toBe(426)
    const eve = await signUp(s.app, "eve")
    expect((await s.live(eve.headers)).status).toBe(404)
    expect((await s.live({})).status).toBe(404)

    const noRoom = testApp(TEST_ENV, s.db)
    expect(
      (
        await noRoom.request(`/api/expeditions/${s.exp}/live`, {
          headers: { ...s.ada.headers, upgrade: "websocket" },
        })
      ).status
    ).toBe(501)
  })

  it("lets an invited viewer in as a collaborator", async () => {
    const s = await setup()
    const bob = await signUp(s.app, "bob")
    await s.db
      .insert(schema.collaborators)
      .values({ expeditionId: s.exp, userId: bob.id, role: "viewer" })
    expect(await (await s.live(bob.headers)).text()).toBe("upgraded")
    expect(s.joins[0]).toMatchObject({ userId: bob.id, access: "collaborator" })
  })

  it("lets readers of an unlisted link in: signed in read-only, signed out anonymous", async () => {
    const s = await setup()
    await s.db
      .update(schema.expeditions)
      .set({ visibility: "unlisted" })
      .where(eq(schema.expeditions.id, s.exp))
    const eve = await signUp(s.app, "eve")
    expect(await (await s.live(eve.headers)).text()).toBe("upgraded")
    expect(await (await s.live({})).text()).toBe("upgraded")
    expect(s.joins).toEqual([
      {
        expeditionId: s.exp,
        userId: eve.id,
        name: "eve",
        access: "reader",
        headSeq: 1,
      },
      {
        expeditionId: s.exp,
        userId: null,
        name: "",
        access: "anonymous",
        headSeq: 1,
      },
    ])
  })

  it("is a 404 for a deleted or missing Expedition", async () => {
    const s = await setup()
    await s.db
      .update(schema.expeditions)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(schema.expeditions.id, s.exp))
    expect((await s.live(s.ada.headers)).status).toBe(404)
    const missing = await s.app.request("/api/expeditions/nope/live", {
      headers: { ...s.ada.headers, upgrade: "websocket" },
    })
    expect(missing.status).toBe(404)
  })
})
