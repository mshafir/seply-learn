// An in-process JobEngine with the same step semantics as Cloudflare
// Workflows (recorded results, retries with backoff, replay from the top),
// for tests and local tools. Its checkpoints live in memory, so they survive
// `crash()` (a simulated runtime restart) but not the process.
import { runJob } from "./host.ts"
import type {
  JobDeps,
  JobEngine,
  JobPayload,
  JobRegistry,
  Json,
  Steps,
} from "./types.ts"
import { instanceId } from "./types.ts"

/** Thrown into a run the engine has dropped (terminated or crashed). */
class Halted extends Error {
  constructor() {
    super("halted")
  }
}

type Instance = {
  payload: JobPayload
  /** Recorded step results, by step name. */
  results: Map<string, Json>
  /** Bumped on crash and terminate; a run of an older generation halts. */
  generation: number
  status: "running" | "complete" | "errored" | "terminated"
  done: Promise<void>
}

export type InlineEngine = JobEngine & {
  /**
   * Simulates a runtime restart: every running attempt is dropped at its next
   * step boundary, and the step in flight is not recorded. Nothing resumes
   * until `wake` (as with `wrangler dev`).
   */
  crash(): void
  /** Resolves when the attempt's current run has stopped. */
  settled(id: string): Promise<void>
  status(id: string): Instance["status"] | undefined
  /** Step names in the order their results were recorded. */
  recorded(id: string): string[]
}

export function createInlineEngine(opts: {
  deps: JobDeps
  registry: JobRegistry
  /** Multiplies retry delays (default 0: retry at once). */
  delayScale?: number
}): InlineEngine {
  const { deps, registry } = opts
  const delayScale = opts.delayScale ?? 0
  const instances = new Map<string, Instance>()

  const execute = (inst: Instance) => {
    const generation = inst.generation
    const live = () => inst.generation === generation
    const steps: Steps = {
      async do(name, options, fn) {
        if (!live()) throw new Halted()
        if (inst.results.has(name)) return inst.results.get(name) as never
        for (let attempt = 1; ; attempt++) {
          try {
            const value = await fn({ attempt })
            if (!live()) throw new Halted()
            inst.results.set(name, structuredClone(value))
            return value
          } catch (err) {
            if (err instanceof Halted || !live()) throw new Halted()
            if (attempt > options.retries) throw err
            const wait = options.retryDelayMs * 2 ** (attempt - 1) * delayScale
            if (wait > 0) await new Promise((r) => setTimeout(r, wait))
          }
        }
      },
    }
    inst.status = "running"
    inst.done = runJob(inst.payload, steps, deps, registry).then(
      () => {
        if (live()) inst.status = "complete"
      },
      (err) => {
        if (err instanceof Halted || !live()) return
        inst.status = "errored"
      }
    )
  }

  const get = (id: string) => {
    const inst = instances.get(id)
    if (!inst) throw new Error(`no instance ${id}`)
    return inst
  }

  return {
    async launch(payload) {
      const id = instanceId(payload)
      if (instances.has(id)) throw new Error(`instance ${id} exists`)
      const inst: Instance = {
        payload,
        results: new Map(),
        generation: 0,
        status: "running",
        done: Promise.resolve(),
      }
      instances.set(id, inst)
      execute(inst)
    },
    async terminate(id) {
      const inst = instances.get(id)
      if (!inst || inst.status !== "running") return
      inst.generation++
      inst.status = "terminated"
    },
    async wake(id) {
      const inst = instances.get(id)
      if (!inst || inst.status !== "running") return
      inst.generation++
      execute(inst)
    },
    crash() {
      for (const inst of instances.values())
        if (inst.status === "running") inst.generation++
    },
    settled: (id) => get(id).done,
    status: (id) => instances.get(id)?.status,
    recorded: (id) => [...get(id).results.keys()],
  }
}
