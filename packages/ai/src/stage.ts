// Staged ops: the curator's edits, held until they are committed as a Change
// (or handed over as a Proposal). Every body is validated against the
// `@seply/domain` op schema and applied to a working copy of the state, so a
// tool call that the domain would reject fails at once, with the reason.
import {
  apply,
  ApplyError,
  parseOpBody,
  SCHEMA_V,
  ulid,
  type DomainState,
  type Op,
  type OpBody,
} from "@seply/domain"

export type StageResult = { ok: true } | { ok: false; error: string }

export class Stage {
  #base: DomainState
  #state: DomainState
  #staged: OpBody[] = []
  #nextOpId: () => string

  constructor(base: DomainState, opts: { nextOpId?: () => string } = {}) {
    this.#base = base
    this.#state = base
    this.#nextOpId = opts.nextOpId ?? (() => ulid(Date.now()))
  }

  /** The state as of the last commit. */
  get base(): DomainState {
    return this.#base
  }
  /** The state with every staged op applied: what the tools read. */
  get state(): DomainState {
    return this.#state
  }
  /** The staged op bodies, in order. */
  get staged(): readonly OpBody[] {
    return this.#staged
  }

  /**
   * Validates and applies op bodies, all or none: when one fails, nothing is
   * staged and the error names it.
   */
  stage(bodies: readonly OpBody[]): StageResult {
    let next = this.#state
    for (const b of bodies) {
      const parsed = parseOpBody(b)
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".") || "op"}: ${i.message}`)
          .join("; ")
        return { ok: false, error: `${b.kind} ${b.target}: ${issues}` }
      }
      try {
        next = apply(next, this.#envelope(parsed.data))
      } catch (e) {
        if (e instanceof ApplyError) return { ok: false, error: e.message }
        throw e
      }
    }
    this.#state = next
    this.#staged.push(...bodies)
    return { ok: true }
  }

  /** Takes the staged bodies out, and makes the current state the new base. */
  take(): OpBody[] {
    const out = this.#staged
    this.#staged = []
    this.#base = this.#state
    return out
  }

  /** Drops every staged op. */
  discard(): void {
    this.#staged = []
    this.#state = this.#base
  }

  #envelope(body: OpBody): Op {
    // Only `apply` sees this envelope; the committed ops get the Change's.
    return {
      opId: this.#nextOpId(),
      expeditionId: this.#state.expedition.id,
      actor: "curator",
      changeId: "staged",
      clientSeq: 0,
      schemaV: SCHEMA_V,
      ...body,
    }
  }
}
