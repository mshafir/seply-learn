# 7. Design system

Decided in:
- [shadcn with Base UI, component inventory and dark mode](../../wayfinder/mindmaps-v1/tickets/14-shadcn-base-ui-inventory.md) ([findings](../../wayfinder/mindmaps-v1/research/shadcn-base-ui.md))
- [Design system, theming and dark mode](../../wayfinder/mindmaps-v1/tickets/17-design-system-and-dark-mode.md)
- [Map basemap](../../wayfinder/mindmaps-v1/tickets/21-map-basemap-for-hosted-and-self-hosted.md)

## 7.1 Components

- **shadcn with Base UI** (`@base-ui/react` 1.8+, shadcn CLI 4.21+), scaffolded by `shadcn init -t vite --monorepo` into `apps/web` + `packages/ui`. Tailwind v4 is configured in CSS.
- **Prebuilt wherever possible.** Base UI has no Sonner, so notifications use its **Toast**. Radix's `asChild` becomes `render`. Set `isolation: isolate` on the app root so popups sit above React Flow and MapLibre.
- **The inventory:** 98 UI elements across the canvas screens. 86 are prebuilt or composed from prebuilt parts (the table is in the findings).
- **Divergences:** all **8** are accepted. Each gets an entry in **`packages/ui/DIVERGENCES.md`** (why it exists, what it's built from, which package owns it):
  1. Expedition canvas (React Flow)
  2. View renderers (non-canvas: table bands, outline, anatomy, quadrant, rates, lineage)
  3. Thumbnails: a fixed SVG per View Type, coloured by tokens
  4. Live cursors
  5. Step indicator (Sources → Choose Views → Open)
  6. File drop zone
  7. Attribute list
  8. Badge variants (status, provenance), an extension of Badge

  The **vis-timeline dark override sheet** (about 60 lines) is listed there too.

## 7.2 Tokens and palette

shadcn `:root` / `.dark` pairs in oklch, exposed via `@theme inline`. Our own tokens are `--suggested`, `--suggested-text`, `--success`, `--calyx`, `--sprout`, `--font-reading` and `--kind-<name>`. The dark mode is **warm charcoal**. Every pair was checked for WCAG contrast on both the ground and surface colours:

| Token | Light | Dark | Lowest text contrast |
|---|---|---|---|
| ground (`--background`) | #F6F5F1 | #1A1917 | |
| surface (`--card`, `--popover`) | #FFFFFF | #232220 | |
| border | #E4E1DA | #36342F | |
| ink (`--foreground`) | #1D1C1A | #ECE9E3 | 13.1 |
| muted ink | #5F5B54 | #A39E94 | 5.96 |
| accent (`--primary`, links) | #3A45B5 | #8E97F2 | 5.95 |
| suggested: fills, dashes, borders | #B7791F | #E3B25C | 3.34 light (non-text only, needs ≥ 3:1) |
| suggested-text | #8F5C14 | #E3B25C | 5.19 |
| success | #1F6B45 | #6FCF9A | 5.93 |
| calyx (brand green, the glyph's tile) | #2D5C3F | #8FC7A0 | 7.09 |
| sprout (the glyph's leaves on calyx) | #DFE9D8 | #26352B | 6.18 on calyx (non-text) |

- **Amber** marks suggested, in progress and "from the source". Proposals are drawn **dashed** in `--suggested`.
- **Kind and Relationship Type colours:** a fixed palette of **12 named hues** (blue, teal, green, amber, orange, red, pink, violet, indigo, slate, brown, olive), each with a contrast-checked light and dark value. Expeditions store the **name**, never a hex value.

## 7.3 Type

- **IBM Plex Sans** for the interface and **IBM Plex Mono** for labels.
- **Newsreader** (`--font-reading`) for overviews, articles and View questions.
- All three are self-hosted through **Fontsource** and cached by the service worker.
- **Prose:** shadcn **Typeset**, with the font set to `--font-reading`.

## 7.4 Dark mode

- **Toggle:** System / Light / Dark in the account menu, defaulting to System. An inline script in `index.html` sets `.dark` before first paint, with `color-scheme: light dark`.
- **The ThemeProvider exposes `resolvedTheme`** to the components that can't read tokens:
  - **React Flow:** `colorMode`, with `--xy-*` variables mapped to tokens.
  - **MapLibre:** Protomaps flavours **light ↔ dark** via `setStyle`. Pins are HTML Markers, so they survive the style swap. The map container gets `bg-background`.
  - **vis-timeline:** the override sheet maps its classes to our tokens.
- **Thumbnails and SVGs** use `var(--kind-*)` fills.

## 7.5 Branding

- **Name:** Seply is the umbrella for agent-first, visual, multiplayer tools; each product is **Seply** + a verb: **Seply Learn** (this repo), **Seply Plan**, **Seply Work**. See [ADR 0002](../../adr/0002-rename-to-seply.md).
- **Glyph:** five pale leaves (`--sprout`) in a whorl on a rounded calyx tile (`--calyx`, corner radius 14/64). It is the same for every product; the product name next to it tells them apart. The app icon is the tile full-bleed, since platforms round the corners. It holds at 16px.
- **Wordmark:** the glyph, "Seply" in Newsreader Medium (optical size 72) in ink, then "Learn" in IBM Plex Sans Regular at 0.77× in muted ink.
- **Suite colours:** each product has one accent colour: Learn gentian, Plan heather (#8B3A76 / #E39ACB), Work cedar (#8C4A22 / #E0A176). Only Learn's is a token today (`--primary`); the others become `--primary` in their own apps. None is amber, which stays reserved for suggestions.
- **Tagline:** "Shared perspective for people and agents."
- **Voice:** plain, calm and specific, in sentence case, with no emoji. Say when an agent did something ("Suggested by the agent"). The outdoors theme lives in the names of big objects (Expedition), never in jokes or ornament.
- Used for the favicon, the PWA icons and the header, from one swappable folder: `packages/ui/brand`. `SeplyGlyph` and `Wordmark` in `packages/ui/src/components/brand.tsx` draw the same marks from tokens.
