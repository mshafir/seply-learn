// From live rows to the shape the Views draw. Pure: no React, no collections.
//
// The rows are @umbel/sync's table rows (the @umbel/domain state types, live
// entities only). The layouts, scopes and metrics still read this package's
// own Expedition type (model.ts), so this is the one bridge between them:
// built-in Kinds and Relationship Types are merged with the Expedition's own
// definitions, Views are put in rail order, and a Concept's pins and place
// get their View-side names. Ids are passed through untouched (`builtin:*`
// included), so a View's settings match the data they name.
import {
  BUILTIN_KINDS,
  BUILTIN_REL_TYPES,
  isBuiltinId,
  type AttributeDef as DomainAttributeDef,
  type Concept as DomainConcept,
  type ExpeditionState,
  type KindDefState,
  type RelTypeDefState,
  type Relationship as DomainRelationship,
  type View as DomainView,
} from "@umbel/domain";
import type { AttributeDef, Concept, Expedition, KindDef, Relationship, RelationshipTypeDef, View } from "./model.ts";

/** The rows one Expedition's Views read, from its live collections (or any snapshot of them). */
export type ExpeditionRows = {
  expedition?: ExpeditionState;
  concepts: Iterable<DomainConcept>;
  relationships: Iterable<DomainRelationship>;
  kindDefs?: Iterable<KindDefState>;
  relTypeDefs?: Iterable<RelTypeDefState>;
  attributeDefs?: Iterable<DomainAttributeDef>;
  views?: Iterable<DomainView>;
};

/**
 * The Expedition the Views draw, from its rows. Concepts and Relationships
 * keep the order they are given in (collections iterate by key, and ULIDs
 * sort by creation), so the same rows always give the same layout.
 */
export function expeditionFromRows(rows: ExpeditionRows): Expedition {
  const e = rows.expedition;
  return {
    id: e?.id ?? "",
    title: e?.title ?? "",
    summary: e?.summary ?? "",
    ...(e?.bestViewId ? { bestViewId: e.bestViewId } : {}),
    kinds: kindsOf(rows.kindDefs ?? []),
    relationshipTypes: relTypesOf(rows.relTypeDefs ?? []),
    attributes: [...(rows.attributeDefs ?? [])].map(attributeOf),
    concepts: [...rows.concepts].map(conceptOf),
    relationships: [...rows.relationships].map(relationshipOf),
    views: [...(rows.views ?? [])].sort((a, b) => cmp(a.orderKey, b.orderKey) || cmp(a.id, b.id)).map(viewOf),
  };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Built-ins (with the Expedition's overrides), then its own Kinds. A hidden Kind still draws its Concepts. */
function kindsOf(defs: Iterable<KindDefState>): KindDef[] {
  const own = new Map([...defs].map((d) => [d.id, d]));
  const builtins = BUILTIN_KINDS.map((k): KindDef => {
    const o = own.get(k.id);
    return { id: k.id, label: o?.label ?? k.label, color: o?.color ?? k.color, icon: o?.icon ?? k.icon };
  });
  const custom = [...own.values()]
    .filter((d) => !isBuiltinId(d.id))
    .map((d): KindDef => ({ id: d.id, label: d.label ?? d.id, color: d.color ?? "slate", icon: d.icon }));
  return [...builtins, ...custom];
}

function relTypesOf(defs: Iterable<RelTypeDefState>): RelationshipTypeDef[] {
  const own = new Map([...defs].map((d) => [d.id, d]));
  const builtins = BUILTIN_REL_TYPES.map((t): RelationshipTypeDef => {
    const o = own.get(t.id);
    return { id: t.id, label: o?.label ?? t.label, color: o?.color ?? t.color, dashed: o?.dashed ?? t.dashed };
  });
  const custom = [...own.values()]
    .filter((d) => !isBuiltinId(d.id))
    .map((d): RelationshipTypeDef => ({ id: d.id, label: d.label ?? d.id, color: d.color ?? "slate", dashed: d.dashed }));
  return [...builtins, ...custom];
}

function attributeOf(a: DomainAttributeDef): AttributeDef {
  return { id: a.id, label: a.label, type: a.type, unit: a.unit, values: a.enumValues };
}

function conceptOf(c: DomainConcept): Concept {
  const out: Concept = { id: c.id, title: c.title, kind: c.kind, tags: c.tags, attributes: c.attributes };
  if (c.summary !== undefined) out.summary = c.summary;
  if (c.overview !== undefined) out.overview = c.overview;
  if (c.date !== undefined) out.date = c.date;
  if (c.dateEnd !== undefined) out.dateEnd = c.dateEnd;
  if (c.dateApprox !== undefined) out.dateApprox = c.dateApprox;
  if (c.lane !== undefined) out.lane = c.lane;
  if (c.weightPin) out.weight = c.weightPin;
  if (c.lat !== undefined && c.lon !== undefined) out.geo = [c.lat, c.lon];
  return out;
}

function relationshipOf(r: DomainRelationship): Relationship {
  return r.note !== undefined ? { from: r.from, to: r.to, type: r.type, note: r.note } : { from: r.from, to: r.to, type: r.type };
}

function viewOf(v: DomainView): View {
  // The settings were validated against the View Type's schema when the op
  // was applied; the shapes in model.ts are a subset of them.
  return {
    id: v.id,
    label: v.label,
    viewType: v.viewType,
    ...(v.question ? { description: v.question } : {}),
    settings: v.settings,
  } as View;
}
