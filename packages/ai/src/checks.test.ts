// The checks reproduce the prototype's findings (prototypes/seeding/validate.py)
// on the committed fixtures, and the spec's rules (§5.3) on synthetic cases.
import {
  applyAll,
  makeOps,
  ulidSequence,
  type DomainState,
  type OpBody,
} from "@seply/domain"
import { describe, expect, it } from "vitest"
import { checkExpedition, checkView, type Finding } from "./checks/index.ts"
import { memorySourceReader } from "./ports.ts"
import { CHAT, printerTools } from "./test/printer.ts"
import { loadCompute, loadResearch, T0 } from "./test/fixtures.ts"

const nextOpId = ulidSequence(T0 + 60_000)
const edit = (s: DomainState, bodies: OpBody[]) =>
  applyAll(
    s,
    makeOps(bodies, {
      expeditionId: s.expedition.id,
      actor: "t",
      changeId: "c2",
      nextOpId,
    })
  )
const codes = (fs: Finding[]) => fs.map((f) => `${f.severity}:${f.code}`)
const problems = (fs: Finding[]) => fs.filter((f) => f.severity === "problem")

describe("checks on the committed fixtures", () => {
  it("the hand-made compute sample: only the Open models table's sparse columns are problems", async () => {
    const { state, ids } = loadCompute()
    expect(checkExpedition(state)).toEqual([])
    const found = new Map<string, Finding[]>()
    for (const [fileId, id] of ids.views)
      found.set(fileId, await checkView(state, id))
    for (const [fileId, fs] of found)
      if (fileId !== "models") expect(problems(fs), fileId).toEqual([])
    // validate.py warned on these same columns ("column 'Layers' filled 4/13").
    expect(problems(found.get("models")!).map((f) => f.message)).toEqual([
      "'Open models': column 'Active params' is filled 8/13; fill it from the Sources (class statements included), or drop it to the summaries",
      "'Open models': column 'Routed experts' is filled 7/13; fill it from the Sources (class statements included), or drop it to the summaries",
      "'Open models': column 'Active experts' is filled 5/13; fill it from the Sources (class statements included), or drop it to the summaries",
      "'Open models': column 'Shared expert' is filled 6/13; fill it from the Sources (class statements included), or drop it to the summaries",
      "'Open models': column 'Layers' is filled 4/13; fill it from the Sources (class statements included), or drop it to the summaries",
      "'Open models': column 'Context' is filled 4/13; fill it from the Sources (class statements included), or drop it to the summaries",
    ])
    // The outcome cites no reader turn: worth a look, not a block.
    expect(codes(found.get("economics")!)).toEqual(["warning:outcome-words"])
  })

  it("the research doc (generated) passes, criteria priorities included", async () => {
    const { state } = loadResearch()
    for (const v of Object.values(state.views))
      expect(problems(await checkView(state, v.id)), v.label).toEqual([])
  })

  it("flags lever→lever links in Cause & Effect, as validate.py did", async () => {
    const { state, ids } = loadCompute()
    const c = (id: string) => ids.concepts.get(id)!
    const s = edit(state, [
      {
        kind: "relationship.add",
        target: `${c("capex")}|builtin:raises|${c("distillation")}`,
        value: {},
      },
    ])
    const fs = await checkView(s, ids.views.get("economics")!)
    expect(problems(fs)).toMatchObject([
      {
        code: "lever-to-lever",
        message:
          "'Compute economics': levers link to other levers ('Hyperscaler capex → Distillation'); aim each lever at the cause or outcome it acts on",
      },
    ])
  })

  it("flags a missing outcome as a dangling id, and a Relationship left pointing nowhere", async () => {
    const { state, ids } = loadCompute()
    const econ = ids.views.get("economics")!
    const s = edit(state, [
      {
        kind: "view.set",
        target: econ,
        path: "settings.outcomes",
        value: ["gone"],
      },
    ])
    expect(problems(await checkView(s, econ))).toMatchObject([
      {
        code: "dangling-ref",
        message: "settings.outcomes names Concepts that don't exist: gone",
      },
    ])
    const broken = {
      ...state,
      relationships: {
        ...state.relationships,
        "x|builtin:uses|y": {
          from: "x",
          type: "builtin:uses",
          to: "y",
          prov: [],
          deletedAt: null,
        },
      },
    }
    expect(codes(checkExpedition(broken))).toEqual([
      "problem:dangling-relationship",
    ])
  })

  it("flags a Concept with two part-of parents in an Outline, unless the View places it", async () => {
    const { state, ids } = loadCompute()
    const c = (id: string) => ids.concepts.get(id)!
    const outline = ids.views.get("outline")!
    // Hyperscaler capex is part of Compute economics; make it part of Training too.
    const two = edit(state, [
      {
        kind: "relationship.add",
        target: `${c("capex")}|builtin:part-of|${c("t-train")}`,
        value: {},
      },
    ])
    const fs = problems(await checkView(two, outline))
    expect(fs.map((f) => f.code)).toEqual(["part-of-parents"])
    expect(fs[0]!.concepts).toEqual([c("capex")])
    const placed = edit(two, [
      {
        kind: "view.set",
        target: outline,
        path: `settings.placement.${c("capex")}`,
        value: c("t-econ"),
      },
    ])
    expect(problems(await checkView(placed, outline))).toEqual([])
    // Views that don't read part-of don't care.
    expect(problems(await checkView(two, ids.views.get("economics")!))).toEqual(
      []
    )
  })
})

