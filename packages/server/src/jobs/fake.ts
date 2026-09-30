// The test job: a fake build with the same shape as a real one, and no AI.
// It queues some Outline Views in one Change, then builds each in its own
// step and commits it as its own Change ("checkpoint per commit"), streaming
// `build` events with preview Concepts. Its input can force a step to fail
// once (it is retried) or on every try (the View and the job fail), can stop
// at the spending cap before a View (the job pauses until Continue), and can slow
// each step so a test can restart the runtime mid-job. A retry resumes: Views
// it built before stay as they are.
//
// Startable only where test credentials are on (a localhost Worker). The
// Building UX (WP-3.7) and the e2e tests use it.
import { SpendMeter } from "@seply/ai"
import { isLive, keysAfter, ulid, type OpBody } from "@seply/domain"
import { z } from "zod"
import { loadState } from "../projection.ts"
import type { JobDefinition } from "./types.ts"

export const FakeJobInput = z.strictObject({
  /** How many Views to build. */
  views: z.number().int().min(1).max(5).default(2),
  /** How long each View's build step takes, in ms. */
  stepMs: z.number().int().min(0).max(30_000).default(0),
  /** View numbers (1-based) whose build step throws on its first try only. */
  failOnce: z.array(z.number().int().min(1)).max(5).default([]),
  /**
   * A View whose build step throws on every try while the job is on one of
   * its first `jobAttempts` attempts (default 1): that View and the job
   * fail, and a Retry past them succeeds.
   */
  failView: z
    .strictObject({
      n: z.number().int().min(1),
      jobAttempts: z.number().int().min(1).default(1),
    })
    .optional(),
  /**
   * The View (1-based) before which the job reaches its spending cap: it
   * pauses there until the reader chooses Continue (the next attempt, with
   * the cap raised, goes on past it).
   */
  capAt: z.number().int().min(1).optional(),
})

/** The fake job's spending cap, in USD (it has spent it all by `capAt`). */
export const FAKE_CAP_USD = 0.5
export type FakeJobInput = z.infer<typeof FakeJobInput>

export const fakeViewLabel = (n: number) => `Test View ${n}`

type Planned = { n: number; viewId: string; status: string }

export const fakeJob: JobDefinition<FakeJobInput> = {
  kind: "fake",
  input: FakeJobInput,
  testOnly: true,
  notification: (_job, outcome) =>
    outcome === "complete"
      ? { title: "Test build finished", body: "Every test View is ready." }
      : { title: "Test build failed", body: "A test View could not be built." },

  async run(ctx) {
    const { views, stepMs, failOnce, failView, capAt } = ctx.input
    const failing = (n: number) =>
      failView?.n === n && ctx.job.attempt <= failView.jobAttempts
    const { expeditionId } = ctx.job
    await ctx.progress({ status: "running", step: "Planning", progress: 0 })

    // Which Views to build; ones a previous attempt built are kept.
    const plan = await ctx.step("plan", () =>
      ctx.withDb(async (db) => {
        const state = await loadState(db, expeditionId)
        if (!state) throw new Error("The Expedition is gone")
        const live = Object.values(state.views).filter(isLive)
        const out: Planned[] = []
        for (let n = 1; n <= views; n++) {
          const found = live.find((v) => v.label === fakeViewLabel(n))
          out.push({
            n,
            viewId: found?.id ?? ulid(Date.now()),
            status: found?.status ?? "new",
          })
        }
        const last =
          live
            .map((v) => v.orderKey)
            .sort()
            .at(-1) ?? null
        const keys = keysAfter(last, views)
        return { views: out, keys }
      })
    )

    await ctx.commit("queue Views", async () => ({
      label: "Queued the test Views",
      ops: plan.views
        .filter((v) => v.status !== "ready")
        .map((v): OpBody =>
          v.status === "new"
            ? {
                kind: "view.create",
                target: v.viewId,
                value: {
                  viewType: "outline",
                  label: fakeViewLabel(v.n),
                  orderKey: plan.keys[v.n - 1]!,
                  settings: { relationshipTypes: [] },
                  status: "queued",
                },
              }
            : {
                kind: "view.set",
                target: v.viewId,
                path: "status",
                value: "queued",
              }
        ),
    }))

    for (const { n, viewId, status } of plan.views) {
      if (status === "ready") continue
      const label = fakeViewLabel(n)
      if (capAt === n)
        await ctx.step(`spend before View ${n}`, async () => {
          // The whole cap is spent by here; each Continue raises it once.
          const meter = new SpendMeter({
            kind: "build",
            capUsd: FAKE_CAP_USD,
            spentUsd: FAKE_CAP_USD,
          })
          for (let i = 0; i < ctx.job.capRaises; i++) meter.raise()
          meter.check()
          return true
        })
      await ctx.progress({
        viewId,
        status: "building",
        step: `Building ${label}`,
        progress: (n - 1) / views,
        previewNodes: [
          { id: `${viewId}-a`, title: `Preview ${n}.1` },
          { id: `${viewId}-b`, title: `Preview ${n}.2` },
        ],
      })
      try {
        await ctx.step(
          `build View ${n}`,
          async ({ attempt }) => {
            if (stepMs) await new Promise((r) => setTimeout(r, stepMs))
            if (failing(n) || (failOnce.includes(n) && attempt === 1))
              throw new Error(`Forced failure while building ${label}`)
            return n
          },
          { retries: 2, retryDelayMs: 200 }
        )
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        await ctx.commit(`fail View ${n}`, async () => ({
          label: `Could not build ${label}`,
          ops: [
            {
              kind: "view.set",
              target: viewId,
              path: "status",
              value: "failed",
            },
            {
              kind: "view.set",
              target: viewId,
              path: "failReason",
              value: reason,
            },
          ],
        }))
        await ctx.progress({
          viewId,
          status: "failed",
          step: `${label} failed`,
          progress: (n - 1) / views,
          reason,
        })
        throw err
      }
      await ctx.commit(`commit View ${n}`, async () => ({
        label: `Built ${label}`,
        ops: [
          { kind: "view.set", target: viewId, path: "status", value: "ready" },
          { kind: "view.set", target: viewId, path: "failReason", value: null },
        ],
      }))
      await ctx.progress({
        viewId,
        status: "ready",
        step: `${label} is ready`,
        progress: 1,
      })
      await ctx.progress({
        status: "running",
        step: `Built ${n} of ${views}`,
        progress: n / views,
      })
    }
  },
}
