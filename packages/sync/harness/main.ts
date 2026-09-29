// WP-0.5 harness page: `pnpm --filter @umbel/sync harness`. Dev-only; not
// part of the package's exports. Renders Concepts from a TanStack DB live
// query, types fast into c1's title and simulates push delay, echo delay and
// another client's edits landing first. A MutationObserver records every
// value the title cell shows; findFlicker checks it.
import { createLiveQueryCollection, createTransaction } from "@tanstack/db"
import {
  applyAll,
  builtinId,
  emptyState,
  makeOps,
  ulidSequence,
  type DomainState,
} from "@umbel/domain"
import { findFlicker } from "../src/spike/flicker.ts"
import { SimClient, SimServer } from "../src/spike/sim.ts"

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T
const num = (id: string) => Number($<HTMLInputElement>(id).value)
const T0 = Date.parse("2026-09-01T00:00:00Z")
const INITIAL = "Concept c1"

function baseState(): DomainState {
  const ops = makeOps(
    ["c1", "c2", "c3"].map((id) => ({
      kind: "concept.create" as const,
      target: id,
      value: { title: `Concept ${id}`, kind: builtinId("idea") },
    })),
    {
      expeditionId: "harness",
      actor: "seed",
      changeId: "seed",
      nextOpId: ulidSequence(T0 - 10_000),
    }
  )
  return applyAll(emptyState("harness"), ops)
}

let run = 0
let teardown: () => void = () => {}

function start() {
  teardown()
  run++
  const base = baseState()
  const server = new SimServer(base)
  const delivery = $<HTMLSelectElement>("delivery").value as "sync" | "deferred"
  const me = new SimClient("me", server, base, {
    id: `h${run}`,
    delivery,
    startMs: T0,
  })
  const other = new SimClient("other", server, base, {
    id: `h${run}`,
    startMs: T0 + 1_000_000,
  })
  const live = createLiveQueryCollection({
    id: `h${run}:live`,
    startSync: true,
    query: (q) =>
      q
        .from({ c: me.collections.concepts })
        .orderBy(({ c }) => c.id)
        .select(({ c }) => ({ id: c.id, title: c.title, summary: c.summary })),
  })

  const tbody = $("rows")
  const render = () => {
    tbody.replaceChildren(
      ...live.toArray.map((r) => {
        const tr = document.createElement("tr")
        for (const v of [r.id, r.title, r.summary ?? ""]) {
          const td = document.createElement("td")
          td.textContent = v
          tr.append(td)
        }
        tr.children[1]!.id = `title-${r.id}`
        return tr
      })
    )
  }
  const sub = live.subscribeChanges(render, { includeInitialState: true })

  // Every value the c1 title cell shows, as the DOM sees it.
  const shown: string[] = []
  const observer = new MutationObserver(() => {
    const v = document.getElementById("title-c1")?.textContent
    if (v != null && v !== shown.at(-1)) shown.push(v)
  })
  observer.observe(tbody, {
    childList: true,
    subtree: true,
    characterData: true,
  })
  render()
  shown.push(INITIAL)

  const typed: string[] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t)
      fn()
    }, ms)
    timers.add(t)
  }
  const log = (line: string) => {
    const el = $("log")
    el.textContent = `${line}\n${el.textContent ?? ""}`.slice(0, 8000)
  }
  const stats = () => {
    const flickers = findFlicker(shown, [INITIAL, ...typed])
    $("stats").innerHTML =
      `run ${run} · ${typed.length} edits · pending ${me.engine.pending.length}` +
      ` · server seq ${server.log.length} · values shown ${shown.length}` +
      ` · <span class="${flickers.length ? "bad" : ""}">flickers ${flickers.length}</span>`
    for (const f of flickers.slice(-3)) log(`FLICKER at ${f.at}: ${f.reason}`)
  }
  const statsTimer = setInterval(stats, 200)

  const edit = (value: string) => {
    const doIt = () =>
      me.collections.concepts.update("c1", (d) => {
        d.title = value
      })
    if ($<HTMLSelectElement>("path").value === "handlers") doIt()
    else {
      const tx = createTransaction({ mutationFn: me.collections.mutationFn })
      tx.mutate(doIt)
    }
  }

  const burst = () => {
    const n = num("edits")
    for (let i = 0; i < n; i++) {
      later(i * num("gap"), () => {
        const v = `typed ${typed.length + 1}`
        typed.push(v)
        edit(v)
        later(Math.random() * num("pushDelay"), () => {
          if (me.unsent().length && Math.random() < num("reorder")) {
            // Another client's edit reaches the server before our push.
            other.engine.propose([
              {
                kind: "concept.set",
                target: "c1",
                path: "title",
                value: `theirs ${i}`,
              },
              {
                kind: "concept.set",
                target: "c1",
                path: "summary",
                value: `other ${i}`,
              },
            ])
            other.push()
            later(Math.random() * num("echoDelay"), () => me.pull())
            log(`other client's op landed before our push (edit ${i})`)
          }
          me.push()
          later(Math.random() * num("echoDelay"), () => me.pull())
        })
      })
    }
  }

  teardown = () => {
    for (const t of timers) clearTimeout(t)
    clearInterval(statsTimer)
    observer.disconnect()
    sub.unsubscribe()
    void live.cleanup()
    me.dispose()
    other.dispose()
    $("log").textContent = ""
  }
  return burst
}

let burst = start()
$("run").addEventListener("click", () => burst())
$("reset").addEventListener("click", () => (burst = start()))
