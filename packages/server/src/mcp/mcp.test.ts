// The MCP server (WP-5.4, spec §6) over streamable HTTP, driven by the MCP
// TypeScript SDK's own client: API tokens and their scopes and Expedition
// restriction, the Collaborator role on every call, create_expedition as a
// first build, propose_changes landing in Suggestions, agent presence, and
// OAuth (discovery, CIMD, consent with chosen Expeditions, a JWT on /mcp).
// No model anywhere: the agent is the model, and the server never spends a key.
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client"
import type { ViewReader } from "@seply/ai"
import { isLive, schema, type ProposalView } from "@seply/domain"
import { and, eq } from "drizzle-orm"
import { createHash, randomBytes } from "node:crypto"
import { beforeAll, describe, expect, it } from "vitest"
import { memoryBlobStore } from "../blobs.ts"
import type { Db } from "../db.ts"
import { loadState } from "../projection.ts"
import type { AgentPresence, Relay } from "../relay.ts"
import {
  signUp,
  TEST_ENV,
  TEST_ORIGIN,
  testApp,
  testDb,
  type TestUser,
} from "../test-harness.ts"

/**
 * A ViewReader stand-in: the real reader's first line ("<label> (<View
 * Type>): <question>"), then every live Concept title.
 */
const views: ViewReader = {
  async read(state, viewId) {
    const v = state.views[viewId]!
    const titles = Object.values(state.concepts)
      .filter(isLive)
      .map((c) => `- ${c.title}`)
    return {
      text: [`${v.label} (${v.viewType}): ${v.question}`, ...titles].join("\n"),
    }
  },
}

const CLIENT_ID = "https://agent.example/oauth/client.json"
const REDIRECT = "http://127.0.0.1:43123/callback"
/** The CIMD fetch: serves the one client's metadata document. */
const cimdFetch = async (input: RequestInfo | URL) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  if (url !== CLIENT_ID) return new Response("not found", { status: 404 })
  return Response.json(
    {
      client_id: CLIENT_ID,
      client_name: "Test Agent",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    },
    { headers: { "cache-control": "max-age=300" } }
  )
}

type Setup = {
  db: Db
  app: ReturnType<typeof testApp>
  ada: TestUser
  bob: TestUser
  cy: TestUser
  dan: TestUser
  presence: { exp: string; agent: AgentPresence }[]
  pokes: string[]
}
let s: Setup

beforeAll(async () => {
  const db = await testDb()
  const presence: Setup["presence"] = []
  const pokes: string[] = []
  const relay: Relay = {
    published() {},
    poke: (exp) => void pokes.push(exp),
    agentPresence: (exp, agent) => void presence.push({ exp, agent }),
  }
  const app = testApp(TEST_ENV, db, relay, {
    blobs: memoryBlobStore(),
    views,
    cimdFetch,
  })
  s = {
    db,
    app,
    ada: await signUp(app, "ada"),
    bob: await signUp(app, "bob"),
    cy: await signUp(app, "cy"),
    dan: await signUp(app, "dan"),
    presence,
    pokes,
  }
}, 60_000)

/** A new Expedition owned by `owner`, with bob (or ada) editing and cy viewing. */
async function expedition(title: string, owner = s.ada): Promise<string> {
  const res = await s.app.request("/api/expeditions", {
    method: "POST",
    headers: owner.headers,
    body: JSON.stringify({ title }),
  })
  const { id } = (await res.json()) as { id: string }
  const seenAt = new Date().toISOString()
  const others = [
    { expeditionId: id, userId: s.ada.id, role: "editor" as const, seenAt },
    { expeditionId: id, userId: s.bob.id, role: "editor" as const, seenAt },
    { expeditionId: id, userId: s.cy.id, role: "viewer" as const, seenAt },
  ].filter((c) => c.userId !== owner.id)
  await s.db.insert(schema.collaborators).values(others)
  return id
}

const ALL = ["expeditions:read", "expeditions:create", "proposals:write"]