/** The printer table, built through the tools, as a curator agent would. */
async function printerTable() {
  const t = printerTools()
  const x = t.tools
  const ok = <T>(r: T) => {
    expect(r).toMatchObject({ ok: true })
    return r as T & { id: string; viewId: string }
  }
  ok(
    await x.attribute_define.execute({
      id: "priority",
      label: "Priority",
      type: "enum",
      enumValues: ["hard", "nice", "dropped"],
    })
  )
  ok(
    await x.attribute_define.execute({
      id: "standing",
      label: "Standing",
      type: "enum",
      enumValues: ["chosen", "in-play", "ruled-out"],
    })
  )
  ok(
    await x.attribute_define.execute({
      id: "price",
      label: "Price",
      type: "money",
    })
  )
  const prov = (seg: string) => [{ source: "chat", segment: seg }]
  const enclosed = ok(
    await x.concept_create.execute({
      title: "Enclosed",
      kind: "builtin:criterion",
      tags: ["crit"],
      attributes: { priority: "hard" },
      prov: prov("t1"),
    })
  ).id
  const multi = ok(
    await x.concept_create.execute({
      title: "Multicolour",
      kind: "builtin:criterion",
      attributes: { priority: "nice" },
      prov: prov("t1"),
    })
  ).id
  const abs = ok(
    await x.concept_create.execute({
      title: "Runs ABS",
      kind: "builtin:criterion",
      attributes: { priority: "nice" },
      prov: prov("t2"),
    })
  ).id
  const opt = async (title: string, price: number) =>
    ok(
      await x.concept_create.execute({
        title,
        kind: "builtin:thing",
        tags: ["printer"],
        attributes: { price },
        prov: prov("t2"),
      })
    ).id
  const p2 = await opt("Orbit P2", 700)
  const kite = await opt("Kite", 300)
  const box = await opt("Box S1", 500)
  const cls = ok(
    await x.concept_create.execute({
      title: "Enclosed printers",
      kind: "builtin:idea",
      prov: prov("t2"),
    })
  ).id
  const rel = (from: string, type: string, to: string, note?: string) =>
    x.relationship_add
      .execute({ from, type: `builtin:${type}`, to, ...(note && { note }) })
      .then(ok)
  await rel(p2, "meets", enclosed)
  await rel(kite, "fails", enclosed, "no enclosure")
  await rel(box, "meets", enclosed)
  await rel(p2, "meets", multi)
  await rel(kite, "meets", multi)
  await rel(box, "fails", multi, "single colour")
  await rel(p2, "part-of", cls)
  await rel(box, "part-of", cls)
  // A class-level statement: "every enclosed printer here runs ABS".
  await rel(cls, "meets", abs, "enclosed printers run ABS")
  await rel(p2, "meets", abs)
  await rel(kite, "fails", abs)
  const view = ok(
    await x.view_build.execute({
      viewType: "comparison-table",
      label: "Which printer?",
      question: "Which printer should we buy?",
      settings: {
        rows: { tags: ["printer"] },
        columns: [
          { attribute: "price" },
          { concept: enclosed },
          { concept: multi },
          { concept: abs },
        ],
        sortBy: "price",
        standing: "standing",
        priority: "priority",
      },
    })
  ).viewId
  return { t, view, p2, kite, box, cls, abs, enclosed }
}

