// Comparison Table View: options down the side, what matters across the top
// (docs/view-types/comparison-table.md). Criterion columns are banded
// Must-haves / Nice-to-haves by priority, with a Facts band for Attributes; a
// criterion with no verdict shows "?", and a fail on a must-have tints the
// row. Every colour is a --seply-* token (canvas.css).
//
// A plain <table>, not shadcn's Table: this package may not import @seply/ui
// (dependency rule). The markup follows shadcn's Table structure so the app
// can swap it in; see the README.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Expedition, View } from "../model.ts";
import { comparisonTable, type TableCell } from "../table.ts";
import { KindIcon } from "../canvas/KindIcon.tsx";
import { paletteColor } from "../canvas/color.ts";
import { cx, ReadCheck } from "../canvas/parts.tsx";

export type ComparisonTableProps = {
  expedition: Expedition;
  view: Extract<View, { viewType: "comparison-table" }>;
  selected?: string;
  onSelect: (id?: string) => void;
  /** Search matches: other rows are dimmed, so the grid keeps its shape. */
  matches?: Set<string>;
  /** Concepts the reader has read or knows: a check by the option's name. */
  covered?: ReadonlySet<string>;
};

export function ComparisonTable({ expedition, view, selected, onSelect, matches, covered }: ComparisonTableProps) {
  const model = useMemo(() => comparisonTable(expedition, view.settings), [expedition, view.settings]);
  const kinds = useMemo(() => new Map(expedition.kinds.map((k) => [k.id, k])), [expedition]);
  const relTypes = useMemo(() => new Map(expedition.relationshipTypes.map((t) => [t.id, t])), [expedition]);
  const { columns, bands, rows, dropped } = model;
  const scrollRef = useRef<HTMLDivElement>(null);
  const moreRight = useMoreToTheRight(scrollRef);

  const cell = (c: TableCell) => {
    if (c.kind === "no-fact") return <span className="seply-table__none">—</span>;
    if (c.kind === "fact") return <span className={cx(typeof c.value === "number" && "seply-table__num")}>{c.text}</span>;
    if (c.kind === "unknown")
      return (
        <span className="seply-table__unknown" title="Not researched yet">
          ?
        </span>
      );
    const r = c.relationship;
    const label = relTypes.get(r.type)?.label ?? r.type;
    return (
      <span className={cx("seply-verdict", `seply-verdict--${c.tone}`)} title={r.note ? `${label}: ${r.note}` : label}>
        <span className="seply-verdict__dot" aria-hidden />
        <span className="seply-verdict__text">
          <span className="seply-verdict__label">{label}</span>
          {r.note && <span className="seply-verdict__note"> · {r.note}</span>}
        </span>
      </span>
    );
  };

  return (
    <div className="seply-table-view" data-view-type="comparison-table">
      <div className="seply-table__frame" data-more-right={moreRight ? "" : undefined}>
        <div className="seply-table__scroll" ref={scrollRef}>
          <table className="seply-table">
            <thead>
              {bands && (
                <tr className="seply-table__bands">
                  <th className="seply-table__corner" />
                  {bands.map((b, i) => (
                    <th key={i} colSpan={b.span} className={cx("seply-band-head", b.band && `seply-band-head--${slug(b.band)}`)}>
                      {b.band && <div className="seply-band-head__label">{b.band}</div>}
                    </th>
                  ))}
                </tr>
              )}
              <tr>
                <th className="seply-table__corner seply-table__head">Option</th>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={cx("seply-table__head", col.kind === "concept" && "seply-table__head--concept")}
                    onClick={col.kind === "concept" ? () => onSelect(col.concept.id) : undefined}
                    data-selected={col.kind === "concept" ? col.concept.id === selected : undefined}
                  >
                    <span className="seply-table__head-label">{col.label}</span>
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
                    data-covered={covered?.has(row.concept.id) || undefined}
                    onClick={() => onSelect(row.concept.id)}
                    data-selected={row.concept.id === selected}
                    className={cx(
                      "seply-table__row",
                      row.standing && `seply-table__row--${row.standing}`,
                      row.failsMustHave && "seply-table__row--fails",
                      row.concept.id === selected && "seply-table__row--selected",
                      !!matches && !matches.has(row.concept.id) && "seply-table__row--dim",
                    )}
                  >
                    <th scope="row" className="seply-table__option">
                      <span className="seply-table__option-inner">
                        <KindIcon name={k?.icon ?? k?.id} className="seply-table__icon" style={{ color: paletteColor(k?.color) }} />
                        <span className="seply-table__title">{row.concept.title}</span>
                        {covered?.has(row.concept.id) && <ReadCheck />}
                        {row.standing === "chosen" && <span className="seply-badge seply-badge--positive">chosen</span>}
                      </span>
                    </th>
                    {row.cells.map((c, i) => (
                      <td
                        key={columns[i].key}
                        className={cx(
                          "seply-table__cell",
                          c.kind === "verdict" && c.tone === "fails" && columns[i].band === "Must-haves" && "seply-table__cell--fails",
                        )}
                      >
                        <span className="seply-table__cell-inner">{cell(c)}</span>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="seply-table__empty">No options match this View's rows yet.</p>}
        </div>
      </div>
      {dropped.length > 0 && (
        <p className="seply-table__dropped">
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
