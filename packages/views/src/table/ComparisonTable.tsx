// Comparison Table View: options down the side, what matters across the top
// (docs/view-types/comparison-table.md). Criterion columns are banded
// Must-haves / Nice-to-haves by priority, with a Facts band for Attributes; a
// criterion with no verdict shows "?", and a fail on a must-have tints the
// row. Every colour is a --umbel-* token (canvas.css).
//
// A plain <table>, not shadcn's Table: this package may not import @umbel/ui
// (dependency rule). The markup follows shadcn's Table structure so the app
// can swap it in; see the README.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Expedition, View } from "../model.ts";
import { comparisonTable, type TableCell } from "../table.ts";
import { KindIcon } from "../canvas/KindIcon.tsx";
import { paletteColor } from "../canvas/color.ts";
import { cx } from "../canvas/parts.tsx";

export type ComparisonTableProps = {
  expedition: Expedition;
  view: Extract<View, { viewType: "comparison-table" }>;
  selected?: string;
  onSelect: (id?: string) => void;
  /** Search matches: other rows are dimmed, so the grid keeps its shape. */
  matches?: Set<string>;
};

export function ComparisonTable({ expedition, view, selected, onSelect, matches }: ComparisonTableProps) {
  const model = useMemo(() => comparisonTable(expedition, view.settings), [expedition, view.settings]);
  const kinds = useMemo(() => new Map(expedition.kinds.map((k) => [k.id, k])), [expedition]);
  const relTypes = useMemo(() => new Map(expedition.relationshipTypes.map((t) => [t.id, t])), [expedition]);
  const { columns, bands, rows, dropped } = model;
  const scrollRef = useRef<HTMLDivElement>(null);
  const moreRight = useMoreToTheRight(scrollRef);

  const cell = (c: TableCell) => {
    if (c.kind === "no-fact") return <span className="umbel-table__none">—</span>;
    if (c.kind === "fact") return <span className={cx(typeof c.value === "number" && "umbel-table__num")}>{c.text}</span>;
    if (c.kind === "unknown")
      return (
        <span className="umbel-table__unknown" title="Not researched yet">
          ?
        </span>
      );
    const r = c.relationship;
    const label = relTypes.get(r.type)?.label ?? r.type;
    return (
      <span className={cx("umbel-verdict", `umbel-verdict--${c.tone}`)} title={r.note ? `${label}: ${r.note}` : label}>
        <span className="umbel-verdict__dot" aria-hidden />
        <span className="umbel-verdict__text">
          <span className="umbel-verdict__label">{label}</span>
          {r.note && <span className="umbel-verdict__note"> · {r.note}</span>}
        </span>
      </span>
    );
  };

  return (
    <div className="umbel-table-view" data-view-type="comparison-table">
      <div className="umbel-table__frame" data-more-right={moreRight ? "" : undefined}>
        <div className="umbel-table__scroll" ref={scrollRef}>
          <table className="umbel-table">
            <thead>
              {bands && (
                <tr className="umbel-table__bands">
                  <th className="umbel-table__corner" />
                  {bands.map((b, i) => (
                    <th key={i} colSpan={b.span} className={cx("umbel-band-head", b.band && `umbel-band-head--${slug(b.band)}`)}>
                      {b.band && <div className="umbel-band-head__label">{b.band}</div>}
                    </th>
                  ))}
                </tr>
              )}
              <tr>
                <th className="umbel-table__corner umbel-table__head">Option</th>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cx("umbel-table__head", col.kind === "concept" && "umbel-table__head--concept")}
                    onClick={col.kind === "concept" ? () => onSelect(col.concept.id) : undefined}
                    data-selected={col.kind === "concept" ? col.concept.id === selected : undefined}
                  >
                    <span className="umbel-table__head-label">{col.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const k = kinds.get(row.concept.kind);
                return (
                  <tr
                    key={row.concept.id}
                    data-concept={row.concept.id}
                    onClick={() => onSelect(row.concept.id)}
                    data-selected={row.concept.id === selected}
                    className={cx(
                      "umbel-table__row",
                      row.standing && `umbel-table__row--${row.standing}`,
                      row.failsMustHave && "umbel-table__row--fails",
                      row.concept.id === selected && "umbel-table__row--selected",
                      !!matches && !matches.has(row.concept.id) && "umbel-table__row--dim",
                    )}
                  >
                    <th scope="row" className="umbel-table__option">
                      <span className="umbel-table__option-inner">
                        <KindIcon name={k?.icon ?? k?.id} className="umbel-table__icon" style={{ color: paletteColor(k?.color) }} />
                        <span className="umbel-table__title">{row.concept.title}</span>
                        {row.standing === "chosen" && <span className="umbel-badge umbel-badge--positive">chosen</span>}
                      </span>
                    </th>
                    {row.cells.map((c, i) => (
                      <td
                        key={columns[i].key}
                        className={cx(
                          "umbel-table__cell",
                          c.kind === "verdict" && c.tone === "fails" && columns[i].band === "Must-haves" && "umbel-table__cell--fails",
                        )}
                      >
                        <span className="umbel-table__cell-inner">{cell(c)}</span>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="umbel-table__empty">No options match this View's rows yet.</p>}
        </div>
      </div>
      {dropped.length > 0 && (
        <p className="umbel-table__dropped">
          Dropped along the way, so not shown:{" "}
          {dropped.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ", "}
              <button type="button" onClick={() => onSelect(c.id)}>
                {c.title}
              </button>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * Whether the scroller has columns hidden past its right edge (the frame
 * shades that edge). Re-checked on scroll and when either the scroller or
 * the table resizes.
 */
function useMoreToTheRight(ref: RefObject<HTMLElement | null>) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    check();
    el.addEventListener("scroll", check, { passive: true });
    // Checked on the next frame, not inside the observer's callback, so the
    // re-render never lands in the same resize loop.
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    };
    const ro = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(later);
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", check);
      cancelAnimationFrame(frame);
      ro?.disconnect();
    };
  }, [ref]);
  return more;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "-");
