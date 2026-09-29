import { describe, expect, it } from "vitest"
import { fetchTransport, SyncHttpError } from "./transport.ts"

function stub(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  }) as unknown as typeof globalThis.fetch
  return { calls, fetch }
}

describe("fetchTransport (the WP-1.2 endpoints)", () => {
  it("POSTs /push with the ops and Changes, same-origin credentials", async () => {
    const s = stub(200, { headSeq: 3, results: [{ opId: "o1", serverSeq: 3 }] })
    const t = fetchTransport({ fetch: s.fetch })
    const res = await t.push({
      expeditionId: "exp1",
      ops: [],
      changes: [{ id: "ch1", origin: "human", label: "Edited A" }],
    })
    expect(res.headSeq).toBe(3)
    expect(s.calls[0]!.url).toBe("/api/push")
    expect(s.calls[0]!.init).toMatchObject({
      method: "POST",
      credentials: "include",
    })
    expect(JSON.parse(String(s.calls[0]!.init.body))).toEqual({
      expeditionId: "exp1",
      ops: [],
      changes: [{ id: "ch1", origin: "human", label: "Edited A" }],
    })
  })

  it("GETs /pull?expedition=&since=", async () => {
    const s = stub(200, { headSeq: 0, ops: [], more: false })
    const t = fetchTransport({ fetch: s.fetch, baseUrl: "http://x.test/api/" })
    await t.pull({ expeditionId: "exp 1", since: 7 })
    expect(s.calls[0]!.url).toBe(
      "http://x.test/api/pull?expedition=exp+1&since=7"
    )
  })

  it("throws SyncHttpError with the server's body on an error status", async () => {
    const s = stub(409, {
      error: "op does not apply",
      opId: "o1",
      message: "gone",
    })
    const t = fetchTransport({ fetch: s.fetch })
    const err = await t
      .push({ expeditionId: "exp1", ops: [] })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SyncHttpError)
    expect(err).toMatchObject({
      status: 409,
      body: { opId: "o1" },
      message: "gone",
    })
  })
})