/** A personal API token for `user` (the key, shown once). */
async function token(
  user: TestUser,
  scopes = ALL,
  expeditions: string[] | null = null,
  name = "Claude Code"
): Promise<{ id: string; key: string }> {
  const res = await s.app.request("/api/agents/tokens", {
    method: "POST",
    headers: user.headers,
    body: JSON.stringify({ name, scopes, expeditions }),
  })
  expect(res.status, await res.clone().text()).toBe(201)
  const body = (await res.json()) as { token: { id: string }; key: string }
  return { id: body.token.id, key: body.key }
}

/** An MCP client over streamable HTTP into the app, with a Bearer token. */
async function connect(bearer: string, modern = false): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL(`${TEST_ORIGIN}/mcp`),
    {
      fetch: async (url, init) => s.app.request(String(url), init),
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    }
  )
  const client = new Client(
    { name: "test-agent", version: "1.0.0" },
    modern ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {}
  )
  await client.connect(transport)
  return client
}

type ToolAnswer = { text: string; isError: boolean }
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<ToolAnswer> {
  const r = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[]
    isError?: boolean
  }
  return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError }
}

async function suggestions(exp: string, as = s.ada): Promise<ProposalView[]> {
  const res = await s.app.request(`/api/expeditions/${exp}/proposals`, {
    headers: as.headers,
  })
  expect(res.status).toBe(200)
  return ((await res.json()) as { proposals: ProposalView[] }).proposals
}

/** A first build an agent might send: a chat, two Concepts, a Relationship, an Outline. */
const BUILD = {
  title: "Attention, briefly",
  summary: "What attention is and why it matters.",
  tags: ["ml"],
  sources: [
    {
      ref: "new:chat",
      title: "A chat about attention",
      kind: "chat",
      segments: [
        {
          id: "t1",
          speaker: "user",
          text: "What is attention in transformers?",
        },
        {
          id: "t2",
          speaker: "assistant",
          text: "Attention lets each token weigh every other token. Multi-head attention runs several in parallel.",
        },
      ],
    },
  ],
  concepts: [
    {
      ref: "new:hub",
      title: "How attention works",
      kind: "builtin:topic",
      tags: ["topic"],
      summary: "The mechanism.",
    },
    {
      ref: "new:attn",
      title: "Attention",
      kind: "builtin:idea",
      summary: "Each token weighs every other token.",
      prov: [{ source: "new:chat", segment: "t2" }],
    },
    {
      ref: "new:mha",
      title: "Multi-head attention",
      kind: "builtin:idea",
      summary: "Several attentions in parallel.",
      overview: "It builds on [Attention](#c/new:attn).",
      prov: [
        {
          source: "new:chat",
          segment: "t2",
          quote: "runs several in parallel",
        },
      ],
    },
  ],
  relationships: [
    { from: "new:attn", type: "builtin:part-of", to: "new:hub" },
    { from: "new:mha", type: "builtin:part-of", to: "new:hub" },
    { from: "new:attn", type: "builtin:prerequisite", to: "new:mha" },
  ],
  views: [
    {
      viewType: "outline",
      label: "Outline",
      question: "What's in here?",
      settings: { relationshipTypes: ["builtin:part-of"], rootTag: "topic" },
    },
  ],
}

