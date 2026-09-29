// WP-0.5 evidence: does TanStack DB's optimistic layer flicker when the op
// engine feeds it? Every test records every change event of the concepts
// collection AND of a live query over it, and asserts no row ever goes back
// to a value it had moved past.
import { createLiveQueryCollection, createTransaction } from "@tanstack/db"
import {
  applyAll,
  builtinId,
  emptyState,
  makeOps,
  ulidSequence,
  type DomainState,
  type OpBody,
} from "@umbel/domain"
import { afterEach, describe, expect, it } from "vitest"
import type { ConceptRow } from "../rows.ts"
import { findFlicker, Recorder } from "./flicker.ts"
import { SimClient, SimServer } from "./sim.ts"

const EXP = "exp1"
const T0 = Date.parse("2026-09-01T00:00:00Z")

function baseState(): DomainState {
  const bodies: OpBody[] = ["c1", "c2"].map((id) => ({
    kind: "concept.create",
    target: id,
    value: { title: `Concept ${id}`, kind: builtinId("idea") },
  }))
  const ops = makeOps(bodies, {
    expeditionId: EXP,
    actor: "seed",
    changeId: "seed",
    nextOpId: ulidSequence(T0 - 10_000),
  })
  return applyAll(emptyState(EXP), ops)
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

let disposers: Array<() => void> = []
afterEach(() => {
  for (const d of disposers) d()
  disposers = []
})

let seq = 0
type EditPath = "handlers" | "transaction"
function setup(
  path: EditPath,
  opts: ConstructorParameters<typeof SimClient>[3] = {}
) {
  const base = baseState()
  const server = new SimServer(base)
  const id = `t${++seq}`
  const me = new SimClient("me", server, base, { ...opts, id, startMs: T0 })
  const other = new SimClient("other", server, base, {
    id,
    startMs: T0 + 1_000_000,
  })
  const title = (c: ConceptRow) => c.title
  const coll = new Recorder(me.collections.concepts, title)
  const live = createLiveQueryCollection({
    id: `${id}:live`,
    startSync: true,
    query: (q) =>
      q
        .from({ c: me.collections.concepts })
        .select(({ c }) => ({ id: c.id, title: c.title })),
  })
  const query = new Recorder(live, (r: { title: string }) => r.title)
  disposers.push(
    () => coll.stop(),
    () => query.stop(),
    () => void live.cleanup(),
    () => me.dispose(),
    () => other.dispose()
  )
  const setTitle = (key: string, value: string) => {
    const edit = () =>
      me.collections.concepts.update(key, (d) => {
        d.title = value
      })
    if (path === "handlers") return edit() // collection onUpdate
    // An explicit transaction with our mutationFn (autoCommit).
    const tx = createTransaction({ mutationFn: me.collections.mutationFn })
    tx.mutate(edit)
    return tx
  }
  /** Both layers' timelines for c1 checked against the allowed order. */
  const flickers = (order: string[]) => ({
    collection: findFlicker(coll.timeline("c1"), order),
    liveQuery: findFlicker(query.timeline("c1"), order),
  })
  const shown = () => me.collections.concepts.get("c1")?.title
  return { server, me, other, coll, query, setTitle, flickers, shown }
}

const NONE = { collection: [], liveQuery: [] }

describe.each<EditPath>(["handlers", "transaction"])(
  "op engine → TanStack DB, edits via %s: no flicker",
  (path) => {
    it("one edit, echo later: optimistic value goes straight to synced", async () => {
      const t = setup(path)
      const tx = t.setTitle("c1", "A")
      await tx.isPersisted.promise
      expect(t.shown()).toBe("A")
      t.me.push()
      await tick()
      t.me.pull() // server echo
      await tick()
      expect(t.me.engine.pending).toHaveLength(0)
      expect(t.flickers(["Concept c1", "A"])).toEqual(NONE)
      // At most a redundant same-value event when the synced row lands.
      expect(new Set(t.coll.timeline("c1"))).toEqual(
        new Set(["Concept c1", "A"])
      )
    })

    it("fast typing: 60 edits without awaiting, echoes trickling in", async () => {
      const t = setup(path)
      const values = Array.from({ length: 60 }, (_, i) => `typed ${i + 1}`)
      for (const [i, v] of values.entries()) {
        t.setTitle("c1", v) // not awaited: transactions overlap
        if (i % 3 === 0) t.me.push()
        if (i % 5 === 0) t.me.pull(2) // partial, delayed confirmations
        if (i % 7 === 0) await tick()
      }
      t.me.push()
      await tick()
      t.me.pull()
      await tick()
      expect(t.shown()).toBe("typed 60")
      expect(t.me.engine.pending).toHaveLength(0)
      expect(t.flickers(["Concept c1", ...values])).toEqual(NONE)
    })

    it("delayed confirmation: the handler also awaits the server", async () => {
      // Not the design (the engine owns durability), but it must not flicker either.
      const ref: { me?: SimClient } = {}
      const t = setup(path, {
        awaitPersist: async () => {
          await wait(5)
          ref.me!.push()
          await wait(5)
          ref.me!.pull()
        },
      })
      ref.me = t.me
      const values = ["one", "two", "three", "four"]
      const txs = values.map((v) => t.setTitle("c1", v))
      await Promise.all(txs.map((tx) => tx.isPersisted.promise))
      await tick()
      expect(t.shown()).toBe("four")
      expect(t.flickers(["Concept c1", ...values])).toEqual(NONE)
    })

    it("reorder: another client's edit lands first, ours wins, theirs never shows", async () => {
      const t = setup(path)
      t.setTitle("c1", "mine")
      await tick()
      // The other client's edit reaches the server before ours…
      t.other.engine.propose([
        { kind: "concept.set", target: "c1", path: "title", value: "theirs" },
      ])
      t.other.push()
      t.me.pull() // …and reaches us while ours is still pending: rebase keeps ours on top.
      await tick()
      expect(t.shown()).toBe("mine")
      t.me.push()
      t.me.pull() // our echo: ours has the later server_seq, so it wins
      await tick()
      expect(t.shown()).toBe("mine")
      expect(t.flickers(["Concept c1", "mine"])).toEqual(NONE)
    })

    it("reorder on other fields merges without touching the edited one", async () => {
      const t = setup(path)
      t.setTitle("c1", "mine")
      t.other.engine.propose([
        {
          kind: "concept.set",
          target: "c1",
          path: "summary",
          value: "from other",
        },
      ])
      t.other.push()
      t.me.pull()
      await tick()
      t.me.push()
      t.me.pull()
      await tick()
      const c1 = t.me.collections.concepts.get("c1")
      expect(c1?.title).toBe("mine")
      expect(c1?.summary).toBe("from other")
      expect(t.flickers(["Concept c1", "mine"])).toEqual(NONE)
    })

    it("a later remote edit legitimately replaces ours, with no revert in between", async () => {
      const t = setup(path)
      t.setTitle("c1", "mine")
      t.me.push()
      t.other.engine.propose([
        { kind: "concept.set", target: "c1", path: "title", value: "theirs" },
      ])
      t.other.push() // after ours: theirs is the last writer
      t.me.pull()
      await tick()
      expect(t.shown()).toBe("theirs")
      expect(t.flickers(["Concept c1", "mine", "theirs"])).toEqual(NONE)
    })

    it("a refused op reverts once, straight back to the confirmed value", async () => {
      const t = setup(path)
      t.setTitle("c1", "A")
      t.setTitle("c1", "B")
      await tick()
      // The server refuses both (say, the role changed): a real revert, not flicker.
      t.me.engine.reject(t.me.engine.pending.map((op) => op.opId))
      await tick()
      expect(t.shown()).toBe("Concept c1")
      expect(t.flickers(["Concept c1", "A", "B", "Concept c1"])).toEqual(NONE)
      expect(t.coll.timeline("c1").at(-1)).toBe("Concept c1")
    })

    it("an edit with no op for it is refused, not left showing", async () => {
      const t = setup(path)
      const edit = () =>
        t.me.collections.concepts.update("c1", (d) => {
          d.deletedAt = "2026-09-02T00:00:00.000Z" // not settable: no op
        })
      const tx =
        path === "handlers"
          ? edit()
          : createTransaction({ mutationFn: t.me.collections.mutationFn })
      if (path === "transaction") tx.mutate(edit)
      await expect(tx.isPersisted.promise).rejects.toThrow(/no op/)
      expect(t.me.collections.concepts.get("c1")?.deletedAt).toBeNull()
    })

    it("randomised: edits, pushes, pulls and remote edits interleaved", async () => {
      let rnd = 42
      const random = () =>
        (rnd = (rnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
      const t = setup(path)
      const mine: string[] = []
      for (let i = 0; i < 200; i++) {
        const r = random()
        if (r < 0.5) {
          const v = `m${i}`
          mine.push(v)
          t.setTitle("c1", v)
        } else if (r < 0.65) t.me.push()
        else if (r < 0.8) t.me.pull(1 + Math.floor(random() * 3))
        else if (r < 0.9) {
          // Remote edits on another field and another Concept.
          t.other.engine.propose([
            {
              kind: "concept.set",
              target: "c2",
              path: "title",
              value: `o${i}`,
            },
            {
              kind: "concept.set",
              target: "c1",
              path: "summary",
              value: `o${i}`,
            },
          ])
          t.other.push()
        } else await tick()
      }
      t.me.push()
      t.me.pull()
      await tick()
      expect(t.shown()).toBe(mine.at(-1))
      expect(t.me.engine.pending).toHaveLength(0)
      expect(t.flickers(["Concept c1", ...mine])).toEqual(NONE)
    })
  }
)

describe("diffs delivered late (after the handler resolved)", () => {
  it("transaction + mutationFn: DOES flicker (the detector works)", async () => {
    const t = setup("transaction", { delivery: "deferred" })
    const tx = t.setTitle("c1", "A")
    await tx.isPersisted.promise
    await tick()
    await tick()
    expect(t.shown()).toBe("A")
    // optimistic "A" → back to "Concept c1" → "A" once the late diff lands
    expect(t.coll.timeline("c1")).toEqual([
      "Concept c1",
      "A",
      "Concept c1",
      "A",
    ])
    expect(t.flickers(["Concept c1", "A"]).collection).toHaveLength(1)
    expect(t.flickers(["Concept c1", "A"]).liveQuery).toHaveLength(1)
  })

  it("collection handlers: no flicker (TanStack DB keeps the row until sync writes it)", async () => {
    const t = setup("handlers", { delivery: "deferred" })
    const tx = t.setTitle("c1", "A")
    await tx.isPersisted.promise
    await tick()
    await tick()
    expect(t.shown()).toBe("A")
    expect(t.flickers(["Concept c1", "A"])).toEqual(NONE)
  })
})
