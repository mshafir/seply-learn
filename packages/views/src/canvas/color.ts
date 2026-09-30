// Kind and Relationship Type colours are Expedition data: a palette hue's
// name (spec 7.2), drawn as the @seply/ui token for the current theme.
import { PALETTE, type PaletteColor } from "@seply/domain";

const hues = new Set<string>(PALETTE);

/**
 * The CSS colour for a stored Kind or Relationship Type colour: a palette
 * name becomes `var(--kind-<name>)`, so it follows light and dark. Anything
 * else is passed through unchanged (prototype data may still hold a literal;
 * TODO(M1): only names, once the domain types replace src/model.ts).
 */
export function paletteColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  return hues.has(color) ? `var(--kind-${color as PaletteColor})` : color;
}
