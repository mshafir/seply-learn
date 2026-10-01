// Learning path View: every path at once. Core Concepts (the targets and the
// foundations they share) are always drawn; the steps between them appear
// when the reader picks something connected. Picking a target focuses its
// prerequisite tree in reading order, and focus is sticky while the
// selection stays inside the tree.
//
// Reading status comes from the app (`covered`: read or known): covered
// Concepts get a check, step counts skip them, and "I know …" marks the
// reader's status (`onMarkKnown`). "Show all steps" and "Hide what I've read"
// are the reader's personal settings when the app passes `personal` and
// `onPersonalChange`. Without them (the harness), all of it is local state.
// While a tree is focused, the View reports "Path to X · k of n read" for the
// app's status chip; clearing it unfocuses.
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Expedition, LearningPathSettings, View } from "../model.ts";
import type { ReaderInteraction } from "../ExpeditionView.tsx";
import { learningMap, learningScope } from "../scope.ts";
import { focusTree, learningPathOverlay, steps as stepsOf } from "../overlay.ts";
import { readingOrder } from "../scope.ts";
import { Canvas, type PositionMemory } from "./Canvas.tsx";
import type { ViewStatusChip } from "../ExpeditionView.tsx";

const noneCovered = new Set<string>();

export type LearningPathCanvasProps = {
  expedition: Expedition;
  view: Extract<View, { viewType: "learning-path" }>;
  selected?: string;
  onSelect: (id?: string) => void;
  matches?: Set<string>;
  transitionMs?: number;
  onSettled?: () => void;
  memory?: PositionMemory;
  personal?: Record<string, unknown>;
  onPersonalChange?: (key: string, value: unknown) => void;
  onStatus?: (status: ViewStatusChip | null) => void;
  /** Pixels the app covers at the top; the toolbar floats just below them. */
  overlayTop?: number;
} & ReaderInteraction;

/** Every step on the path to `focus`, known ones included, in reading order. */
function readingOrderOf(tree: NonNullable<ReturnType<typeof focusTree>>, focus: string) {
  return readingOrder(tree).filter((id) => id !== focus);
}

