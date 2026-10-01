// Outline View: topics, the Concepts under each, and a one-line summary on
// every line (docs/view-types/outline.md). A collapsible tree built by
// outlineTree (the View's part-of Relationships plus its own overrides).
// Clicking a line selects it; the chevron opens it without selecting. Search
// dims other lines and opens the path to every match. Every colour is a
// --seply-* token (outline.css).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import type { Concept, Expedition, KindDef, View } from "../model.ts";
import { KindIcon } from "../canvas/KindIcon.tsx";
import { paletteColor } from "../canvas/color.ts";
import { cx, ReadCheck } from "../canvas/parts.tsx";
import { ancestorsOf, defaultOpen, outlineTree, UNSORTED, type OutlineItem, type OutlineViewSettings } from "./outline.ts";

export type OutlineProps = {
  expedition: Expedition;
  view: Extract<View, { viewType: "outline" }>;
  selected?: string;
  onSelect: (id?: string) => void;
  /** Search matches: other lines are dimmed, and the path to each match opens. */
  matches?: Set<string>;
  /** Concepts the reader has read or knows: a check, and left out of the counts. */
  covered?: ReadonlySet<string>;
  /** The reader's personal settings: `hideRead` leaves covered Concepts out. */
  personal?: Record<string, unknown>;
};

