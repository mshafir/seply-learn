// GET /history (WP-4.2): the Changes, newest first, for owners and editors.
import { makeOps, schema, ulidSequence, type OpBody } from "@seply/domain"
import { eq } from "drizzle-orm"
import { describe, expect, it } from "vitest"
import type { ChangeSummary, HistoryPage } from "./history.ts"
import {
  signUp,
  TEST_ENV,
  testApp,
  testDb,
  type TestUser,
} from "./test-harness.ts"

async function setup() {
  const db = await testDb()
  const app = testApp(TEST_ENV, db)
  const ada = await signUp(app, "ada")
  const ed = await signUp(app, "ed")
  const res = await app.request("/api/expeditions", {
    method: "POST",
    headers: ada.headers,
    body: JSON.stringify({ title: "Compute" }),
  })
  const { id } = (await res.json()) as { id: string }
  await db
    .insert(schema.collaborators)
    .values({ expeditionId: id, userId: ed.id, role: "editor" })
  const nextOpId = ulidSequence(Date.now() + 1000)
  let n = 0
  const push = async (user: TestUser, bodies: OpBody[], label: string) => {
    const changeId = `ch${++n}`
    const r = await app.request("/api/push", {
      method: "POST",
      headers: user.headers,
      body: JSON.stringify({
        expeditionId: id,
        ops: makeOps(bodies, {
          expeditionId: id,
          actor: user.id,
          changeId,
          nextOpId,
        }),
        changes: [{ id: changeId, label }],
      }),
    })
    expect(r.status).toBe(200)
    return changeId
  }
  const history = (user: TestUser | null, query = "") =>
    app.request(`/api/history?expedition=${id}${query}`, {
      headers: user?.headers ?? {},
    })
  return { db, app, ada, ed, id, push, history }
}

const concept = (id: string, title: string): OpBody => ({
  kind: "concept.create",
  target: id,
  value: { title, kind: "builtin:idea" },
})

describe("GET /history", () => {
  it("lists Changes newest first, with author, label, time and span", async () => {
    const { ada, ed, push, history } = await setup()
    await push(
      ada,
      [concept("c1", "Attention"), concept("c2", "MLA")],
      "Added two"
    )
    await push(
      ed,
      [
        {
          kind: "concept.set",
          target: "c1",
          path: "title",
          value: "Self-attention",
        },
      ],
      "Edited Attention"
    )
    const res = await history(ed)
    expect(res.status).toBe(200)
    const page = (await res.json()) as HistoryPage
    expect(page.more).toBe(false)
    expect(page.headSeq).toBe(4)
    expect(
      page.changes.map((c) => [c.label, c.author.name, c.firstSeq, c.lastSeq])
    ).toEqual([
      ["Edited Attention", "ed", 4, 4],
      ["Added two", "ada", 2, 3],
      ["Created the Expedition", "ada", 1, 1],
    ])
    const [first] = page.changes as [ChangeSummary]
    expect(first).toMatchObject({ origin: "human", author: { id: ed.id } })
    expect(Number.isNaN(Date.parse(first.at))).toBe(false)
  })

  it("pages with before and limit", async () => {
    const { ada, push, history } = await setup()
    for (let i = 0; i < 4; i++)
      await push(ada, [concept(`c${i}`, `C${i}`)], `Added C${i}`)
    const one = (await (await history(ada, "&limit=2")).json()) as HistoryPage
    expect(one.changes.map((c) => c.label)).toEqual(["Added C3", "Added C2"])
    expect(one.more).toBe(true)
    const two = (await (
      await history(ada, `&limit=2&before=${one.changes[1]!.firstSeq}`)
    ).json()) as HistoryPage
    expect(two.changes.map((c) => c.label)).toEqual(["Added C1", "Added C0"])
    expect(two.more).toBe(true)
  })

  it("is for owners and editors only", async () => {
    const { db, app, ed, id, history } = await setup()
    const vic = await signUp(app, "vic")
    // A stranger: as if there were no such Expedition.
    expect((await history(vic)).status).toBe(404)
    // Signed out.
    expect((await history(null)).status).toBe(401)
    // A viewer can read the Expedition but not its History.
    await db
      .insert(schema.collaborators)
      .values({ expeditionId: id, userId: vic.id, role: "viewer" })
    expect((await history(vic)).status).toBe(403)
    // Nor can anyone reading a public link.
    await db
      .update(schema.expeditions)
      .set({ visibility: "public" })
      .where(eq(schema.expeditions.id, id))
    const sam = await signUp(app, "sam")
    expect((await history(sam)).status).toBe(403)
    expect((await history(ed)).status).toBe(200)
    // A bad query.
    const bad = await app.request("/api/history", { headers: ed.headers })
    expect(bad.status).toBe(400)
  })
})
