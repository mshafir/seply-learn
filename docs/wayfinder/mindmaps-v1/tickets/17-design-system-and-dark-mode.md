---
id: 17
title: Design system, theming and dark mode
labels: [wayfinder:grilling]
status: closed
assignee: claude
blocked_by: [14]
---

## Question

Turn the canvas's visual language into a shadcn (Base UI) theme with light and dark modes, and fix the rules for diverging from prebuilt components. Covers:

- Tokens: the warm neutral palette, the indigo accent, amber for suggested / in progress / from the Source, Kind and Relationship Type colours, and each one's dark counterpart (with contrast checks).
- Type: IBM Plex Sans / Mono and Newsreader for reading text; how fonts are loaded (self-hosted, since the desktop app works offline).
- The divergence list from [shadcn with Base UI, component inventory and dark mode](14-shadcn-base-ui-inventory.md): accept each one or replace it with a prebuilt component, and document every accepted divergence in one place (a `DIVERGENCES.md` in the UI package).
- Dark mode for the canvas, maps, timeline and prose; the theme toggle (system / light / dark) and where it lives.
- Placeholder Umbel Learn branding (wordmark, favicon, app icon).

## Resolution (2026-09-25)

Grilled with the user.

- **Palette (light → dark, warm charcoal).** Contrast was checked with WCAG relative luminance on both the ground and surface colours.

| Token | Light | Dark | Lowest text contrast |
|---|---|---|---|
| ground (`--background`) | #F6F5F1 | #1A1917 | |
| surface (`--card`, `--popover`) | #FFFFFF | #232220 | |
| border | #E4E1DA | #36342F | |
| ink (`--foreground`) | #1D1C1A | #ECE9E3 | 13.1 |
| muted ink | #5F5B54 | #A39E94 | 5.96 |
| accent (`--primary`, links) | #3A45B5 | #8E97F2 | 5.95 |
| suggested (fills, dashes, borders) | #B7791F | #E3B25C | 3.34 light (non-text only, ≥3:1) |
| suggested-text | #8F5C14 | #E3B25C | 5.19 |
| success | #1F6B45 | #6FCF9A | 5.93 |

- **Tokens:** shadcn `:root` / `.dark` pairs in oklch, exposed via `@theme inline`. Added: `--suggested`, `--suggested-text`, `--success`, `--font-reading`, and `--kind-<name>`.
- **Kind and Relationship Type colours:** a fixed palette of 12 named hues (blue, teal, green, amber, orange, red, pink, violet, indigo, slate, brown, olive), each with a contrast-checked light and dark value. Built-ins map to them. Custom Kinds and Relationship Types store the **palette name, never a hex**. *(The `color` field in `kind_defs` / `rel_type_defs` holds this name.)*
- **Type:** IBM Plex Sans (UI), IBM Plex Mono (labels), and **Newsreader** as `--font-reading` for overviews, articles and View questions. All three are self-hosted via **Fontsource** and cached by the PWA service worker for offline reading.
- **Prose:** **shadcn Typeset**, with the font set to `--font-reading`.
- **Theme toggle:** System / Light / Dark in the account menu, default System. An inline script in `index.html` sets `.dark` before first paint, with `color-scheme: light dark`.
- **Theme provider:** exposes `resolvedTheme` for:
  - React Flow `colorMode`
  - MapLibre: `setStyle` swaps OpenFreeMap `positron` ↔ `dark` (or Protomaps `light` ↔ `dark` when self-hosted); pins are HTML Markers, so they survive the swap
  - vis-timeline: a hand-written ~60-line override sheet mapped to our tokens
- **Divergences: all 8 accepted:**
  - Expedition canvas
  - View renderers
  - Thumbnails (fixed SVG per View Type, coloured by tokens)
  - live cursors
  - step indicator
  - file drop zone
  - Attribute list
  - Badge variants (status, provenance)

  Each gets an entry in **`packages/ui/DIVERGENCES.md`** (why, what it is built from, owning package), plus the vis-timeline dark sheet. Everything else uses prebuilt shadcn/Base UI components.
- **Placeholder branding:**
  - Wordmark "Umbel" in Newsreader + "Learn" in IBM Plex Sans.
  - An **umbel glyph** (stalks radiating from one point to small dots), in ink with one indigo dot.
  - Used for the favicon, PWA icons and the header, from one swappable folder, `packages/ui/brand`.
