// Learning path View: every path at once. Core Concepts (the targets and the
// foundations they share) are always drawn; the steps between them appear
// when the reader picks something connected. Picking a target focuses its
// prerequisite tree in reading order, and focus is sticky while the
// selection stays inside the tree.
//
// Reading status is local state here; WP-1.6 wires it to the reader's own
// Reading status and personal settings.
import { useMemo, useState } from "react";
import type { Expedition, LearningPathSettings, View } from "../model.ts";
import { learningMap } from "../scope.ts";
import { focusTree, learningPathOverlay, steps as stepsOf } from "../overlay.ts";
import { Canvas } from "./Canvas.tsx";

export type LearningPathCanvasProps = {
  expedition: Expedition;
  view: Extract<View, { viewType: "learning-path" }>;
  selected?: string;
  onSelect: (id?: string) => void;
  matches?: Set<string>;
  transitionMs?: number;
  onSettled?: () => void;
};

export function LearningPathCanvas({ expedition, view, selected, onSelect, matches, transitionMs, onSettled }: LearningPathCanvasProps) {
  const s: LearningPathSettings = view.settings;
  const map = useMemo(() => learningMap(expedition, s), [expedition, s]);
  const { scope, targets, core } = map;
  const inScope = (id?: string) => !!id && scope.concepts.some((c) => c.id === id);
  const byId = useMemo(() => new Map(expedition.concepts.map((c) => [c.id, c])), [expedition]);

  const [known, setKnown] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [focus, setFocus] = useState<string | undefined>(inScope(selected) ? selected : undefined);
  const [lastSelected, setLastSelected] = useState(selected);

  // Opening a step of the focused tree (to read it) keeps the focus; picking
  // anything else refocuses on it. (Adjusting state during render, not in an effect.)
  if (selected !== lastSelected) {
    setLastSelected(selected);
    if (!inScope(selected)) setFocus(undefined);
    else if (!(focus && focusTree(expedition, s, focus, known)?.concepts.some((c) => c.id === selected))) setFocus(selected);
  }

  const tree = useMemo(() => focusTree(expedition, s, focus, known), [expedition, s, focus, known]);
  const treeIds = useMemo(() => new Set(tree?.concepts.map((c) => c.id)), [tree]);
  const steps = tree && focus ? stepsOf(tree, focus, known) : [];
  const unlocks = focus ? scope.relationships.filter((r) => r.from === focus).map((r) => r.to) : [];
  const overlay = useMemo(
    () => learningPathOverlay(map, tree, { selected, focus, known, showAll, matches }),
    [map, tree, selected, focus, known, showAll, matches],
  );

  const canMark = !!selected && selected !== focus && treeIds.has(selected) && !known.has(selected);
  const hiddenCount = scope.concepts.length - core.size;

  return (
    <div className="umbel-lp">
      <div className="umbel-toolbar">
        {focus ? (
          <>
            <span>
              To understand <b>{byId.get(focus)?.title}</b>: {steps.length ? `${steps.length} steps first` : "nothing else first"}
            </span>
            <button disabled={!canMark} onClick={() => selected && setKnown(new Set(known).add(selected))}>
              I know {canMark ? `"${byId.get(selected!)?.title}"` : "the selected step"}
            </button>
            {selected && selected !== focus && treeIds.has(selected) && (
              <button className="umbel-toolbar__accent" onClick={() => setFocus(selected)}>
                Focus on "{byId.get(selected)?.title}"
              </button>
            )}
            {unlocks.length > 0 && (
              <span className="umbel-toolbar__chips">
                Leads to:
                {unlocks.map((id) => (
                  <button key={id} className="umbel-chip" onClick={() => onSelect(id)}>
                    {byId.get(id)?.title}
                  </button>
                ))}
              </span>
            )}
          </>
        ) : (
          <span className="umbel-toolbar__muted">
            {targets.size} techniques and the foundations they share. Click one to see what it takes, in order.
          </span>
        )}
        {known.size > 0 && (
          <span className="umbel-toolbar__chips">
            Known:
            {[...known].map((id) => (
              <button
                key={id}
                title="Forget"
                className="umbel-chip umbel-chip--known"
                onClick={() => {
                  const n = new Set(known);
                  n.delete(id);
                  setKnown(n);
                }}
              >
                {byId.get(id)?.title}
              </button>
            ))}
          </span>
        )}
        <label className="umbel-toolbar__toggle">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show all steps ({hiddenCount} more)
        </label>
      </div>
      <div className="umbel-lp__canvas">
        <Canvas
          expedition={expedition}
          view={view}
          scope={scope}
          selected={selected}
          onSelect={onSelect}
          matches={matches}
          overlay={overlay}
          transitionMs={transitionMs}
          onSettled={onSettled}
        />
      </div>
    </div>
  );
}
