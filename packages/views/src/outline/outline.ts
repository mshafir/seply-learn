// The Outline View's tree (docs/view-types/outline.md), as a pure function.
//
// Shared `part-of` Relationships (the View's `relationshipTypes`, read
// child → parent) are the default structure; the View's own overrides
// (spec §1.6, ticket 24) replace them in this View only:
// - `placement`: this View's parent for a Concept (it wins over the Relationship)
// - `order`: sibling order under a parent (listed ids first, the rest after)
// - `hide`: left out by the curator; its children move up to its parent
// - `fold`: Concepts folded into another, drawn inside its line, not as lines
//
// Reading status: counts skip covered Concepts, and `hideRead` leaves them
// out (their unread children move up), never the one to keep (the selection).
import type { ViewOverrides } from "@seply/domain";
import type { Concept, Expedition, OutlineSettings } from "../model.ts";

export type OutlineViewSettings = OutlineSettings & ViewOverrides;

export type OutlineItem = {
  concept: Concept;
  children: OutlineItem[];
  /** Concepts folded into this one (`fold`): drawn inside its line. */
  folded: Concept[];
  /** Lines under it, at any depth. */
  descendants: number;
  /** Lines under it that the reader hasn't covered. */
  unread: number;
};

export type OutlineModel = {
  /** The topics: `rootTag` holders, or every Concept with no parent. */
  roots: OutlineItem[];
  /** Concepts no root reaches (with what hangs under them): a curator's to-do list. */
  unsorted: OutlineItem[];
  /** Each drawn Concept's line: its parent line (`UNSORTED` for the unsorted tops; none for roots). Folded Concepts map to their host. */
  parentOf: Map<string, string>;
};

/** The parent of the unsorted Concepts' group, in `parentOf`. */
export const UNSORTED = "__unsorted";

export type OutlineOptions = {
  /** The reader's read or known Concepts. */
  covered?: ReadonlySet<string>;
  /** Leave covered Concepts out (the personal "Hide what I've read"). */
  hideRead?: boolean;
  /** Never hidden by `hideRead` (the selected Concept). */
  keep?: string;
};

