// Frame-driven motion: every move is a pure function of the frame, so any
// frame renders the same on its own (Remotion renders frames in parallel).
import { Easing, interpolate } from "remotion";
import { FPS } from "./timing.ts";

/** The app's ease: quick out, gentle in (moves are 300-500 ms). */
export const ease = Easing.bezier(0.2, 0, 0, 1);

/** 0 → 1 over `dur` seconds from `start` seconds, eased. */
export function tween(frame: number, start: number, dur = 0.4): number {
  return interpolate(frame / FPS, [start, start + dur], [0, 1], {
    easing: ease,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/** In over `dur` from `start`, out over `dur` ending at `end`. */
export function inOut(frame: number, start: number, end: number, dur = 0.35): number {
  return Math.min(tween(frame, start, dur), 1 - tween(frame, end - dur, dur));
}

export const mix = (a: number, b: number, k: number) => a + (b - a) * k;

export type XY = { x: number; y: number };

/** A point moving through keyframes `[seconds, x, y]`, eased between each pair. */
export function path(frame: number, keys: [number, number, number][]): XY {
  const t = frame / FPS;
  if (t <= keys[0][0]) return { x: keys[0][1], y: keys[0][2] };
  for (let i = 1; i < keys.length; i++) {
    const [t0, x0, y0] = keys[i - 1];
    const [t1, x1, y1] = keys[i];
    if (t <= t1) {
      const k = ease((t - t0) / (t1 - t0));
      return { x: mix(x0, x1, k), y: mix(y0, y1, k) };
    }
  }
  const last = keys[keys.length - 1];
  return { x: last[1], y: last[2] };
}
