// The sample-graph file format (candidate export format for the product).
// Vocabulary follows CONTEXT.md: Graph, Concept, Concept Kind, Attribute,
// Relationship, Relationship Type, View, View Type, Weight, Tag.

export type Graph = {
  id: string;
  title: string;
  summary: string;
  source: { kind: "claude-chat" | "doc"; url?: string; dates?: string };
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
  color: string; // hex, used for the node accent
  icon?: string; // lucide icon name
};

export type RelationshipTypeDef = {
  id: string;
  label: string; // reads "from <label> to", e.g. "is a prerequisite for"
  color: string;
  dashed?: boolean;
};

export type AttributeDef = {
  id: string;
  label: string;
  type: "text" | "number" | "money" | "bool" | "enum";
  unit?: string;
  values?: string[]; // enum values, in order
};

export type Concept = {
  id: string;
  title: string;
  kind: string;
  tags?: string[];
  summary?: string; // one line, shown on hover and in lists
  body?: string; // markdown, shown alongside the graph (older seeds; superseded by overview)
  overview?: string; // markdown: one deep paragraph, the first thing the side panel shows
  article?: string; // markdown: a full wiki-style article, opened from the side panel
  // Time. Precision is the string's: "YYYY", "YYYY-MM" or "YYYY-MM-DD".
  date?: string;
  dateEnd?: string | "ongoing"; // makes the date a span
  dateApprox?: boolean; // derived from a relative date ("in ~8 weeks")
  lane?: string; // timeline lane
  order?: number; // conversation turn the Concept entered the chat
  seq?: number; // sibling order in an outline
  weight?: "core" | "aux"; // curator pin; otherwise computed
  attributes?: Record<string, string | number | boolean>;
  geo?: [number, number]; // [lat, lon]
};

export type Relationship = {
  from: string;
  to: string;
  type: string;
  note?: string;
};

// A View is a View Type (docs/view-types/<id>.md) applied to this Graph.
// The View Type is a set of instructions; the settings are how this Graph
// answers them.
export type View =
  | ViewOf<"comparison-table", ComparisonTableSettings>
  | ViewOf<"outline", OutlineSettings>
  | ViewOf<"evidence", EvidenceSettings>
  | ViewOf<"cause-and-effect", CauseEffectSettings>
  | ViewOf<"map", MapSettings>
  | ViewOf<"timeline", TimelineSettings>
  // Experimental View Types (third prototype pass)
  | ViewOf<"anatomy", AnatomySettings>
  | ViewOf<"learning-path", LearningPathSettings>
  | ViewOf<"lineage", LineageSettings>
  | ViewOf<"quadrant", QuadrantSettings>
  | ViewOf<"rates", RatesSettings>;

export type ViewTypeId = View["viewType"];

type ViewOf<T extends string, S> = {
  id: string;
  label: string;
  description?: string;
  viewType: T;
  settings: S;
};

export type ConceptFilter = { kinds?: string[]; tags?: string[]; hasAttribute?: string };

export type ComparisonTableSettings = {
  rows: ConceptFilter;
  // "criteria: auto" expands to every criterion the rows have a verdict on,
  // minus dropped ones, hard requirements first.
  columns: ({ attribute: string } | { concept: string } | { criteria: "auto" })[];
  sortBy?: string; // attribute, ascending
  standing?: string; // enum attribute: chosen / in-play / ruled-out
  priority?: string; // enum attribute on criteria: hard / nice / dropped
};

export type OutlineSettings = {
  relationshipTypes: string[]; // read child -> parent
  rootTag?: string; // roots are Concepts with this tag
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
  fold?: string[]; // Relationship Types folded into their target (e.g. a lever's build steps)
};

export type MapSettings = {
  kinds?: string[];
  tags?: string[];
  home?: string;
  colorBy?: string; // enum attribute
  relationshipTypes?: string[]; // drawn as lines
};

export type TimelineSettings = {
  lanes: { id: string; label: string }[];
  focus?: [string, string]; // initial window
};

export type AnatomySettings = {
  roots: string[];
  containment: string[]; // child -> parent, drawn as nesting
  pins: string[]; // Concepts pinned onto the part they point at (technique -> part)
  colorBy?: string; // enum attribute colouring the pins
};

export type LearningPathSettings = {
  relationshipTypes: string[]; // A -> B: A is needed to understand B
  targets?: ConceptFilter; // which Concepts count as targets
  minSteps?: number; // ...and only with at least this many prerequisites behind them
  coreShared?: number; // a prerequisite shared by this many targets' paths is core (default: a third of them)
};

export type LineageSettings = {
  relationshipTypes: string[]; // older -> newer ("led to")
  tags?: string[];
  groupBy?: string; // enum attribute giving each band; otherwise connected families
};

export type QuadrantSettings = {
  x: string; // enum attributes; their value order is the axis order
  y: string;
  tags?: string[];
  progression?: boolean; // x is a sequence of stages (research → standard): draw it as a ladder
  evidence?: string[]; // incoming Relationship Types counted on each card (e.g. models that use it)
};

export type RatesSettings = {
  group: string; // attribute naming the quantity estimated
  low: string; // number attributes: multiplier per year
  high: string;
  direction: string; // enum attribute: rise / fall
  method?: string;
  sourceRelationship?: string; // estimate -> source
  independence?: string; // enum attribute on the source
};