describe("checks on a synthetic decision (Comparison Table)", () => {
  const sources = memorySourceReader({ chat: CHAT })

  it("applies a class statement to every member before judging the column", async () => {
    const { t, view, box, abs } = await printerTable()
    const fs = problems(await checkView(t.stage.state, view, { sources }))
    expect(fs).toMatchObject([
      {
        code: "class-statement",
        message:
          "'Which printer?': 'Enclosed printers meets Runs ABS' applies to its members, but 'Box S1' has no verdict on 'Runs ABS'",
        concepts: [box],
      },
      {
        code: "column-fill",
        message:
          "'Which printer?': column 'Runs ABS' is filled 2/3; fill it from the Sources (class statements included), or drop it to the summaries",
      },
    ])
    await t.tools.relationship_add.execute({
      from: box,
      type: "builtin:meets",
      to: abs,
      note: "enclosed printers run ABS",
    })
    expect(problems(await checkView(t.stage.state, view, { sources }))).toEqual(
      []
    )
  })

  it("flags chosen without a cited reader decision, and assistant advice as no decision", async () => {
    const { t, view, p2, box, abs } = await printerTable()
    await t.tools.relationship_add.execute({
      from: box,
      type: "builtin:meets",
      to: abs,
    })
    // The assistant recommended the P2 (t2); nobody had decided yet.
    await t.tools.concept_update.execute({
      id: p2,
      attributes: { standing: "chosen" },
    })
    expect(
      problems(await checkView(t.stage.state, view, { sources }))
    ).toMatchObject([
      {
        code: "chosen-uncited",
        message:
          "'Which printer?': 'Orbit P2' is chosen, but cites only the assistant's advice (t2); set chosen only where the reader decides or acts, and cite that turn. A recommendation gets a rank or priority",
      },
    ])
    await t.tools.concept_update.execute({ id: p2, prov: [] })
    expect(
      problems(await checkView(t.stage.state, view, { sources }))[0]!.message
    ).toBe(
      "'Which printer?': 'Orbit P2' is chosen, but cites no reader decision; cite the segment where the reader decides or acts, or leave standing unset"
    )
    // "We ordered the Orbit P2 this morning": the reader acting.
    await t.tools.concept_update.execute({
      id: p2,
      prov: [
        { source: "chat", segment: "t3", quote: "we ordered the Orbit P2" },
      ],
    })
    expect(problems(await checkView(t.stage.state, view, { sources }))).toEqual(
      []
    )
    // Without the segments to read, a citation can't be checked: still blocked.
    expect(codes(await checkView(t.stage.state, view))).toContain(
      "problem:chosen-uncited"
    )
  })

  it("accepts a decision Concept citing the reader, linked to the chosen row", async () => {
    const { t, view, p2, box, abs } = await printerTable()
    await t.tools.relationship_add.execute({
      from: box,
      type: "builtin:meets",
      to: abs,
    })
    await t.tools.concept_update.execute({
      id: p2,
      attributes: { standing: "chosen" },
    })
    const d = (await t.tools.concept_create.execute({
      title: "Ordered the Orbit P2",
      kind: "builtin:decision",
      prov: [{ source: "chat", segment: "t3" }],
    })) as { id: string }
    await t.tools.relationship_add.execute({
      from: d.id,
      type: "builtin:uses",
      to: p2,
    })
    expect(problems(await checkView(t.stage.state, view, { sources }))).toEqual(
      []
    )
  })

  it("wants a priority on every criterion column, and a sparse nice-to-have column dropped", async () => {
    const { t, view, box, abs, enclosed } = await printerTable()
    await t.tools.relationship_add.execute({
      from: box,
      type: "builtin:meets",
      to: abs,
    })
    await t.tools.concept_update.execute({
      id: enclosed,
      attributes: { priority: null },
    })
    await t.tools.relationship_remove.execute({
      from: box,
      type: "builtin:meets",
      to: abs,
    })
    await t.tools.relationship_remove.execute({
      from: box,
      type: "builtin:part-of",
      to: (await printerIds(t)).cls,
    })
    const fs = problems(await checkView(t.stage.state, view, { sources }))
    expect(fs.map((f) => f.message)).toEqual([
      "'Which printer?': criterion column 'Enclosed' has no priority (hard / nice / dropped)",
      "'Which printer?': column 'Runs ABS' is filled 2/3; fill it from the Sources (class statements included), or drop it to the summaries",
    ])
  })

  it("keeps a sparse must-have column, with a warning", async () => {
    const { t, view, box, abs } = await printerTable()
    await t.tools.relationship_add.execute({
      from: box,
      type: "builtin:meets",
      to: abs,
    })
    await t.tools.relationship_remove.execute({
      from: box,
      type: "builtin:meets",
      to: (await printerIds(t)).enclosed,
    })
    const fs = await checkView(t.stage.state, view, { sources })
    expect(codes(fs)).toEqual(["warning:column-fill"])
  })

  it("wants at least three rows", async () => {
    const { t, view, kite } = await printerTable()
    await t.tools.concept_update.execute({ id: kite, removeTags: ["printer"] })
    expect(codes(await checkView(t.stage.state, view, { sources }))).toContain(
      "problem:table-rows"
    )
  })
})

