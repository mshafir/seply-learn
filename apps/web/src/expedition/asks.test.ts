import { describe, expect, it } from "vitest"

import {
  actionRationale,
  activityItems,
  askStatus,
  costCopy,
  isAsking,
  keyCopy,
  sessionAsk,
  withPart,
} from "@/expedition/asks.ts"
import { activeJob, withJobs, EMPTY_LOG } from "@/expedition/build-state.ts"
import { parseSseEvents, type Job } from "@/lib/api.ts"

const job = (over: Partial<Job> = {}): Job => ({
  id: "j1",
  expeditionId: "e1",
  kind: "grow",
  input: { action: "missing", conceptId: "qlora" },
  startedBy: "ada",
  status: "queued",
  step: null,
  progress: 0,
  error: null,
  attempt: 1,
  capRaises: 0,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...over,
})

describe("asks", () => {
  it("words a Concept action as the server does", () => {
    expect(actionRationale("missing", "QLoRA")).toBe(
      "Add what's missing to understand QLoRA"
    )
    expect(actionRationale("examples", "QLoRA")).toBe("Add examples of QLoRA")
    expect(actionRationale("related", "QLoRA")).toBe(
      "Suggest Concepts related to QLoRA"
    )
  })

  it("follows a job, moved on by its stream's data-ask parts only", () => {
    const a = sessionAsk(job(), "Add what's missing to understand QLoRA")
    expect(a).toMatchObject({
      jobId: "j1",
      action: "missing",
      conceptId: "qlora",
      status: "queued",
    })
    const running = withPart(a, {
      type: "data-ask",
      id: "j1",
      data: {
        status: "running",
        step: "Suggested 2 changes so far",
        error: null,
      },
    })
    expect(running.status).toBe("running")
    expect(isAsking(running.status)).toBe(true)
    expect(
      withPart(running, {
        type: "data-ask",
        id: "other",
        data: { status: "failed", step: null, error: "x" },
      })
    ).toBe(running)
  })

  it("says where an ask stands", () => {
    const ask = { kind: "grow", error: null }
    expect(askStatus({ ...ask, status: "running" }, 0)).toBe(
      "Thinking about your ask…"
    )
    expect(askStatus({ ...ask, status: "running" }, 3)).toBe(
      "Suggested 3 changes so far…"
    )
    expect(askStatus({ ...ask, status: "complete" }, 1)).toBe(
      "Suggested 1 change"
    )
    expect(askStatus({ ...ask, status: "cancelled" }, 2)).toBe(
      "Stopped · 2 changes kept"
    )
    expect(askStatus({ ...ask, status: "paused" }, 2)).toBe(
      "Stopped at your spending cap · 2 changes kept"
    )
    expect(
      askStatus(
        {
          kind: "grow",
          status: "failed",
          error: "Nothing to suggest: it's all there.",
        },
        0
      )
    ).toBe("Nothing to suggest: it's all there.")
    expect(
      askStatus({ kind: "article", status: "running", error: null }, 0)
    ).toBe("Writing the article…")
  })

  it("sums up Activity's items, whose AI it is and what it costs", () => {
    expect(activityItems({ pending: 2, accepted: 3, dismissed: 0 })).toBe(
      "2 waiting · 3 accepted"
    )
    expect(activityItems({ pending: 0, accepted: 0, dismissed: 0 })).toBe(
      "No suggestions"
    )
    expect(keyCopy("reader")).toBe("Uses your API key")
    expect(keyCopy("instance")).toBe("Uses this instance's AI")
    expect(costCopy({ usd: 0.123, askCapUsd: 0.5 })).toBe(
      "About $0.12 an ask, at most $0.50 (your cap)"
    )
  })

  it("never counts a running ask as the build", () => {
    const log = withJobs(EMPTY_LOG, [job({ status: "running" })])
    expect(activeJob(log)).toBeNull()
  })
})

describe("parseSseEvents", () => {
  it("reads UI message stream parts, skipping [DONE] and what isn't JSON", () => {
    const parts = parseSseEvents([
      'data: {"type":"start","messageId":"j1"}',
      'data: {"type":"data-ask","id":"j1","data":{"status":"running","step":null,"error":null}}',
      "data: [DONE]",
      ": a comment",
      "data: not json",
    ])
    expect(parts.map((p) => p.type)).toEqual(["start", "data-ask"])
  })
})