describe("discovery and sign-in", () => {
  it("answers 401 with the RFC 9728 challenge without a valid token", async () => {
    for (const authorization of [
      undefined,
      "Bearer nope",
      "Bearer sl_notakey",
    ]) {
      const res = await s.app.request(`${TEST_ORIGIN}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(authorization && { authorization }),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      })
      expect(res.status).toBe(401)
      expect(res.headers.get("www-authenticate")).toBe(
        `Bearer resource_metadata="${TEST_ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="expeditions:read expeditions:create proposals:write"`
      )
    }
  })

  it("serves the protected resource metadata (RFC 9728) for /mcp", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource",
    ]) {
      const res = await s.app.request(`${TEST_ORIGIN}${path}`)
      expect(res.status, path).toBe(200)
      const meta = (await res.json()) as Record<string, unknown>
      expect(meta).toMatchObject({
        resource: `${TEST_ORIGIN}/mcp`,
        authorization_servers: [`${TEST_ORIGIN}/api/auth`],
        bearer_methods_supported: ["header"],
      })
      expect(meta.scopes_supported).toEqual(ALL)
    }
  })

  it("serves the authorization server metadata (RFC 8414), with CIMD and without open registration", async () => {
    for (const path of [
      "/.well-known/oauth-authorization-server/api/auth",
      "/api/auth/.well-known/oauth-authorization-server",
    ]) {
      const res = await s.app.request(`${TEST_ORIGIN}${path}`)
      expect(res.status, path).toBe(200)
      const meta = (await res.json()) as Record<string, unknown>
      expect(meta).toMatchObject({
        issuer: `${TEST_ORIGIN}/api/auth`,
        authorization_endpoint: `${TEST_ORIGIN}/api/auth/oauth2/authorize`,
        token_endpoint: `${TEST_ORIGIN}/api/auth/oauth2/token`,
        client_id_metadata_document_supported: true,
        code_challenge_methods_supported: ["S256"],
      })
      expect(meta.registration_endpoint).toBeUndefined()
      expect(meta.scopes_supported).toEqual(expect.arrayContaining(ALL))
    }
  })

  it("lets a browser MCP client preflight /mcp and read the challenge", async () => {
    const res = await s.app.request(`${TEST_ORIGIN}/mcp`, {
      method: "OPTIONS",
      headers: {
        origin: "https://client.example",
        "access-control-request-method": "POST",
        "access-control-request-headers":
          "authorization, content-type, mcp-protocol-version",
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
    expect(res.headers.get("access-control-allow-headers")).toContain(
      "authorization"
    )
  })
})

describe("an agent with an API token", () => {
  it("lists every tool, with the seply-learn skill as its instructions", async () => {
    const client = await connect((await token(s.ada)).key)
    expect(client.getInstructions()).toMatch(/^# Seply Learn/)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_expedition",
      "get_concept",
      "get_expedition",
      "get_source_segments",
      "get_view",
      "list_expeditions",
      "list_my_proposals",
      "list_sources",
      "propose_changes",
      "search",
      "withdraw_proposal",
    ])
    const propose = tools.find((t) => t.name === "propose_changes")!
    expect(propose.annotations?.readOnlyHint).toBe(false)
    expect(JSON.stringify(propose.inputSchema)).toContain("concept_create")
    await client.close()
  })

  it("speaks the 2026-07-28 protocol too", async () => {
    const exp = await expedition("Modern")
    const client = await connect((await token(s.ada)).key, true)
    const r = await call(client, "list_expeditions")
    expect(r.isError).toBe(false)
    expect(r.text).toContain(exp)
    await client.close()
  })

  it("lists Expeditions, creates one from a chat as a first build, reads it back", async () => {
    const shared = await expedition("Bob's notes", s.bob)
    const client = await connect((await token(s.ada)).key)
    const listed = await call(client, "list_expeditions")
    expect(listed.text).toContain("## Mine")
    expect(listed.text).toContain("| Expedition | id | About |")
    expect(listed.text).toContain("## Shared with me")
    expect(listed.text).toContain(shared)

    const made = await call(client, "create_expedition", BUILD)
    expect(made.isError, made.text).toBe(false)
    const exp = /\(`([0-9A-Z]{26})`\)/.exec(made.text)![1]!
    expect(made.text).toContain(`${TEST_ORIGIN}/e/${exp}`)

    // Private, owned by ada, one Change with origin mcp, ready on its Outline.
    const [row] = await s.db
      .select()
      .from(schema.expeditions)
      .where(eq(schema.expeditions.id, exp))
    expect(row).toMatchObject({ ownerId: s.ada.id, visibility: "private" })
    const changes = await s.db
      .select()
      .from(schema.changes)
      .where(eq(schema.changes.expeditionId, exp))
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      origin: "mcp",
      author: s.ada.id,
      label: "Built from 1 Source by Claude Code (via MCP)",
    })
    const state = (await loadState(s.db, exp))!
    expect(state.expedition).toMatchObject({
      title: "Attention, briefly",
      status: "ready",
      tags: ["ml"],
    })
    const concepts = Object.values(state.concepts)
    expect(concepts.map((c) => c.title).sort()).toEqual([
      "Attention",
      "How attention works",
      "Multi-head attention",
    ])
    const attn = concepts.find((c) => c.title === "Attention")!
    const mha = concepts.find((c) => c.title === "Multi-head attention")!
    expect(mha.overview).toBe(`It builds on [Attention](#c/${attn.id}).`)
    const [source] = Object.values(state.sources)
    expect(attn.prov).toEqual([{ source: source!.id, segment: "t2" }])
    expect(Object.values(state.views)).toMatchObject([
      { viewType: "outline", status: "ready" },
    ])

    const ex = await call(client, "get_expedition", { expedition: exp })
    expect(ex.text).toContain("# Attention, briefly")
    expect(ex.text).toContain("| Outline (opens first) |")
    const view = await call(client, "get_view", {
      expedition: exp,
      view: state.expedition.bestViewId,
    })
    expect(view.text).toContain("Multi-head attention")
    expect(view.text).toContain(`\`${mha.id}\``)
    // The heading names the View once; its reading doesn't repeat it.
    expect(view.text.split("(outline)").length).toBe(1)
    const concept = await call(client, "get_concept", {
      expedition: exp,
      concept: mha.id,
      depth: "overview",
      hops: 1,
    })
    expect(concept.text).toContain("## Overview")
    expect(concept.text).toContain(
      `Attention is needed to understand Multi-head attention`
    )
    // Each neighbour is named once, then its id.
    expect(concept.text).toMatch(
      /- Attention is needed to understand Multi-head attention \(`[^`]+`\): /
    )
    const srcs = await call(client, "list_sources", { expedition: exp })
    expect(srcs.text).toContain("2 segments (chat)")
    const segs = await call(client, "get_source_segments", {
      expedition: exp,
      source: source!.id,
      segments: ["t2", "t9"],
    })
    expect(segs.text).toContain("[t2 · assistant]")
    expect(segs.text).toContain("Not in this Source: t9")
    const found = await call(client, "search", { query: "multi-head" })
    expect(found.text).toContain(mha.id)
    await client.close()
  })

  it("refuses a first build with problems, and writes nothing", async () => {
    const before = await s.db.select().from(schema.expeditions)
    const client = await connect((await token(s.ada)).key)
    const r = await call(client, "create_expedition", {
      ...BUILD,
      relationships: [
        { from: "new:attn", type: "builtin:part-of", to: "new:nowhere" },
      ],
    })
    expect(r.isError).toBe(true)
    expect(r.text).toContain("new:nowhere")
    expect(await s.db.select().from(schema.expeditions)).toHaveLength(
      before.length
    )
    await client.close()
  })

  it("proposes changes as one Proposal that shows up in Suggestions, and shows the agent in the room", async () => {
    const client = await connect((await token(s.ada)).key)
    const made = await call(client, "create_expedition", BUILD)
    const exp = /\(`([0-9A-Z]{26})`\)/.exec(made.text)![1]!
    const state = (await loadState(s.db, exp))!
    const hub = Object.values(state.concepts).find(
      (c) => c.title === "How attention works"
    )!
    const attn = Object.values(state.concepts).find(
      (c) => c.title === "Attention"
    )!
    s.presence.length = 0
    s.pokes.length = 0

    const r = await call(client, "propose_changes", {
      expedition: exp,
      rationale: "From today's session on KV caches.",
      items: [
        {
          tool: "concept_create",
          ref: "new:kv",
          input: {
            title: "KV cache",
            kind: "builtin:idea",
            summary: "Keeps keys and values between steps.",
            overview:
              "A KV cache stores each token's keys and values so [Attention](#c/" +
              attn.id +
              ") doesn't recompute them.",
            prov: [],
          },
        },
        {
          tool: "relationship_add",
          input: { from: "new:kv", type: "builtin:part-of", to: hub.id },
        },
        {
          tool: "relationship_add",
          input: { from: "new:ghost", type: "builtin:part-of", to: hub.id },
        },
        { tool: "concept_update", input: { id: attn.id, addTags: ["core"] } },
      ],
    })
    expect(r.isError, r.text).toBe(false)
    expect(r.text).toMatch(/3 suggestions wait in Suggestions \(1 refused\)/)
    expect(r.text).toContain(
      "3. relationship_add: refused: unknown temp id new:ghost"
    )

    const [p] = await suggestions(exp)
    expect(p).toMatchObject({
      origin: "mcp",
      author: { id: s.ada.id, name: "ada" },
      rationale: "From today's session on KV caches.",
      status: "pending",
    })
    expect(p!.items).toHaveLength(3)
    expect(p!.items[0]!.ops[0]).toMatchObject({
      kind: "concept.create",
      value: { title: "KV cache" },
    })
    // Nothing changed in the Expedition itself.
    expect(Object.values((await loadState(s.db, exp))!.concepts)).toHaveLength(
      3
    )
    expect(s.pokes).toContain(exp)
    expect(s.presence).toContainEqual({
      exp,
      agent: {
        userId: s.ada.id,
        label: "Claude Code (via MCP)",
        ttlMs: 5 * 60_000,
      },
    })

    // Accepting it is an ordinary review: one Change.
    const accept = await s.app.request(
      `/api/expeditions/${exp}/proposals/review`,
      {
        method: "POST",
        headers: s.ada.headers,
        body: JSON.stringify({ accept: p!.items.map((i) => i.id) }),
      }
    )
    expect(accept.status, await accept.clone().text()).toBe(200)
    expect(
      Object.values((await loadState(s.db, exp))!.concepts).map((c) => c.title)
    ).toContain("KV cache")

    const mine = await call(client, "list_my_proposals", { expedition: exp })
    expect(mine.text).toContain(p!.id)
    expect(mine.text).toContain("| accepted | 0 | 3 | 0 |")
    await client.close()
  })

  it("withdraws its own Proposal: the pending items leave Suggestions", async () => {
    const exp = await expedition("Withdraw")
    const client = await connect((await token(s.bob)).key)
    const r = await call(client, "propose_changes", {
      expedition: exp,
      rationale: "Two ideas.",
      items: [
        {
          tool: "concept_create",
          input: {
            title: "One",
            kind: "builtin:idea",
            summary: "1",
            overview: "One.",
          },
        },
        {
          tool: "concept_create",
          input: {
            title: "Two",
            kind: "builtin:idea",
            summary: "2",
            overview: "Two.",
          },
        },
      ],
    })
    const id = /Proposal `([^`]+)`/.exec(r.text)![1]!
    expect(await suggestions(exp)).toHaveLength(1)
    // Only its author can withdraw it.
    const ada = await connect((await token(s.ada)).key)
    expect(
      (await call(ada, "withdraw_proposal", { expedition: exp, proposal: id }))
        .isError
    ).toBe(true)
    const w = await call(client, "withdraw_proposal", {
      expedition: exp,
      proposal: id,
    })
    expect(w.text).toContain("2 suggestions left Suggestions")
    expect(await suggestions(exp)).toEqual([])
    const [row] = await s.db
      .select()
      .from(schema.proposals)
      .where(eq(schema.proposals.id, id))
    expect(row!.status).toBe("withdrawn")
    await client.close()
    await ada.close()
  })
})

describe("scopes, restriction and roles", () => {
  const proposal = (exp: string) => ({
    expedition: exp,
    rationale: "One idea.",
    items: [
      {
        tool: "concept_create",
        input: {
          title: "Idea",
          kind: "builtin:idea",
          summary: "s",
          overview: "o",
        },
      },
    ],
  })

  it("refuses tools outside the token's scopes", async () => {
    const exp = await expedition("Scoped")
    const client = await connect((await token(s.ada, ["expeditions:read"])).key)
    expect(
      (await call(client, "get_expedition", { expedition: exp })).isError
    ).toBe(false)
    const p = await call(client, "propose_changes", proposal(exp))
    expect(p).toMatchObject({
      isError: true,
      text: expect.stringContaining("proposals:write scope"),
    })
    const c = await call(client, "create_expedition", BUILD)
    expect(c).toMatchObject({
      isError: true,
      text: expect.stringContaining("expeditions:create scope"),
    })
    expect(await suggestions(exp)).toEqual([])
    const writeOnly = await connect(
      (await token(s.ada, ["proposals:write"])).key
    )
    expect((await call(writeOnly, "list_expeditions")).isError).toBe(true)
    await client.close()
    await writeOnly.close()
  })

  it("keeps a restricted token to its chosen Expeditions", async () => {
    const a = await expedition("Allowed")
    const b = await expedition("Elsewhere")
    const client = await connect((await token(s.ada, ALL, [a])).key)
    const listed = await call(client, "list_expeditions")
    expect(listed.text).toContain(a)
    expect(listed.text).not.toContain(b)
    for (const [tool, args] of [
      ["get_expedition", { expedition: b }],
      ["list_sources", { expedition: b }],
      ["propose_changes", proposal(b)],
    ] as const) {
      const r = await call(client, tool, args)
      expect(r, tool).toMatchObject({
        isError: true,
        text: expect.stringContaining("restricted to other Expeditions"),
      })
    }
    expect((await call(client, "propose_changes", proposal(a))).isError).toBe(
      false
    )
    expect(await suggestions(b)).toEqual([])
    // Restriction never names an Expedition the user can't see.
    const res = await s.app.request("/api/agents/tokens", {
      method: "POST",
      headers: s.dan.headers,
      body: JSON.stringify({ name: "x", scopes: ALL, expeditions: [a] }),
    })
    expect(res.status).toBe(404)
    await client.close()
  })

  it("checks the Collaborator role on every call: viewers read, strangers see nothing", async () => {
    const exp = await expedition("Roles")
    const cy = await connect((await token(s.cy)).key)
    expect(
      (await call(cy, "get_expedition", { expedition: exp })).isError
    ).toBe(false)
    expect(await call(cy, "propose_changes", proposal(exp))).toMatchObject({
      isError: true,
      text: expect.stringContaining("Only owners and editors"),
    })
    const dan = await connect((await token(s.dan)).key)
    expect(
      await call(dan, "get_expedition", { expedition: exp })
    ).toMatchObject({
      isError: true,
      text: expect.stringContaining("No Expedition"),
    })
    expect((await call(dan, "propose_changes", proposal(exp))).isError).toBe(
      true
    )
    expect((await call(dan, "list_expeditions")).text).not.toContain(exp)
    expect(await suggestions(exp)).toEqual([])
    await cy.close()
    await dan.close()
  })

  it("stops a token the moment it is deleted", async () => {
    const t = await token(s.ada)
    const client = await connect(t.key)
    const del = await s.app.request(`/api/agents/tokens/${t.id}`, {
      method: "DELETE",
      headers: s.ada.headers,
    })
    expect(del.status).toBe(204)
    await expect(client.listTools()).rejects.toThrow()
    // Someone else's token can't be deleted.
    const other = await token(s.bob)
    const res = await s.app.request(`/api/agents/tokens/${other.id}`, {
      method: "DELETE",
      headers: s.ada.headers,
    })
    expect(res.status).toBe(404)
  })

  it("lists a user's tokens in Settings, never their keys", async () => {
    await token(s.cy, ["expeditions:read"], null, "Read only")
    const res = await s.app.request("/api/agents", { headers: s.cy.headers })
    const body = (await res.json()) as {
      tokens: { name: string; scopes: string[]; start: string }[]
    }
    const t = body.tokens.find((x) => x.name === "Read only")!
    expect(t.scopes).toEqual(["expeditions:read"])
    expect(t.start).toMatch(/^sl_/)
    expect(JSON.stringify(body)).not.toMatch(/sl_[A-Za-z0-9]{20,}/)
  })
})

describe("an agent connected with OAuth", () => {
  const b64url = (b: Buffer) => b.toString("base64url")

  it("signs in through CIMD and consent, restricted to the Expeditions chosen there", async () => {
    const allowed = await expedition("OAuth allowed")
    const other = await expedition("OAuth other")
    const verifier = b64url(randomBytes(32))
    const challenge = b64url(createHash("sha256").update(verifier).digest())
    const query = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      scope: "expeditions:read proposals:write offline_access",
      state: "xyz",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: `${TEST_ORIGIN}/mcp`,
    })
    // Signed in, the authorize endpoint sends the browser to our consent page.
    const auth = await s.app.request(
      `${TEST_ORIGIN}/api/auth/oauth2/authorize?${query}`,
      {
        headers: { cookie: s.ada.headers.cookie! },
        redirect: "manual",
      }
    )
    expect(auth.status, await auth.clone().text()).toBe(302)
    const consentUrl = new URL(auth.headers.get("location")!, TEST_ORIGIN)
    expect(consentUrl.pathname).toBe("/consent")
    expect(consentUrl.searchParams.get("client_id")).toBe(CLIENT_ID)

    // The consent screen: the client's public name, the chosen Expeditions, then accept.
    const client = await s.app.request(
      `${TEST_ORIGIN}/api/auth/oauth2/public-client?client_id=${encodeURIComponent(CLIENT_ID)}`,
      { headers: s.ada.headers }
    )
    expect(((await client.json()) as { client_name: string }).client_name).toBe(
      "Test Agent"
    )
    const pick = await s.app.request("/api/agents/consent", {
      method: "POST",
      headers: s.ada.headers,
      body: JSON.stringify({ clientId: CLIENT_ID, expeditions: [allowed] }),
    })
    expect(pick.status).toBe(204)
    const consent = await s.app.request(
      `${TEST_ORIGIN}/api/auth/oauth2/consent`,
      {
        method: "POST",
        headers: s.ada.headers,
        body: JSON.stringify({
          accept: true,
          oauth_query: consentUrl.search.slice(1),
        }),
      }
    )
    expect(consent.status, await consent.clone().text()).toBe(200)
    const back = new URL(((await consent.json()) as { url: string }).url)
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT)
    expect(back.searchParams.get("state")).toBe("xyz")
    expect(back.searchParams.get("iss")).toBe(`${TEST_ORIGIN}/api/auth`)

    // The client trades the code for a JWT bound to /mcp.
    const tokenRes = await s.app.request(
      `${TEST_ORIGIN}/api/auth/oauth2/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: back.searchParams.get("code")!,
          redirect_uri: REDIRECT,
          client_id: CLIENT_ID,
          code_verifier: verifier,
          resource: `${TEST_ORIGIN}/mcp`,
        }).toString(),
      }
    )
    expect(tokenRes.status, await tokenRes.clone().text()).toBe(200)
    const tokens = (await tokenRes.json()) as {
      access_token: string
      refresh_token?: string
      scope: string
    }
    expect(tokens.access_token.split(".")).toHaveLength(3)
    expect(tokens.refresh_token).toBeTruthy()

    const agent = await connect(tokens.access_token)
    const listed = await call(agent, "list_expeditions")
    expect(listed.text).toContain(allowed)
    expect(listed.text).not.toContain(other)
    expect(
      (await call(agent, "get_expedition", { expedition: other })).isError
    ).toBe(true)
    // No expeditions:create in this grant.
    expect((await call(agent, "create_expedition", BUILD)).text).toContain(
      "expeditions:create scope"
    )
    s.presence.length = 0
    const p = await call(agent, "propose_changes", {
      expedition: allowed,
      rationale: "From the OAuth agent.",
      items: [
        {
          tool: "concept_create",
          input: {
            title: "Idea",
            kind: "builtin:idea",
            summary: "s",
            overview: "o",
          },
        },
      ],
    })
    expect(p.isError, p.text).toBe(false)
    expect(s.presence[0]!.agent.label).toBe("Test Agent (via MCP)")
    expect((await suggestions(allowed))[0]).toMatchObject({
      origin: "mcp",
      author: { id: s.ada.id },
    })

    // Settings lists the grant; revoking it ends the tokens.
    const overview = (await (
      await s.app.request("/api/agents", { headers: s.ada.headers })
    ).json()) as {
      grants: {
        clientId: string
        name: string
        expeditions: string[] | null
        scopes: string[]
      }[]
    }
    expect(overview.grants).toContainEqual(
      expect.objectContaining({
        clientId: CLIENT_ID,
        name: "Test Agent",
        expeditions: [allowed],
      })
    )
    const revoke = await s.app.request(
      `/api/agents/grants/${encodeURIComponent(CLIENT_ID)}`,
      {
        method: "DELETE",
        headers: s.ada.headers,
      }
    )
    expect(revoke.status).toBe(204)
    const left = await s.db
      .select()
      .from(schema.oauthAccessTokens)
      .where(
        and(
          eq(schema.oauthAccessTokens.userId, s.ada.id),
          eq(schema.oauthAccessTokens.clientId, CLIENT_ID)
        )
      )
    expect(left).toEqual([])
    await agent.close()
  })

  it("refuses a JWT meant for another resource", async () => {
    const res = await s.app.request(`${TEST_ORIGIN}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.c2ln",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    })
    expect(res.status).toBe(401)
  })
})