export function outlineTree(expedition: Expedition, settings: OutlineViewSettings, opts: OutlineOptions = {}): OutlineModel {
  const hidden = new Set(settings.hide ?? []);
  const byId = new Map(expedition.concepts.map((c) => [c.id, c]));
  const index = new Map(expedition.concepts.map((c, i) => [c.id, i]));
  const live = (id: string | undefined): id is string => !!id && byId.has(id) && !hidden.has(id);

  // Folds: each folded Concept belongs to one host (the first that lists it).
  const hostOf = new Map<string, string>();
  for (const [host, ids] of Object.entries(settings.fold ?? {})) {
    if (!live(host)) continue;
    for (const id of ids) if (live(id) && id !== host && !hostOf.has(id) && !hostOf.has(host)) hostOf.set(id, host);
  }

  // The parent as this View sees it: the placement override, else the first
  // hierarchy Relationship (one primary parent).
  const types = new Set(settings.relationshipTypes);
  const relParent = new Map<string, string>();
  for (const r of expedition.relationships) if (types.has(r.type) && !relParent.has(r.from) && r.from !== r.to) relParent.set(r.from, r.to);
  const placed = (id: string) => {
    const p = settings.placement?.[id];
    return p && p !== id && byId.has(p) ? p : undefined;
  };
  const rawParent = (id: string) => placed(id) ?? relParent.get(id);
  /** The nearest live parent: a hidden one passes its children up; a folded one passes them to its host. */
  const parentOf = (id: string) => {
    const seen = new Set([id]);
    let p = rawParent(id);
    while (p && byId.has(p) && hidden.has(p) && !seen.has(p)) {
      seen.add(p);
      p = rawParent(p);
    }
    if (!live(p)) return undefined;
    return hostOf.get(p) ?? p;
  };

  const lines = expedition.concepts.filter((c) => live(c.id) && !hostOf.has(c.id));
  const isRoot = (c: Concept) =>
    settings.rootTag ? !!c.tags?.includes(settings.rootTag) && !placed(c.id) : parentOf(c.id) === undefined;
  const roots = lines.filter(isRoot);
  const rootIds = new Set(roots.map((c) => c.id));

  const children = new Map<string, Concept[]>();
  for (const c of lines) {
    if (rootIds.has(c.id)) continue;
    const p = parentOf(c.id);
    if (p === undefined || p === c.id) continue;
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(c);
  }
  const ordered = (parent: string, list: Concept[]) => {
    const rank = new Map((settings.order?.[parent] ?? []).map((id, i) => [id, i]));
    return [...list].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || index.get(a.id)! - index.get(b.id)!);
  };
  const folded = new Map<string, Concept[]>();
  for (const [id, host] of hostOf) {
    if (!folded.has(host)) folded.set(host, []);
    folded.get(host)!.push(byId.get(id)!);
  }
  for (const [host, list] of folded) folded.set(host, ordered(host, list));

  // Build from the roots, then whatever they don't reach (un-homed Concepts,
  // and any cycle), so every live Concept is drawn once.
  const reached = new Set<string>();
  const build = (c: Concept): OutlineItem => {
    reached.add(c.id);
    const kids = ordered(c.id, children.get(c.id) ?? []).filter((k) => !reached.has(k.id));
    kids.forEach((k) => reached.add(k.id));
    return { concept: c, children: kids.map(build), folded: folded.get(c.id) ?? [], descendants: 0, unread: 0 };
  };
  const rootItems = roots.map(build);
  const unsortedItems: OutlineItem[] = [];
  const unhomed = lines.filter((c) => !reached.has(c.id));
  // Tops first (no parent), then anything left, which is in a cycle.
  for (const c of [...unhomed.filter((c) => parentOf(c.id) === undefined), ...unhomed])
    if (!reached.has(c.id)) unsortedItems.push(build(c));

  // Reading status: hide covered lines (their children move up), then count.
  const { covered, hideRead, keep } = opts;
  const prune = (item: OutlineItem): OutlineItem[] => {
    const kids = item.children.flatMap(prune);
    if (hideRead && covered?.has(item.concept.id) && item.concept.id !== keep) return kids;
    const f = hideRead && covered ? item.folded.filter((c) => !covered.has(c.id) || c.id === keep) : item.folded;
    return [{ ...item, children: kids, folded: f }];
  };
  const count = (item: OutlineItem) => {
    for (const k of item.children) {
      count(k);
      item.descendants += 1 + k.descendants;
      item.unread += (covered?.has(k.concept.id) ? 0 : 1) + k.unread;
    }
  };
  const finish = (items: OutlineItem[]) => {
    const out = items.flatMap(prune);
    out.forEach(count);
    return out;
  };
  const model: OutlineModel = { roots: finish(rootItems), unsorted: finish(unsortedItems), parentOf: new Map() };

  const link = (item: OutlineItem, parent?: string) => {
    if (parent) model.parentOf.set(item.concept.id, parent);
    for (const f of item.folded) model.parentOf.set(f.id, item.concept.id);
    for (const k of item.children) link(k, item.concept.id);
  };
  model.roots.forEach((r) => link(r));
  model.unsorted.forEach((r) => link(r, UNSORTED));
  return model;
}

/** The lines open by default: `openDepth` levels (default 1: the topics show their Concepts). */
export function defaultOpen(model: OutlineModel, openDepth = 1): Set<string> {
  const out = new Set<string>();
  const walk = (items: OutlineItem[], depth: number) => {
    if (depth >= openDepth) return;
    for (const item of items) {
      out.add(item.concept.id);
      walk(item.children, depth + 1);
    }
  };
  walk(model.roots, 0);
  return out;
}

/** Every line above these Concepts (the path search opens to each match). */
export function ancestorsOf(model: OutlineModel, ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) for (let p = model.parentOf.get(id); p && !out.has(p); p = model.parentOf.get(p)) out.add(p);
  return out;
}
