// A stand-in for the `cloudflare:workers` module, so unit tests can import
// the Worker in Node. The Durable Object and Workflow run for real only under
// wrangler (see apps/web/e2e/api/jobs.spec.ts).
export const env: Record<string, unknown> = {}

export class DurableObject {
  constructor(
    readonly ctx: unknown,
    readonly env: unknown
  ) {}
}

export class WorkflowEntrypoint {
  constructor(
    readonly ctx: unknown,
    readonly env: unknown
  ) {}
}
