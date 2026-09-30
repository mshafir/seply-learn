import { describe, expect, it } from "vitest";
import { paletteColor } from "../src/canvas/color.ts";

describe("paletteColor", () => {
  it("draws a palette name as its @seply/ui token, so it follows the theme", () => {
    expect(paletteColor("teal")).toBe("var(--kind-teal)");
    expect(paletteColor("brown")).toBe("var(--kind-brown)");
  });

  it("passes anything else through, and nothing stays nothing", () => {
    expect(paletteColor("currentColor")).toBe("currentColor");
    expect(paletteColor(undefined)).toBeUndefined();
  });
});
