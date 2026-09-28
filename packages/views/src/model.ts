// TODO(M1): replace with @umbel/domain types
//
// Temporary Expedition and View shapes, ported from the prototype's
// `prototypes/sample-graphs/src/lib/types.ts` (the sample-graph file format).
// `@umbel/domain` is being built in parallel (WP-0.4); once it lands, these
// types are deleted and every import points at the domain package instead.
// The prototype called an Expedition a "Graph"; this file uses CONTEXT.md's words.

export type Expedition = {
  id: string;
  title: string;
  summary: string;
  source?: { kind: string; url?: string; dates?: string };
  kinds: KindDef[];
  relationshipTypes: RelationshipTypeDef[];
  attributes?: AttributeDef[];
  concepts: Concept[];
  relationships: Relationship[];
  views: View[];
};

export type KindDef = {
  id: string;
  label: string;
  color: string; // accent colour, from the Expedition's data
  icon?: string; // lucide icon name
};

export type RelationshipTypeDef = {
  id: string;
  label: string; // reads "from <label> to", e.g. "is needed to understand"
  color: string;
  dashed?: boolean;
};

export type AttributeDef = {
  id: string;
  label: string;
  type: "text" | "number" | "money" | "bool" | "enum";
  unit?: string;
  values?: string[];
};

export type Concept = {
  id: string;
  title: string;
  kind: string;
  tags?: string[];
  summary?: string;
  body?: string;
  overview?: string;
  article?: string;
  date?: string; // "YYYY", "YYYY-MM" or "YYYY-MM-DD"
  dateEnd?: string | "ongoing";
  dateApprox?: boolean;
  lane?: string;
  order?: number;
  seq?: number;
  weight?: "core" | "aux"; // curator pin; otherwise computed
  attributes?: Record<string, string | number | boolean>;
  geo?: [number, number];
};

export type Relationship = {
  from: string;
  to: string;
  type: string;
  note?: string;
};

/** A View is a View Type applied to an Expedition, with its settings. */
export type View =
  | ViewOf<"comparison-table", ComparisonTableSettings>
  | ViewOf<"outline", OutlineSettings>
  | ViewOf<"evidence", EvidenceSettings>
  | ViewOf<"cause-and-effect", CauseEffectSettings>
  | ViewOf<"map", MapSettings>
  | ViewOf<"timeline", TimelineSettings>
  | ViewOf<"anatomy", AnatomySettings>
  | ViewOf<"learning-path", LearningPathSettings>
  | ViewOf<"lineage", LineageSettings>
  | ViewOf<"quadrant", QuadrantSettings>
  | ViewOf<"rates", RatesSettings>;

export type ViewTypeId = View["viewType"];

export type ViewOf<T extends string, S> = {
  id: string;
  label: string;
  description?: string;
  viewType: T;
  settings: S;
};

/** The View Types this package draws on the canvas. */
export type CanvasView = Extract<View, { viewType: "evidence" | "cause-and-effect" | "lineage" | "learning-path" }>;
export const canvasViewTypes = ["evidence", "cause-and-effect", "lineage", "learning-path"] as const;
export const isCanvasView = (v: View): v is CanvasView => (canvasViewTypes as readonly string[]).includes(v.viewType);

export type ConceptFilter = { kinds?: string[]; tags?: string[]; hasAttribute?: string };

export type ComparisonTableSettings = {
  rows: ConceptFilter;
  columns: ({ attribute: string } | { concept: string } | { criteria: "auto" })[];
  sortBy?: string;
  standing?: string;
  priority?: string;
};

export type OutlineSettings = {
  relationshipTypes: string[];
  rootTag?: string;
  openDepth?: number;
};

export type EvidenceSettings = {
  supports: string[];
  challenges: string[];
  claimKinds: string[];
  evidenceType?: string; // attribute badge on evidence
  consensus?: string; // attribute badge on claims
};

export type CauseEffectSettings = {
  mode: "mechanism" | "risk";
  positive: string[]; // raises / causes
  negative: string[]; // lowers / blocks / mitigates
  outcomes: string[];
  levers: ConceptFilter; // things you can pull, as opposed to facts of nature
  rankBy?: string; // risk mode: order levers by this attribute
  fold?: string[]; // Relationship Types folded into their target
};

export type MapSettings = {
  kinds?: string[];
  tags?: string[];
  home?: string;
  colorBy?: string;
  relationshipTypes?: string[];
};

export type TimelineSettings = {
  lanes: { id: string; label: string }[];
  focus?: [string, string];
};

export type AnatomySettings = {
  roots: string[];
  containment: string[];
  pins: string[];
  colorBy?: string;
};

export type LearningPathSettings = {
  relationshipTypes: string[]; // A -> B: A is needed to understand B
  targets?: ConceptFilter;
  minSteps?: number;
  coreShared?: number;
};

export type LineageSettings = {
  relationshipTypes: string[]; // older -> newer ("led to")
  tags?: string[];
  groupBy?: string;
};

export type QuadrantSettings = {
  x: string;
  y: string;
  tags?: string[];
  progression?: boolean;
  evidence?: string[];
};

export type RatesSettings = {
  group: string;
  low: string;
  high: string;
  direction: string;
  method?: string;
  sourceRelationship?: string;
  independence?: string;
};