export function Outline({ expedition, view, selected, onSelect, matches, covered, personal }: OutlineProps) {
  const settings = view.settings as OutlineViewSettings;
  const hideRead = personal?.hideRead === true;
  const model = useMemo(
    () => outlineTree(expedition, settings, { covered, hideRead, keep: selected }),
    [expedition, settings, covered, hideRead, selected],
  );
  const kinds = useMemo(() => new Map(expedition.kinds.map((k) => [k.id, k])), [expedition]);
  // Which lines are open is the reader's, for this visit: `openDepth` levels to start.
  const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map());
  const initial = useMemo(() => defaultOpen(model, settings.openDepth), [model, settings.openDepth]);
  const found = useMemo(() => (matches ? ancestorsOf(model, matches) : undefined), [model, matches]);
  const isOpen = (id: string) => found?.has(id) || (toggled.get(id) ?? initial.has(id));
  const toggle = (id: string) => setToggled((cur) => new Map(cur).set(id, !isOpen(id)));
  // A Concept selected elsewhere (the side panel, a link, another View) is
  // revealed: the path to it opens once, and it scrolls into view. Moved
  // under another line (re-parented), it is revealed there again.
  const [revealed, setRevealed] = useState<string>();
  const reveal = selected ? `${selected}@${model.parentOf.get(selected) ?? ""}` : undefined;
  if (reveal !== revealed) {
    setRevealed(reveal);
    const path = selected ? ancestorsOf(model, [selected]) : [];
    if ([...path].some((id) => !isOpen(id))) setToggled((cur) => new Map([...cur, ...[...path].map((id) => [id, true] as const)]));
  }
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    root.current?.querySelector(`[data-concept="${CSS.escape(selected)}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [selected, reveal]);

  const line = (item: OutlineItem, depth: number) => (
    <OutlineLine
      key={item.concept.id}
      item={item}
      depth={depth}
      kind={kinds.get(item.concept.kind)}
      open={isOpen(item.concept.id)}
      selected={selected}
      matches={matches}
      covered={covered}
      onSelect={onSelect}
      onToggle={toggle}
    >
      {isOpen(item.concept.id) && item.children.length > 0 && <ul role="group">{item.children.map((k) => line(k, depth + 1))}</ul>}
    </OutlineLine>
  );

  const unsortedCount = model.unsorted.reduce((n, i) => n + 1 + i.descendants, 0);
  const empty = model.roots.length === 0 && model.unsorted.length === 0;
  return (
    <div className="seply-outline" data-view-type="outline" ref={root}>
      {empty ? (
        <p className="seply-outline__empty">{hideRead ? "You've read everything in this View." : "Nothing in this View yet."}</p>
      ) : (
        <ul className="seply-outline__tree" role="tree" aria-label={view.label}>
          {model.roots.map((r) => line(r, 0))}
          {model.unsorted.length > 0 && (
            <li className="seply-outline__unsorted" role="treeitem" aria-label="Unsorted" aria-expanded={isOpen(UNSORTED)}>
              <div className="seply-outline__line seply-outline__line--topic" onClick={() => toggle(UNSORTED)}>
                <Chevron open={isOpen(UNSORTED)} label="Unsorted" onToggle={() => toggle(UNSORTED)} />
                <span className="seply-outline__text">
                  <span className="seply-outline__title">
                    Unsorted
                    {!isOpen(UNSORTED) && <span className="seply-outline__count">{unsortedCount}</span>}
                  </span>
                  <span className="seply-outline__summary">Concepts no topic reaches yet: a curator's to-do list.</span>
                </span>
              </div>
              {isOpen(UNSORTED) && <ul role="group">{model.unsorted.map((i) => line(i, 1))}</ul>}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

type LineProps = {
  item: OutlineItem;
  depth: number;
  kind?: KindDef;
  open: boolean;
  selected?: string;
  matches?: Set<string>;
  covered?: ReadonlySet<string>;
  onSelect: (id?: string) => void;
  onToggle: (id: string) => void;
  children?: ReactNode;
};

function OutlineLine({ item, depth, kind, open, selected, matches, covered, onSelect, onToggle, children }: LineProps) {
  const { concept: c, folded } = item;
  const hasKids = item.children.length > 0;
  const dim = (id: string) => !!matches && !matches.has(id);
  return (
    <li role="treeitem" aria-label={c.title} aria-expanded={hasKids ? open : undefined} aria-selected={c.id === selected}>
      <div
        className={cx(
          "seply-outline__line",
          depth === 0 && "seply-outline__line--topic",
          c.id === selected && "seply-outline__line--selected",
          dim(c.id) && "seply-outline__line--dim",
        )}
        style={{ paddingLeft: `${depth * 1.5 + 0.5}rem` }}
        data-concept={c.id}
        data-covered={covered?.has(c.id) || undefined}
        onClick={() => onSelect(c.id)}
      >
        <Chevron open={open} label={c.title} hidden={!hasKids} onToggle={() => onToggle(c.id)} />
        <KindIcon name={kind?.icon ?? kind?.id} className="seply-outline__icon" style={{ color: paletteColor(kind?.color) }} />
        <span className="seply-outline__text">
          <span className="seply-outline__title">
            {c.title}
            {covered?.has(c.id) && <ReadCheck />}
            {hasKids && !open && <Count item={item} covered={covered} />}
          </span>
          {c.summary && <span className="seply-outline__summary">{c.summary}</span>}
          {folded.length > 0 && (
            <span className="seply-outline__folded">
              {folded.map((f) => (
                <Folded key={f.id} concept={f} selected={f.id === selected} dim={dim(f.id)} covered={covered?.has(f.id)} onSelect={onSelect} />
              ))}
            </span>
          )}
        </span>
      </div>
      {children}
    </li>
  );
}

/** A closed line's count: the lines inside it the reader hasn't covered. */
function Count({ item, covered }: { item: OutlineItem; covered?: ReadonlySet<string> }) {
  const read = item.descendants - item.unread;
  const title = covered ? `${item.unread} to read, ${read} read` : `${item.descendants} inside`;
  if (covered && item.unread === 0) return <span className="seply-outline__count" title={title}>all read</span>;
  return (
    <span className="seply-outline__count" title={title}>
      {covered ? item.unread : item.descendants}
    </span>
  );
}

function Folded({ concept, selected, dim, covered, onSelect }: { concept: Concept; selected: boolean; dim: boolean; covered?: boolean; onSelect: (id?: string) => void }) {
  return (
    <button
      type="button"
      className={cx("seply-outline__chip", selected && "seply-outline__chip--selected", dim && "seply-outline__line--dim")}
      data-concept={concept.id}
      data-covered={covered || undefined}
      title={concept.summary}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(concept.id);
      }}
    >
      {concept.title}
      {covered && <ReadCheck />}
    </button>
  );
}

function Chevron({ open, label, hidden, onToggle }: { open: boolean; label: string; hidden?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={cx("seply-outline__chevron", hidden && "seply-outline__chevron--none")}
      aria-label={`${open ? "Close" : "Open"} ${label}`}
      tabIndex={hidden ? -1 : undefined}
      disabled={hidden}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <ChevronRightIcon className={cx("seply-outline__chevron-icon", open && "seply-outline__chevron-icon--open")} aria-hidden />
    </button>
  );
}
