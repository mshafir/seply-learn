import { expect, test, type Browser, type Page } from "@playwright/test"
import { makeOps, ulid, type LoggedOp, type OpBody } from "@umbel/domain"
import pg from "pg"

// Two people edit the same Expedition from two browsers, through /api/push,
// and each sees the other's edit after a /api/pull. There's no UI for this
// yet, so each page drives the API with fetch from its own context (its own
// cookies). Needs E2E_DATABASE_URL (a migrated Postgres); see playwright.config.ts.
test.skip(
  !process.env.E2E_DATABASE_URL && !process.env.CI,
  "set E2E_DATABASE_URL to a migrated Postgres to run the API tests"
)

type Res = { status: number; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any
type Pulled = { headSeq: number; ops: LoggedOp[]; more: boolean }

/** fetch from inside the page, as the app will: same origin, the page's cookies. */
async function call(
  page: Page,
  method: "GET" | "POST",
  path: string,
  data?: unknown
): Promise<Res> {
  return page.evaluate(
    async ({ method, path, data }) => {
      const res = await fetch(path, {
        method,
        headers: data ? { "content-type": "application/json" } : {},
        body: data ? JSON.stringify(data) : undefined,
      })
      return { status: res.status, body: await res.json() }
    },
    { method, path, data }
  )
}

/** A fresh browser context signed in as a new test account. */
async function person(browser: Browser, name: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto("/")
  const email = `e2e-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const signUp = await call(page, "POST", "/api/auth/sign-up/email", {
    email,
    password: "e2e password, long enough",
    name,
  })
  expect(signUp.status).toBe(200)
  const me = await call(page, "GET", "/api/me")
  return { context, page, id: me.body.user.id as string }
}

test("two people edit one Expedition and see each other's edits after a pull", async ({
  browser,
}) => {
  const ada = await person(browser, "Ada")
  const ed = await person(browser, "Ed")

  // Ada creates the Expedition: its title is the log's first op.
  const created = await call(ada.page, "POST", "/api/expeditions", {
    title: "Compute",
  })
  expect(created.status).toBe(201)
  const exp: string = created.body.id

  // Ed can't see a private Expedition until Ada makes them an editor. There's
  // no invite API yet (M3), so the test adds the Collaborator row directly.
  expect(
    (await call(ed.page, "GET", `/api/pull?expedition=${exp}`)).status
  ).toBe(404)
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

  const push = (who: typeof ada, bodies: OpBody[]) => {
    const ops = makeOps(bodies, {
      expeditionId: exp,
      actor: who.id,
      changeId: ulid(Date.now()),
      nextOpId: () => ulid(Date.now()),
    })
    return call(who.page, "POST", "/api/push", { expeditionId: exp, ops })
  }
  const pull = async (who: typeof ada, since: number) => {
    const res = await call(
      who.page,
      "GET",
      `/api/pull?expedition=${exp}&since=${since}`
    )
    expect(res.status).toBe(200)
    return res.body as Pulled
  }

  // Both start from the create.
  const adaStart = await pull(ada, 0)
  const edStart = await pull(ed, 0)
  expect(edStart.headSeq).toBe(1)
  expect(edStart.ops).toEqual(adaStart.ops)

  // Ada adds a Concept; Ed renames the Expedition.
  const adaPush = await push(ada, [
    {
      kind: "concept.create",
      target: "c-kv-cache",
      value: { title: "KV cache", kind: "builtin:idea" },
    },
  ])
  expect(adaPush.status).toBe(200)
  const edPush = await push(ed, [
    {
      kind: "expedition.set",
      target: exp,
      path: "title",
      value: "Compute, renamed",
    },
  ])
  expect(edPush.status).toBe(200)
  expect(edPush.body.headSeq).toBe(3)

  // Each pulls since where they started and sees both edits, in server order.
  for (const who of [ada, ed]) {
    const { ops, headSeq } = await pull(who, 1)
    expect(headSeq).toBe(3)
    expect(ops.map((o) => [o.serverSeq, o.kind, o.actor])).toEqual([
      [2, "concept.create", ada.id],
      [3, "expedition.set", ed.id],
    ])
  }

  // Ed edits Ada's Concept; Ada sees it on her next pull.
  expect(
    (
      await push(ed, [
        {
          kind: "concept.set",
          target: "c-kv-cache",
          path: "summary",
          value: "Keys and values, kept",
        },
      ])
    ).status
  ).toBe(200)
  const adaNext = await pull(ada, 3)
  expect(adaNext.ops).toEqual([
    expect.objectContaining({
      serverSeq: 4,
      kind: "concept.set",
      target: "c-kv-cache",
      path: "summary",
      value: "Keys and values, kept",
      actor: ed.id,
    }),
  ])

  // The Library shows the renamed title to both.
  for (const who of [ada, ed]) {
    const list = await call(who.page, "GET", "/api/expeditions")
    expect(list.body.expeditions).toContainEqual(
      expect.objectContaining({ id: exp, title: "Compute, renamed" })
    )
  }

  await ada.context.close()
  await ed.context.close()
})
