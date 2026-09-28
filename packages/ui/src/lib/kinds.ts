/**
 * The 12 named Kind and Relationship Type hues (spec 7.2). Expeditions store
 * the name; the colour is always `var(--kind-<name>)`.
 */
export const KIND_HUES = [
  "blue",
  "teal",
  "green",
  "amber",
  "orange",
  "red",
  "pink",
  "violet",
  "indigo",
  "slate",
  "brown",
  "olive",
] as const

export type KindHue = (typeof KIND_HUES)[number]

export function kindColor(hue: KindHue): string {
  return `var(--kind-${hue})`
}