describe("checks on a synthetic Cause & Effect", () => {
  it("wants build steps folded into their lever, and the outcome in the reader's words", async () => {
    const t = printerTools()
    const x = t.tools
    const id = async (title: string, extra: object = {}) =>
      (
        (await x.concept_create.execute({
          title,
          kind: "builtin:idea",
          ...extra,
        })) as { id: string }
      ).id
    const risk = await id("Air quality risk", {
      kind: "builtin:risk",
      prov: [{ source: "chat", segment: "t1" }],
    })
    const ufp = await id("Ultrafine particles")
    const fan = await id("Exhaust fan", {
      kind: "builtin:action",
      tags: ["lever"],
    })
    const step = await id("Inline fan, pulling not pushing", {
      kind: "builtin:action",
    })
    await x.relationship_add.execute({
      from: ufp,
      type: "builtin:raises",
      to: risk,
    })
    await x.relationship_add.execute({
      from: fan,
      type: "builtin:lowers",
      to: ufp,
    })
    await x.relationship_add.execute({
      from: step,
      type: "builtin:part-of",
      to: fan,
    })
    const settings = {
      mode: "risk" as const,
      positive: ["builtin:raises"],
      negative: ["builtin:lowers"],
      outcomes: [risk],
      levers: { tags: ["lever"] },
    }
    const v = (await x.view_build.execute({
      viewType: "cause-and-effect",
      label: "Air",
      settings,
    })) as { viewId: string }
    const sources = memorySourceReader({ chat: CHAT })
    expect(
      problems(await checkView(t.stage.state, v.viewId, { sources }))
    ).toMatchObject([
      {
        code: "unfolded-steps",
        message:
          "'Air': 'Inline fan, pulling not pushing' is a step of lever 'Exhaust fan' but not folded; list it in settings.fold['n2']",
      },
    ])
    await x.view_build.execute({
      viewId: v.viewId,
      viewType: "cause-and-effect",
      label: "Air",
      settings: { ...settings, fold: { [fan]: [step] } },
    })
    expect(await checkView(t.stage.state, v.viewId, { sources })).toEqual([])
    // An outcome nobody asked about is worth a look.
    await x.concept_update.execute({
      id: risk,
      prov: [{ source: "chat", segment: "t4" }],
    })
    expect(
      codes(await checkView(t.stage.state, v.viewId, { sources }))
    ).toEqual(["warning:outcome-words"])
  })
})

async function printerIds(t: ReturnType<typeof printerTools>) {
  const find = async (q: string) =>
    (
      (await t.tools.search_existing.execute({ query: q })) as {
        hits: { id: string }[]
      }
    ).hits[0]!.id
  return {
    abs: await find("Runs ABS"),
    cls: await find("Enclosed printers"),
    enclosed: await find("enclosed"),
  }
}
