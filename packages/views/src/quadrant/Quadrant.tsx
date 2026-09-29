// Quadrant View: Concepts in a grid by two enum Attributes (docs/view-types/
// quadrant.md), built by quadrantGrid. The axis names sit in the corner and
// the cells are dashed, so empty ones read as gaps. With `progression` the x
// headers are tinted stages with arrows between them (a maturity ladder).
// Hovering a card lists what uses it; clicking selects it. Every colour is a
// --umbel-* token (quadrant.css).
import { useMemo } from "react";
import { ArrowRightIcon } from "lucide-react";
import type { Expedition, View } from "../model.ts";
import { KindIcon } from "../canvas/KindIcon.tsx";
import { paletteColor } from "../canvas/color.ts";
import { cx, ReadCheck } from "../canvas/parts.tsx";
import { quadrantGrid, type QuadrantCard, type QuadrantViewSettings } from "./quadrant.ts";

export type QuadrantProps = {
  expedition: Expedition;
  view: Extract<View, { viewType: "quadrant" }>;
  selected?: string;
  onSelect: (id?: string) => void;
  /** Search matches: other cards are dimmed, so the grid keeps its shape. */
  matches?: Set<string>;
  /** Concepts the reader has read or knows: a check on the card. */
  covered?: ReadonlySet<string>;
};

export function Quadrant({ expedition, view, selected, onSelect, matches, covered }: QuadrantProps) {
  const settings = view.settings as QuadrantViewSettings;
  const model = useMemo(() => quadrantGrid(expedition, settings), [expedition, settings]);
  const kinds = useMemo(() => new Map(expedition.kinds.map((k) => [k.id, k])), [expedition]);
  const { x, y, cells, progression } = model;
  const evidence = (settings.evidence ?? []).length > 0;

  const card = ({ concept: c, usedBy }: QuadrantCard) => {
    const k = kinds.get(c.kind);
    const tip = [c.summary, usedBy.length ? `Used by ${usedBy.join(", ")}` : ""].filter(Boolean).join("\n");
    return (
      <button
        key={c.id}
        type="button"
        title={tip || undefined}
        className={cx(
          "umbel-quadrant__card",
          c.id === selected && "umbel-quadrant__card--selected",
          !!matches && !matches.has(c.id) && "umbel-quadrant__card--dim",
        )}
        data-concept={c.id}
        data-covered={covered?.has(c.id) || undefined}
        aria-pressed={c.id === selected}
        onClick={() => onSelect(c.id)}
      >
        <KindIcon name={k?.icon ?? k?.id} className="umbel-quadrant__icon" style={{ color: paletteColor(k?.color) }} />
        <span className="umbel-quadrant__title">{c.title}</span>
        {covered?.has(c.id) && <ReadCheck />}
        {usedBy.length > 0 && (
          <span className="umbel-quadrant__uses" aria-label={`used by ${usedBy.length}`}>
            {usedBy.length}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className={cx("umbel-quadrant", progression && "umbel-quadrant--ladder")} data-view-type="quadrant">
      <div className="umbel-quadrant__grid" style={{ gridTemplateColumns: `9rem repeat(${x.values.length}, minmax(11rem, 1fr))` }}>
        <div className="umbel-quadrant__corner">
          {y.label} ↓ · {x.label} →
        </div>
        {x.values.map((v, i) => (
          <div key={v.value} className={cx("umbel-quadrant__head", progression && `umbel-quadrant__stage--${i % 4}`)}>
            <span>{v.label}</span>
            <span className="umbel-quadrant__head-count">{v.count}</span>
            {progression && i < x.values.length - 1 && <ArrowRightIcon className="umbel-quadrant__arrow" aria-hidden />}
          </div>
        ))}
        {y.values.map((yv, yi) => (
          <div key={yv.value} className="umbel-quadrant__row">
            <div className="umbel-quadrant__side">{yv.label}</div>
            {x.values.map((xv, xi) => (
              <div key={xv.value} className="umbel-quadrant__cell" data-cell={`${yv.value}/${xv.value}`}>
                {cells[yi]![xi]!.map(card)}
              </div>
            ))}
          </div>
        ))}
      </div>
      {model.placed === 0 && <p className="umbel-quadrant__note">No Concepts in this View have both {x.label} and {y.label} yet.</p>}
      {evidence && model.placed > 0 && (
        <p className="umbel-quadrant__note">
          <span className="umbel-quadrant__uses">n</span> = how many Concepts in this Expedition use it.
        </p>
      )}
    </div>
  );
}