export function LearningPathCanvas({
  expedition,
  view,
  selected,
  onSelect,
  matches,
  transitionMs,
  onSettled,
  memory,
  covered,
  personal,
  onPersonalChange,
  onMarkKnown,
  onStatus,
  overlayTop,
}: LearningPathCanvasProps) {
  const s: LearningPathSettings = view.settings;
  const map = useMemo(() => learningMap(expedition, s), [expedition, s]);
  const { scope, targets, core } = map;
  const inScope = (id?: string) => !!id && scope.concepts.some((c) => c.id === id);
  const byId = useMemo(() => new Map(expedition.concepts.map((c) => [c.id, c])), [expedition]);

  const [localKnown, setKnown] = useState<Set<string>>(new Set());
  const [localShowAll, setLocalShowAll] = useState(false);
  // The reader's Reading status and personal settings, when the app has them.
  const readingStatus = covered !== undefined;
  const coveredSet = covered ?? noneCovered;
  const known = useMemo(() => (readingStatus ? new Set(coveredSet) : localKnown), [readingStatus, coveredSet, localKnown]);
  const showAll = onPersonalChange ? personal?.showAllSteps === true : localShowAll;
  const hideKnown = personal?.hideRead === true;
  const toggleShowAll = (on: boolean) => (onPersonalChange ? onPersonalChange("showAllSteps", on) : setLocalShowAll(on));
  const markKnown = (id: string) => (onMarkKnown ? onMarkKnown(id) : setKnown(new Set(localKnown).add(id)));
  // Step counts per target skip what the reader has covered.
  const targetSteps = useMemo(() => {
    if (!known.size) return undefined;
    const out = new Map<string, number>();
    for (const id of targets.keys()) {
      const tree = learningScope(expedition, s.relationshipTypes, id, known);
      out.set(id, tree.concepts.filter((c) => c.id !== id && !known.has(c.id)).length);
    }
    return out;
  }, [expedition, s, targets, known]);
  const [focus, setFocus] = useState<string | undefined>(inScope(selected) ? selected : undefined);
  const [lastSelected, setLastSelected] = useState(selected);

  // Opening a step of the focused tree (to read it) keeps the focus; picking
  // anything else refocuses on it. (Adjusting state during render, not in an effect.)
  if (selected !== lastSelected) {
    setLastSelected(selected);
    if (!inScope(selected)) setFocus(undefined);
    else if (!(focus && focusTree(expedition, s, focus, known)?.concepts.some((c) => c.id === selected))) setFocus(selected);
  } else if (focus && !inScope(focus)) {
    // The focused Concept left the path (deleted, or its prerequisites
    // removed, perhaps in another tab): unfocus rather than draw an empty tree.
    setFocus(undefined);
  }

  const tree = useMemo(() => focusTree(expedition, s, focus, known), [expedition, s, focus, known]);
  const treeIds = useMemo(() => new Set(tree?.concepts.map((c) => c.id)), [tree]);
  const steps = tree && focus ? stepsOf(tree, focus, known) : [];
  const unlocks = focus ? scope.relationships.filter((r) => r.from === focus).map((r) => r.to) : [];
  const overlay = useMemo(
    () => learningPathOverlay(map, tree, { selected, focus, known, showAll, matches, readingStatus, hideKnown, targetSteps }),
    [map, tree, selected, focus, known, showAll, matches, readingStatus, hideKnown, targetSteps],
  );
  // The status chip: the focused path and how much of it the reader has covered.
  const pathIds = tree && focus ? readingOrderOf(tree, focus) : [];
  const pathRead = pathIds.filter((id) => known.has(id)).length;
  const statusText = focus
    ? `Path to ${byId.get(focus)?.title ?? "…"} · ${pathRead} of ${pathIds.length} read`
    : null;
  const report = useEffectEvent((text: string | null) =>
    onStatus?.(text ? { text, clear: () => setFocus(undefined) } : null),
  );
  useEffect(() => report(statusText), [statusText]);
  useEffect(() => () => report(null), []);

  const canMark = !!selected && selected !== focus && treeIds.has(selected) && !known.has(selected);
  const hiddenCount = scope.concepts.length - core.size;

  // Floating under the app's controls, the toolbar covers the canvas too:
  // the canvas fits its Concepts below both.
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el || !overlayTop) return;
    const update = () => setToolbarHeight(el.offsetHeight + 8);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [overlayTop]);

  return (
    <div
      className={overlayTop ? "seply-lp seply-lp--overlay" : "seply-lp"}
      style={overlayTop ? ({ "--seply-overlay-top": `${overlayTop}px` } as CSSProperties) : undefined}
    >
      <div className="seply-toolbar" ref={toolbarRef}>
        {focus ? (
          <>
            <span>
              To understand <b>{byId.get(focus)?.title}</b>: {steps.length ? `${steps.length} steps first` : "nothing else first"}
            </span>
            <button disabled={!canMark} onClick={() => selected && markKnown(selected)}>
              I know {canMark ? `"${byId.get(selected!)?.title}"` : "the selected step"}
            </button>
            {selected && selected !== focus && treeIds.has(selected) && (
              <button className="seply-toolbar__accent" onClick={() => setFocus(selected)}>
                Focus on "{byId.get(selected)?.title}"
              </button>
            )}
            {unlocks.length > 0 && (
              <span className="seply-toolbar__chips">
                Leads to:
                {unlocks.map((id) => (
                  <button key={id} className="seply-chip" onClick={() => onSelect(id)}>
                    {byId.get(id)?.title}
                  </button>
                ))}
              </span>
            )}
          </>
        ) : (
          <span className="seply-toolbar__muted">
            {targets.size} techniques and the foundations they share. Click one to see what it takes, in order.
          </span>
        )}
        {!readingStatus && known.size > 0 && (
          <span className="seply-toolbar__chips">
            Known:
            {[...known].map((id) => (
              <button
                key={id}
                title="Forget"
                className="seply-chip seply-chip--known"
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
        <label className="seply-toolbar__toggle">
          <input type="checkbox" checked={showAll} onChange={(e) => toggleShowAll(e.target.checked)} />
          Show all steps ({hiddenCount} more)
        </label>
      </div>
      <div className="seply-lp__canvas">
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
          memory={memory}
          covered={covered}
          overlayTop={overlayTop ? overlayTop + toolbarHeight : undefined}
        />
      </div>
    </div>
  );
}
