// Push and pull, as an interface, so this package never imports the server
// or an app. `fetchTransport` speaks the WP-1.2 endpoints (packages/server
// README):
//
//   POST /push  { expeditionId, ops, changes? } → { headSeq, results: [{ opId, serverSeq }] }
//   GET  /pull?expedition=<id>&since=<seq>[&limit=<n>] → { headSeq, ops: LoggedOp[], more }
import type { LoggedOp, Op } from "@seply/domain"
import type { ChangeMeta } from "./engine.ts"

export type PushRequest = {
  expeditionId: string
  ops: readonly Op[]
  changes?: readonly ChangeMeta[]
}
export type PushResponse = {
  headSeq: number
  /** One per op, in batch order. */
  results: { opId: string; serverSeq: number }[]
}
export type PullRequest = {
  expeditionId: string
  since: number
  limit?: number
}
export type PullResponse = { headSeq: number; ops: LoggedOp[]; more: boolean }

export interface SyncTransport {
  push(req: PushRequest): Promise<PushResponse>
  pull(req: PullRequest): Promise<PullResponse>
}

/** The server answered with an error status (a network failure throws something else). */
export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: string; opId?: string; message?: string }
  ) {
    super(body.message ?? body.error ?? `HTTP ${status}`)
    this.name = "SyncHttpError"
  }
}

export type FetchTransportOptions = {
  /** Where the API is mounted (default "/api", same origin). */
  baseUrl?: string
  fetch?: typeof fetch
  /** Extra request headers (e.g. a cookie outside the browser). */
  headers?: () => Record<string, string>
}

export function fetchTransport(
  opts: FetchTransportOptions = {}
): SyncTransport {
  const base = (opts.baseUrl ?? "/api").replace(/\/$/, "")
  const doFetch = opts.fetch ?? ((...args) => globalThis.fetch(...args))
  async function call<T>(path: string, init: RequestInit): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      credentials: "include",
      ...init,
      headers: { ...opts.headers?.(), ...(init.headers as object) },
    })
    const body = (await res.json().catch(() => ({}))) as T
    if (!res.ok)
      throw new SyncHttpError(res.status, body as SyncHttpError["body"])
    return body
  }
  return {
    push: (req) =>
      call<PushResponse>("/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expeditionId: req.expeditionId,
          ops: req.ops,
          ...(req.changes?.length ? { changes: req.changes } : {}),
        }),
      }),
    pull: (req) => {
      const q = new URLSearchParams({
        expedition: req.expeditionId,
        since: String(req.since),
        ...(req.limit ? { limit: String(req.limit) } : {}),
      })
      return call<PullResponse>(`/pull?${q}`, { method: "GET" })
    },
  }
}
