import { useEffect, useMemo, useState } from "react";
import type { Graph, LearningPathSettings, View } from "../lib/types";
import { learningMap, learningScope, readingOrder } from "../lib/view";
import { Canvas, type Badge, type Overlay } from "./Canvas";

// Learning path View Type: every path at once. Core topics (the techniques and
// the foundations they share) are always drawn; the steps between them appear
// when the reader picks something connected. Picking a topic focuses its
// prerequisite tree in reading order; reading along that tree keeps the focus.
export function LearningPath({
  graph,
  view,
  settings: s,
  selected,
  onSelect,
  matches,
}: {
  graph: Graph;
  view: View;
  settings: LearningPathSettings;
  selected?: string;
  onSelect: (id?: string) => void;
  matches?: Set<string>;
}) {
  const map = useMemo(() => learningMap(graph, s), [graph, s]);
  const { scope, targets, core } = map;
  const inScope = (id?: string) => !!id && scope.concepts.some((c) => c.id === id);
  const byId = new Map(graph.concepts.map((c) => [c.id, c]));

  const [known, setKnown] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [focus, setFocus] = useState<string | undefined>(inScope(selected) ? selected : undefined);
  const tree = useMemo(
    () => (focus ? learningScope(graph, s.relationshipTypes, focus, known) : undefined),
    [graph, s, focus, known],
  );

  // Opening a step of the focused tree (to read it) keeps the focus; picking
  // anything else refocuses on it.
  useEffect(() => {
    if (!inScope(selected)) setFocus(undefined);
    else setFocus((f) => (f && learningScope(graph, s.relationshipTypes, f, known).concepts.some((c) => c.id === selected) ? f : selected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const treeIds = useMemo(() => new Set(tree?.concepts.map((c) => c.id)), [tree]);
  const steps = useMemo(() => (tree ? readingOrder(tree).filter((id) => id !== focus && !known.has(id)) : []), [tree, focus, known]);
  const unlocks = focus ? scope.relationships.filter((r) => r.from === focus).map((r) => r.to) : [];

  const overlay: Overlay = useMemo(() => {
    const around = (id?: string) =>
      id ? scope.relationships.filter((r) => r.from === id || r.to === id).flatMap((r) => [r.from, r.to]) : [];
    const visible = new Set([...core, ...treeIds, ...around(selected), ...around(focus), ...known]);
    if (matches) for (const id of matches) visible.add(id);
    const hidden = new Set(showAll ? [] : scope.concepts.map((c) => c.id).filter((id) => !visible.has(id)));

    // Bridges: a dashed edge across each chain of hidden steps, so the core
    // stays connected while the steps between are folded away.
    const bridges: Overlay["bridges"] = [];
    const direct = new Set(scope.relationships.map((r) => `${r.from}>${r.to}`));
    for (const v of visible) {
      if (hidden.has(v)) continue;
      const seen = new Set<string>();
      const walk = (at: string, hops: number) => {
        for (const r of scope.relationships) {
          if (r.from !== at || seen.has(r.to)) continue;
          seen.add(r.to);
          if (hidden.has(r.to)) walk(r.to, hops + 1);
          else if (hops > 0 && !direct.has(`${v}>${r.to}`) && !bridges.some((b) => b.from === v && b.to === r.to))
            bridges.push({ from: v, to: r.to, hops });
        }
      };
      walk(v, 0);
    }

    const badges = new Map<string, Badge[]>();
    const add = (id: string, b: Badge) => badges.set(id, [...(badges.get(id) ?? []), b]);
    if (focus) {
      add(focus, { text: "goal", tone: "indigo" });
      steps.forEach((id, i) => add(id, { text: `step ${i + 1}`, tone: "slate" }));
    } else {
      for (const [id, n] of targets) add(id, { text: `${n} steps`, tone: "slate" });
    }
    for (const id of known) add(id, { text: "known", tone: "green" });

    return { hidden, lit: focus ? treeIds : undefined, badges, bridges, fit: focus ? [...treeIds] : undefined };
  }, [scope, core, targets, treeIds, selected, focus, known, steps, matches, showAll]);

  const canMark = selected && selected !== focus && treeIds.has(selected) && !known.has(selected);
  const hiddenCount = scope.concepts.length - core.size;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-stone-200 bg-white px-4 py-1.5 text-sm">
        {focus ? (
          <>
            <span className="text-stone-600">
              To understand <b className="text-stone-900">{byId.get(focus)?.title}</b>:{" "}
              {steps.length ? `${steps.length} steps first` : "nothing else first"}
            </span>
            <button
              disabled={!canMark}
              onClick={() => selected && setKnown(new Set(known).add(selected))}
              className="rounded border border-stone-200 px-2 py-0.5 text-xs enabled:hover:bg-stone-100 disabled:opacity-40"
            >
              I know {canMark ? `"${byId.get(selected!)?.title}"` : "the selected step"}
            </button>
            {selected && selected !== focus && treeIds.has(selected) && (
              <button
                onClick={() => setFocus(selected)}
                className="rounded border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs text-indigo-800 hover:bg-indigo-100"
              >
                Focus on "{byId.get(selected)?.title}"
              </button>
            )}
            {unlocks.length > 0 && (
              <span className="flex flex-wrap items-center gap-1 text-xs text-stone-500">
                Leads to:
                {unlocks.map((id) => (
                  <button
                    key={id}
                    onClick={() => onSelect(id)}
                    className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-700 hover:bg-stone-200"
                  >
                    {byId.get(id)?.title}
                  </button>
                ))}
              </span>
            )}
          </>
        ) : (
          <span className="text-stone-500">
            {targets.size} techniques and the foundations they share. Click one to see what it takes, in order.
          </span>
        )}
        {known.size > 0 && (
          <span className="flex flex-wrap items-center gap-1 text-xs text-stone-500">
            Known:
            {[...known].map((id) => (
              <button
                key={id}
                title="Forget"
                onClick={() => {
                  const n = new Set(known);
                  n.delete(id);
                  setKnown(n);
                }}
                className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800 ring-1 ring-emerald-200 hover:line-through"
              >
                {byId.get(id)?.title}
              </button>
            ))}
          </span>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-stone-500">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show all steps ({hiddenCount} more)
        </label>
      </div>
      <div className="min-h-0 flex-1">
        <Canvas graph={graph} view={view} scope={scope} selected={selected} onSelect={onSelect} matches={matches} overlay={overlay} />
      </div>
    </div>
  );
}
