// Straight-line geometry shared by the layout metrics (metrics.ts) and the
// layouts that tidy their own output (layouts.ts), so a layout clears exactly
// what the metrics would count. Pure: no React, no DOM.
import type { Point, Positions } from "./layouts.ts";

export type Size = { width: number; height: number };
/** A drawn line between two Concepts' centres. */
export type Seg = { a: Point; b: Point; from: string; to: string };

const orient = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));

/** Two lines cross (lines sharing a Concept never count). */
export function segmentsCross(s: Seg, t: Seg) {
  if ([s.from, s.to].some((id) => id === t.from || id === t.to)) return false;
  return orient(s.a, s.b, t.a) !== orient(s.a, s.b, t.b) && orient(t.a, t.b, s.a) !== orient(t.a, t.b, s.b);
}

/** A line runs through the middle of a card (centre `p`) it doesn't belong to. */
export function passesThrough(s: Seg, p: Point, { width, height }: Size) {
  for (let k = 3; k < 18; k++) {
    const x = s.a.x + ((s.b.x - s.a.x) * k) / 20;
    const y = s.a.y + ((s.b.y - s.a.y) * k) / 20;
    if (Math.abs(x - p.x) < width * 0.35 && Math.abs(y - p.y) < height * 0.35) return true;
  }
  return false;
}

/** Two cards, `gap` apart at least, don't touch. */
export const boxesOverlap = (p: Point, a: Size, q: Point, b: Size, gap = 0) =>
  Math.abs(p.x - q.x) < (a.width + b.width) / 2 + gap && Math.abs(p.y - q.y) < (a.height + b.height) / 2 + gap;

/**
 * How badly straight lines drawn at these positions read: each line through
 * a card costs most, then each crossing, and cards closer than `gap` rule the
 * positions out. Lower is better.
 */
export function drawnCost(
  positions: Positions,
  size: (id: string) => Size,
  lines: { from: string; to: string }[],
  gap: number,
): number {
  const ids = [...positions.keys()];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      if (boxesOverlap(positions.get(ids[i])!, size(ids[i]), positions.get(ids[j])!, size(ids[j]), gap)) return Infinity;
  const segs: Seg[] = lines
    .filter((l) => positions.has(l.from) && positions.has(l.to))
    .map((l) => ({ a: positions.get(l.from)!, b: positions.get(l.to)!, from: l.from, to: l.to }));
  let cost = 0;
  for (const s of segs)
    for (const id of ids) if (id !== s.from && id !== s.to && passesThrough(s, positions.get(id)!, size(id))) cost += 3;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) if (segmentsCross(segs[i], segs[j])) cost += 1;
  return cost;
}

/**
 * Nudges Concepts across the flow (along `axis`) until no single nudge makes
 * the drawn lines read better: a line through a card, or a crossing, that the
 * layered layout left because it routes long edges around cards and we draw
 * them straight. Deterministic: Concepts are tried in the order given, and
 * only a strictly better nudge is kept.
 */
export function untangle(
  positions: Positions,
  opts: {
    size: (id: string) => Size;
    lines: { from: string; to: string }[];
    /** Concepts that may move, in the order to try them. */
    movable: string[];
    axis: "x" | "y";
    /** How far one nudge moves a Concept. */
    step: number;
    /** The closest two cards may come. */
    gap: number;
  },
): Positions {
  const { size, lines, movable, axis, step, gap } = opts;
  const pos = new Map(positions);
  let best = drawnCost(pos, size, lines, gap);
  for (let pass = 0; pass < 20 && best > 0; pass++) {
    let improved = false;
    for (const id of movable) {
      const at = pos.get(id);
      if (!at) continue;
      let pick: Point | undefined;
      for (const k of [1, -1, 2, -2, 3, -3]) {
        const to = axis === "x" ? { x: at.x + k * step, y: at.y } : { x: at.x, y: at.y + k * step };
        pos.set(id, to);
        const c = drawnCost(pos, size, lines, gap);
        if (c < best) {
          best = c;
          pick = to;
        }
      }
      pos.set(id, pick ?? at);
      if (pick) improved = true;
    }
    if (!improved) break;
  }
  return pos;
}
