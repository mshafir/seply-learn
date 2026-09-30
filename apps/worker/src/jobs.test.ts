import type { JobPayload } from "@seply/server"
import { describe, expect, it } from "vitest"
import { workflowsEngine, workflowSteps } from "./jobs"

function fakeWorkflow(status: string) {
  const calls: string[] = []
  const inst = {
    status: async () => ({ status }),
    pause: async () => void calls.push("pause"),
    resume: async () => void calls.push("resume"),
    terminate: async () => void calls.push("terminate"),
  }
  const wf = {
    create: async (o: { id: string; params: JobPayload }) => {
      calls.push(`create ${o.id}`)
      return inst
    },
    get: async (id: string) => {
      calls.push(`get ${id}`)
      return inst
    },
  }
  return { wf: wf as unknown as Workflow<JobPayload>, calls }
}

const payload: JobPayload = {
  jobId: "J",
  expeditionId: "E",
  kind: "fake",
  input: {},
  startedBy: "U",
  attempt: 2,
  capRaises: 0,
}

describe("the Workflows engine", () => {
  it("runs each attempt as its own instance", async () => {
    const { wf, calls } = fakeWorkflow("queued")
    await workflowsEngine(wf).launch(payload)
    expect(calls).toEqual(["create J-2"])
  })

  it("terminates open instances only", async () => {
    const open = fakeWorkflow("running")
    await workflowsEngine(open.wf).terminate("J-1")
    expect(open.calls).toEqual(["get J-1", "terminate"])
    const done = fakeWorkflow("complete")
    await workflowsEngine(done.wf).terminate("J-1")
    expect(done.calls).toEqual(["get J-1"])
  })

  it("wakes a running instance by pausing and resuming it", async () => {
    const running = fakeWorkflow("running")
    await workflowsEngine(running.wf).wake!("J-1")
    expect(running.calls).toEqual(["get J-1", "pause", "resume"])
    const errored = fakeWorkflow("errored")
    await workflowsEngine(errored.wf).wake!("J-1")
    expect(errored.calls).toEqual(["get J-1"])
  })

  it("maps step options onto Workflow step config and passes the attempt", async () => {
    const seen: unknown[] = []
    const step = {
      do: async (
        name: string,
        config: unknown,
        fn: (ctx: { attempt: number }) => Promise<unknown>
      ) => {
        seen.push(name, config)
        return fn({ attempt: 3 })
      },
    }
    const out = await workflowSteps(step as never).do(
      "plan",
      { retries: 2, retryDelayMs: 500, timeoutMs: 60_000 },
      async ({ attempt }) => attempt
    )
    expect(out).toBe(3)
    expect(seen).toEqual([
      "plan",
      {
        retries: { limit: 2, delay: 500, backoff: "exponential" },
        timeout: 60_000,
      },
    ])
  })
})
