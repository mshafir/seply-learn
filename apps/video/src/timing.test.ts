import { describe, expect, it } from "vitest";
import { CAPTIONS, DURATION, FPS, HERO, SCENES, toWebVtt } from "./timing.ts";

describe("the storyboard clock", () => {
  it("runs the seven scenes back to back over 60 s", () => {
    const scenes = Object.values(SCENES);
    expect(scenes).toHaveLength(7);
    scenes.forEach((sc, i) => i > 0 && expect(sc.from).toBe(scenes[i - 1].from + scenes[i - 1].duration));
    const last = scenes[scenes.length - 1];
    expect(last.from + last.duration).toBe(DURATION);
    expect(DURATION / FPS).toBe(60);
  });

  it("cuts a 12 s hero loop from scenes 3 and 4", () => {
    expect(HERO.duration).toBe(12 * FPS);
    expect(HERO.from).toBeGreaterThanOrEqual(SCENES.concepts.from);
    expect(HERO.from + HERO.duration).toBeLessThanOrEqual(SCENES.views.from + SCENES.views.duration);
  });

  it("keeps each caption inside its scene, one per scene but the end card", () => {
    const scenes = Object.values(SCENES).slice(0, 6);
    CAPTIONS.forEach((c, i) => {
      expect(c.start * FPS).toBeGreaterThanOrEqual(scenes[i].from);
      expect(c.end * FPS).toBeLessThanOrEqual(scenes[i].from + scenes[i].duration);
    });
  });

  it("writes WebVTT", () => {
    const vtt = toWebVtt();
    expect(vtt.startsWith("WEBVTT\n\n1\n00:00:00.500 --> 00:00:06.800\nStart with a question")).toBe(true);
    expect(vtt).toContain("00:00:48.200 --> 00:00:54.800\nYou can share an Expedition");
  });
});
