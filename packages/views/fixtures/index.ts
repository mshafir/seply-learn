// Fixtures for tests and the harness. `compute.json` is a copy of the
// prototype's committed compute sample (prototypes/sample-graphs/src/graphs/
// compute.json), the only sample fixtures may use, with its Kind and
// Relationship Type colours stored as palette names (spec 7.2) rather than
// the prototype's hex values. Everything else here is
// synthetic.
import type { Concept, Expedition, View } from "../src/model.ts";
import computeJson from "./compute.json" with { type: "json" };

export const compute = computeJson as unknown as Expedition;

/**
 * Compute economics in risk mode: the same settings as the sample's
 * mechanism-mode View, so the harness can show the ranked lever column.
 */
export const computeRiskView: View = {
  id: "economics-risk",
  label: "Compute economics · risk",
  viewType: "cause-and-effect",
  description: "What you can pull on to move frontier inference price.",
  settings: {
    mode: "risk",
    positive: ["raises"],
    negative: ["lowers"],
    outcomes: ["frontier-price"],
    levers: { tags: ["lever"] },
  },
};

const c = (id: string, extra: Partial<Concept> = {}): Concept => ({ id, title: id.toUpperCase(), kind: "idea", ...extra });

/**
 * A small synthetic Expedition with one View of each canvas View Type:
 * a two-topic learning path, a risk-mode Cause & Effect with three ranked
 * levers (two acting upstream), an Evidence View and a Lineage.
 */
export const tiny: Expedition = {
  id: "tiny",
  title: "Tiny",
  summary: "Synthetic fixture for layout tests.",
  kinds: [
    { id: "idea", label: "Idea", color: "blue" },
    { id: "claim", label: "Claim", color: "amber" },
  ],
  relationshipTypes: [
    { id: "prerequisite", label: "is needed to understand", color: "blue" },
    { id: "part-of", label: "is part of", color: "violet", dashed: true },
    { id: "raises", label: "raises", color: "red" },
    { id: "lowers", label: "lowers", color: "green" },
    { id: "supports", label: "supports", color: "indigo" },
    { id: "challenges", label: "challenges", color: "orange" },
    { id: "led-to", label: "led to", color: "teal" },
  ],
  concepts: [
    // Learning path: topic "maths" (a, b, c) and topic "models" (d, e, t, u)
    c("maths"),
    c("models"),
    c("a"),
    c("b"),
    c("c"),
    c("d"),
    c("e"),
    c("t", { tags: ["technique"] }),
    c("u", { tags: ["technique"] }),
    // Cause & Effect
    c("outcome"),
    c("driver"),
    c("mid"),
    c("lever-1", { tags: ["lever"], attributes: { impact: 1 } }),
    c("lever-2", { tags: ["lever"], attributes: { impact: 2 } }),
    c("lever-3", { tags: ["lever"], attributes: { impact: 3 } }),
    // Evidence
    c("claim-1", { kind: "claim" }),
    c("claim-2", { kind: "claim" }),
    c("study-1"),
    c("study-2"),
    c("study-3"),
    // Lineage
    c("old", { date: "1990", attributes: { area: "x" } }),
    c("newer", { date: "2001", attributes: { area: "x" } }),
    c("newest", { date: "2020", attributes: { area: "y" } }),
  ],
  relationships: [
    { from: "a", to: "maths", type: "part-of" },
    { from: "b", to: "maths", type: "part-of" },
    { from: "c", to: "maths", type: "part-of" },
    { from: "d", to: "models", type: "part-of" },
    { from: "e", to: "models", type: "part-of" },
    { from: "t", to: "models", type: "part-of" },
    { from: "u", to: "models", type: "part-of" },
    { from: "a", to: "b", type: "prerequisite" },
    { from: "b", to: "c", type: "prerequisite" },
    { from: "c", to: "d", type: "prerequisite" },
    { from: "d", to: "e", type: "prerequisite" },
    { from: "e", to: "t", type: "prerequisite" },
    { from: "e", to: "u", type: "prerequisite" },
    { from: "driver", to: "mid", type: "raises" },
    { from: "mid", to: "outcome", type: "raises" },
    { from: "lever-1", to: "outcome", type: "lowers" },
    { from: "lever-2", to: "mid", type: "lowers" },
    { from: "lever-3", to: "driver", type: "lowers" },
    { from: "study-1", to: "claim-1", type: "supports" },
    { from: "study-2", to: "claim-1", type: "challenges" },
    { from: "study-2", to: "claim-2", type: "challenges" },
    { from: "study-3", to: "claim-2", type: "supports" },
    { from: "old", to: "newer", type: "led-to" },
    { from: "newer", to: "newest", type: "led-to" },
  ],
  views: [
    {
      id: "learn",
      label: "Learning path",
      viewType: "learning-path",
      settings: { relationshipTypes: ["prerequisite"], targets: { tags: ["technique"] }, minSteps: 3 },
    },
    {
      id: "risk",
      label: "Risk",
      viewType: "cause-and-effect",
      settings: {
        mode: "risk",
        positive: ["raises"],
        negative: ["lowers"],
        outcomes: ["outcome"],
        levers: { tags: ["lever"] },
        rankBy: "impact",
      },
    },
    {
      id: "evidence",
      label: "Evidence",
      viewType: "evidence",
      settings: { supports: ["supports"], challenges: ["challenges"], claimKinds: ["claim"] },
    },
    {
      id: "lineage",
      label: "Lineage",
      viewType: "lineage",
      settings: { relationshipTypes: ["led-to"], groupBy: "area" },
    },
  ],
};

export function viewOf<T extends View["viewType"]>(e: Expedition, id: string, viewType: T) {
  const v = e.views.find((x) => x.id === id);
  if (!v || v.viewType !== viewType) throw new Error(`no ${viewType} View "${id}" in ${e.id}`);
  return v as Extract<View, { viewType: T }>;
}
