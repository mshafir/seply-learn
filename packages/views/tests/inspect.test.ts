// `@seply/views/inspect`: the ViewReader behind the curator agent's
// `view.inspect` (spec §5.3): each View as a reader sees it, as text, with
// the layout metrics of canvas Views. Read from the committed compute sample,
// imported the way a first build is.
import { describe, expect, it } from "vitest";
import { applyAll, importExpeditionJson, makeOps, ulidSequence, type DomainState, type OpBody } from "@seply/domain";
import compute from "@seply/domain/fixtures/compute.json";
import { readView } from "../src/inspect.ts";

const nextOpId = ulidSequence(Date.parse("2026-09-01T00:00:00Z"));
let n = 0;
const { state, ids } = importExpeditionJson(compute, {
  expeditionId: "e1",
  actor: "u",
  changeId: "c1",
  nextOpId,
  newId: () => `id${n++}`,
  at: "2026-09-01T00:00:00Z",
});
const view = (id: string) => ids.views.get(id)!;
const concept = (id: string) => ids.concepts.get(id)!;
const edit = (s: DomainState, bodies: OpBody[]) =>
  applyAll(s, makeOps(bodies, { expeditionId: "e1", actor: "curator", changeId: "c2", nextOpId }));

describe("readView", () => {
  it("reads the Learning path as its targets and their paths, and it reads well", async () => {
    const r = await readView(state, view("learn"));
    expect(r.text).toContain("16 targets, 8 shared foundations");
    expect(r.text).toMatch(/To understand Multi-head Latent Attention \(MLA\) \(Inside a transformer\): 11 steps first/);
    expect(r.layout).toMatchObject({ verdict: "reads well", overlaps: 0 });
  });

  it("flags the whole prerequisite DAG drawn at once as cluttered (the prototype's tangle)", async () => {
    // The Learning path candidate: no target filter, every prerequisite core.
    // docs/view-types/learning-path.md: "The whole prerequisite DAG fell flat as a tangle".
    const learn = view("learn");
    const tangle = edit(state, [
      {
        kind: "view.set",
        target: learn,
        path: "settings",
        value: { relationshipTypes: ["builtin:prerequisite"], minSteps: 0, coreShared: 1 },
      },
    ]);
    const r = await readView(tangle, learn);
    expect(r.layout?.verdict).toBe("cluttered");
    expect(r.layout!.crossings).toBeGreaterThan(r.layout!.edges * 0.2);
  });

  it("reads a Comparison Table as rows of cells, bands and all", async () => {
    const r = await readView(state, view("models"));
    const [, head, first] = r.text.split("\n");
    expect(head).toMatch(/^\d+ rows × \d+ columns: Developer \[Facts\]/);
    expect(first).toMatch(/^- .+: Developer: /);
    expect(r.layout).toBeUndefined();
  });

  it("leaves out the Concepts a View hides (per-View hide), in that View only", async () => {
    const hidden = edit(state, [{ kind: "view.set", target: view("techniques"), path: "settings.hide", value: [concept("gqa")] }]);
    const r = await readView(hidden, view("techniques"));
    expect((await readView(state, view("techniques"))).text).toMatch(/GQA/);
    expect(r.text).not.toMatch(/Grouped-query attention|\bGQA\b/);
    expect((await readView(hidden, view("models"))).text).toBe((await readView(state, view("models"))).text);
  });

  it("reads Cause & Effect as the outcome, its causes, and the levers with what they act on", async () => {
    const r = await readView(state, view("economics"));
    expect(r.text).toContain("Outcome: Frontier inference price & scarcity. Causes: Compute demand (raises it)");
    expect(r.text).toMatch(/- Hyperscaler capex: acts on Accelerator supply \(GPUs\/TPUs\) \(raises\), Power & grid \(raises\); net effect on the outcome: lowers/);
    expect(r.layout?.verdict).toBe("reads well");
  });

  it("draws a lever's folded build steps inside it, not as cards (the explicit fold override)", async () => {
    const econ = view("economics");
    const lever = concept("capex");
    const s = state.views[econ].settings;
    const withStep = edit(state, [
      { kind: "concept.create", target: "step", value: { title: "Sign power contracts", kind: "builtin:action" } },
      { kind: "relationship.add", target: `step|builtin:part-of|${lever}`, value: {} },
      { kind: "relationship.add", target: `step|builtin:raises|${concept("power")}`, value: {} },
      { kind: "view.set", target: econ, path: "settings", value: { ...s, fold: { [lever]: ["step"] } } },
    ]);
    const r = await readView(withStep, econ);
    expect(r.text).toMatch(/- Hyperscaler capex: .*; build steps: Sign power contracts/);
    expect(r.text).not.toMatch(/^- Sign power contracts/m);
    expect(r.layout?.shown).toBe((await readView(state, econ)).layout?.shown);
  });

  it("reads every View Type of the sample without throwing", async () => {
    for (const id of ids.views.values()) {
      const r = await readView(state, id);
      expect(r.text.split("\n").length).toBeGreaterThan(1);
    }
  });

  it("throws for a View that isn't there", async () => {
    await expect(readView(state, "nope")).rejects.toThrow("View nope not found");
  });
});
