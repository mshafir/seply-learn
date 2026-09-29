// Anatomy View: the subject as nested boxes (parts inside parts), with the
// Concepts that change each part pinned on as chips, coloured by one
// Attribute (docs/view-types/anatomy.md). Not a canvas: nested HTML boxes,
// laid out by the browser, so nothing is positioned or stored. Every colour
// is a --umbel-* token (anatomy.css).
//
// Plain elements, not shadcn components: this package may not import
// @umbel/ui (dependency rule). See packages/ui/DIVERGENCES.md #2.
import { useMemo, type MouseEvent } from "react";
import type { Concept, Expedition, KindDef, View } from "../model.ts";
import { anatomy, litParts, type AnatomyModel, type AnatomyPart } from "./anatomy.ts";
import { KindIcon } from "../canvas/KindIcon.tsx";
import { paletteColor } from "../canvas/color.ts";
import { cx, ReadCheck } from "../canvas/parts.tsx";

export type AnatomyProps = {
  expedition: Expedition;
  view: Extract<View, { viewType: "anatomy" }>;
  selected?: string;
  onSelect: (id?: string) => void;
  /** Search matches: other pins dim, and a box dims unless it, a pin on it or a part inside it matches. */
  matches?: Set<string>;
  /** Concepts the reader has read or knows: a check on the box or pin. */
  covered?: ReadonlySet<string>;
};

/** Pin colours: the legend's values, least to most, on a four-step ramp (anatomy.css `--umbel-pin-*`). */
const RAMP = 4;
const toneClass = (i: number | undefined, n: number) =>
  i === undefined ? "umbel-pin--none" : `umbel-pin--${n <= RAMP ? i : Math.min(RAMP - 1, Math.floor((i * RAMP) / n))}`;

/** What every box and pin in one Anatomy reads. */
type Ctx = Omit<AnatomyProps, "expedition" | "view"> & {
  model: AnatomyModel;
  kinds: Map<string, KindDef>;
  lit?: Set<string>;
  n: number;
};

export function Anatomy({ expedition, view, selected, onSelect, matches, covered }: AnatomyProps) {
  const model = useMemo(() => anatomy(expedition, view.settings), [expedition, view.settings]);
  const kinds = useMemo(() => new Map(expedition.kinds.map((k) => [k.id, k])), [expedition]);
  const lit = useMemo(() => (matches ? litParts(model.roots, matches) : undefined), [model, matches]);
  const n = model.legend?.values.length ?? 0;
  const ctx: Ctx = { model, kinds, lit, n, selected, onSelect, matches, covered };

  return (
    <div className="umbel-anatomy" data-view-type="anatomy" onClick={() => onSelect(undefined)}>
      <Legend model={model} n={n} />
      {model.roots.length ? (
        <div className="umbel-anatomy__roots">
          {model.roots.map((p) => (
            <Part key={p.concept.id} p={p} ctx={ctx} />
          ))}
        </div>
      ) : (
        <div className="umbel-view-empty">{view.label}: none of its roots are in this Expedition.</div>
      )}
      {model.unplaced.length > 0 && (
        <div className="umbel-anatomy__unplaced">
          <span>Not on a part yet:</span>
          {model.unplaced.map((c) => (
            <Pin key={c.id} c={c} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}

const pick = (ctx: Ctx, id: string) => (e: MouseEvent) => {
  e.stopPropagation();
  ctx.onSelect(id);
};

function Pin({ c, ctx }: { c: Concept; ctx: Ctx }) {
  const { model, n, selected, matches, covered } = ctx;
  return (
    <button
      type="button"
      title={c.summary}
      onClick={pick(ctx, c.id)}
      className={cx(
        "umbel-pin",
        toneClass(model.tone(c), n),
        c.id === selected && "umbel-pin--selected",
        !!matches && !matches.has(c.id) && "umbel-pin--dim",
      )}
      data-concept={c.id}
      data-covered={covered?.has(c.id) || undefined}
    >
      <span className="umbel-pin__dot" aria-hidden />
      {c.title}
      {covered?.has(c.id) && <ReadCheck />}
    </button>
  );
}

function Part({ p, ctx }: { p: AnatomyPart; ctx: Ctx }) {
  const { kinds, lit, selected, covered } = ctx;
  const c = p.concept;
  const kind = kinds.get(c.kind);
  return (
    <div
      onClick={pick(ctx, c.id)}
      className={cx(
        "umbel-part",
        p.depth === 0 && "umbel-part--root",
        p.depth % 2 === 1 && "umbel-part--odd",
        p.parts.length > 0 && "umbel-part--whole",
        c.id === selected && "umbel-part--selected",
        !!lit && !lit.has(c.id) && "umbel-part--dim",
      )}
      data-concept={c.id}
      data-covered={covered?.has(c.id) || undefined}
    >
      <div className="umbel-part__head">
        <button type="button" className="umbel-part__title" onClick={pick(ctx, c.id)}>
          <KindIcon name={kind?.icon ?? kind?.id} className="umbel-part__icon" style={{ color: paletteColor(kind?.color) }} />
          {c.title}
        </button>
        {covered?.has(c.id) && <ReadCheck />}
      </div>
      {c.summary && <div className="umbel-part__summary">{c.summary}</div>}
      {p.pins.length > 0 && (
        <div className="umbel-part__pins">
          {p.pins.map((pin) => (
            <Pin key={pin.id} c={pin} ctx={ctx} />
          ))}
        </div>
      )}
      {p.parts.length > 0 && (
        <div className={cx("umbel-part__parts", p.depth === 0 && "umbel-part__parts--stack")}>
          {p.parts.map((k) => (
            <Part key={k.concept.id} p={k} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  );
}

function Legend({ model, n }: { model: AnatomyModel; n: number }) {
  if (!model.legend) return null;
  return (
    <div className="umbel-anatomy__legend">
      <span>Pinned, coloured by {model.legend.label.toLowerCase()}:</span>
      {model.legend.values.map((v, i) => (
        <span key={v} className={cx("umbel-anatomy__key", toneClass(i, n))}>
          <span className="umbel-pin__dot" aria-hidden />
          {v}
        </span>
      ))}
    </div>
  );
}
