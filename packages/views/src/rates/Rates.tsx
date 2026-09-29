// Rates & estimates View: every per-year rate on one log scale, grouped by
// the quantity it measures (docs/view-types/rates.md), built by ratesModel.
// Quantities on the left, each estimate's title and source next to them, and
// the log axis on the right: falls left of 1×, rises right. Ranges are bars,
// points are dots, coloured by how independent the source is. Hovering shows
// the method and source; clicking selects the estimate. Every colour is a
// --umbel-* token (rates.css).
import { useMemo, type CSSProperties } from "react";
import type { View, Expedition } from "../model.ts";
import { cx, ReadCheck } from "../canvas/parts.tsx";
import { ratesModel, rateLabel, type LogAxis, type RateEstimate, type RatesViewSettings } from "./rates.ts";

export type RatesProps = {
  expedition: Expedition;
  view: Extract<View, { viewType: "rates" }>;
  selected?: string;
  onSelect: (id?: string) => void;
  /** Search matches: other estimates are dimmed. */
  matches?: Set<string>;
  /** Concepts the reader has read or knows: a check by the estimate's title. */
  covered?: ReadonlySet<string>;
};

/** A range narrower than this (a share of the axis) is drawn as a dot. */
const POINT = 0.004;
const pct = (f: number) => `${(f * 100).toFixed(3)}%`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
/** The independence tone: a --umbel-rates-<value> token, or the neutral one for any other value. */
const tone = (independence?: string): CSSProperties =>
  ({
    "--umbel-rate-tone": independence ? `var(--umbel-rates-${slug(independence)}, var(--umbel-rates-other))` : "var(--umbel-rates-other)",
  }) as CSSProperties;

export function Rates({ expedition, view, selected, onSelect, matches, covered }: RatesProps) {
  const settings = view.settings as RatesViewSettings;
  const model = useMemo(() => ratesModel(expedition, settings), [expedition, settings]);
  const { axis, groups } = model;
  const one = axis.at(1);

  const row = (e: RateEstimate) => {
    const c = e.concept;
    const [x0, x1] = [axis.at(e.lo), axis.at(e.hi)];
    const tip = [
      c.title,
      `${e.direction === "fall" ? "Falls" : "Rises"} ${span(e)} per year`,
      e.method,
      e.source && `Source: ${e.source.title}${e.independence ? ` (${e.independence})` : ""}`,
    ]
      .filter(Boolean)
      .join("\n");
    return (
      <div
        key={c.id}
        className={cx(
          "umbel-rates__estimate",
          c.id === selected && "umbel-rates__estimate--selected",
          !!matches && !matches.has(c.id) && "umbel-rates__estimate--dim",
        )}
        style={tone(e.independence)}
        data-concept={c.id}
        data-covered={covered?.has(c.id) || undefined}
        title={tip}
        onClick={() => onSelect(c.id)}
      >
        <span className="umbel-rates__label">
          <span className="umbel-rates__title">{c.title}</span>
          {covered?.has(c.id) && <ReadCheck />}
          {e.source && <span className="umbel-rates__source"> · {e.source.title}</span>}
        </span>
        <svg className="umbel-rates__plot" aria-label={`${c.title}: ${e.direction === "fall" ? "falls" : "rises"} ${span(e)} per year`}>
          <Grid axis={axis} />
          <line className="umbel-rates__one" x1={pct(one)} x2={pct(one)} y1="0" y2="100%" />
          {x1 - x0 > POINT ? (
            <rect className="umbel-rates__range" x={pct(x0)} width={pct(x1 - x0)} y="8" height="12" rx="6" />
          ) : (
            <circle className="umbel-rates__point" cx={pct(x0)} cy="14" r="6" />
          )}
        </svg>
      </div>
    );
  };

  return (
    <div className="umbel-rates" data-view-type="rates">
      <div className="umbel-rates__legend">
        <span>Per year, log scale. Left of 1× falls, right of it rises. Colour is how independent the source is:</span>
        {model.independence.map((v) => (
          <span key={v} className="umbel-rates__key" style={tone(v)}>
            <span className="umbel-rates__swatch" aria-hidden /> {v}
          </span>
        ))}
      </div>
      <div className="umbel-rates__table">
        <div className="umbel-rates__axis">
          <span className="umbel-rates__axis-name">Quantity</span>
          <span className="umbel-rates__axis-name">Estimate · source</span>
          <span className="umbel-rates__ticks" aria-hidden>
            {axis.ticks.map((t) => (
              <span key={t.value} className={cx("umbel-rates__tick", t.value === 1 && "umbel-rates__tick--one")} style={{ left: pct(axis.at(t.value)) }}>
                {t.label}
              </span>
            ))}
          </span>
        </div>
        {groups.map((g) => (
          <div key={g.quantity} className="umbel-rates__group">
            <div className="umbel-rates__quantity">{g.quantity}</div>
            <div className="umbel-rates__estimates">{g.estimates.map(row)}</div>
          </div>
        ))}
        {groups.length === 0 && <p className="umbel-rates__note">No estimates in this View yet.</p>}
      </div>
      <p className="umbel-rates__note">Dashed line: no change (1×).</p>
    </div>
  );
}

function Grid({ axis }: { axis: LogAxis }) {
  return (
    <g className="umbel-rates__grid">
      {axis.ticks.map((t) => (
        <line key={t.value} x1={pct(axis.at(t.value))} x2={pct(axis.at(t.value))} y1="0" y2="100%" />
      ))}
    </g>
  );
}

const span = (e: RateEstimate) => {
  const [a, b] = e.direction === "fall" ? [1 / e.hi, 1 / e.lo] : [e.lo, e.hi];
  const f = (v: number) => rateLabel(v).replace("÷", "");
  return a === b ? f(a) : `${f(a).replace("×", "")}–${f(b)}`;
};
