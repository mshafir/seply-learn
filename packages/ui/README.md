# @seply/ui

**Lane:** D: App & UI

## Contract

shadcn components on Base UI, design tokens (light + warm charcoal dark), fonts, ThemeProvider, brand assets. Prebuilt components first; every divergence is listed in `DIVERGENCES.md`. Spec: docs/spec/v1/07-design-system.md.

| Export | What it is |
|---|---|
| `@seply/ui/globals.css` | Tailwind v4, shadcn tokens, our tokens, fonts, Typeset. Import once, in the app entry. |
| `@seply/ui/components/*` | shadcn (Base UI) components: `alert`, `avatar`, `badge`, `button`, `card`, `combobox` (with `multi-combobox`'s `MultiCombobox` and `SearchCombobox`; the markdown editor's link popover uses `SearchCombobox`), `command` (cmdk, as shadcn's), `dialog`, `dropdown-menu`, `empty`, `input`, `label`, `scroll-area`, `separator`, `sheet`, `sidebar`, `skeleton`, `spinner`, `switch`, `tabs`, `popover`, `progress`, `toast`, `toggle`, `toggle-group`, `tooltip`, plus `step-indicator` (`StepIndicator`, divergence 5), `file-drop-zone` (`FileDropZone`, divergence 6) and `view-type-thumbnail` (`ViewTypeThumbnail` and `THUMBNAIL_VIEW_TYPES`: the fixed illustration of each View Type, divergence 3). Add more with `mise exec -- pnpm dlx shadcn@latest add <name>` from `apps/web` (hooks land in `apps/web/src/hooks`; move them to `src/hooks`, which is where the components import them from). `command`, `dialog`, `label` and `switch` (WP-2.6), and `popover` (WP-3.7), were transcribed from the base-nova registry by hand because the sessions that added them couldn't reach ui.shadcn.com; re-running `shadcn add` over them should leave only formatting differences. |
| `@seply/ui/hooks/use-mobile` | shadcn's `useIsMobile` (below 768 px), used by `sidebar`. Rewritten with `useSyncExternalStore` so it passes the React Compiler lint rule against setState in effects; same behaviour. |
| `@seply/ui/components/theme-provider` | `ThemeProvider` and `useTheme()` → `{ theme, resolvedTheme, setTheme }`. `theme` is `system \| light \| dark` (persisted under `seply-theme`); `resolvedTheme` is what is on screen and follows the OS live. |
| `@seply/ui/components/mode-toggle` | `ModeToggle`: System / Light / Dark (DropdownMenu + Button). |
| `@seply/ui/components/brand` | `Wordmark` and `SeplyGlyph`, drawn with tokens so they follow the theme. |
| `@seply/ui/lib/kinds` | `KIND_HUES` (the 12 names) and `kindColor(name)` → `var(--kind-<name>)`. |
| `@seply/ui/lib/color` | oklch parsing and WCAG contrast, used by the token test. |
| `@seply/ui/brand/*` | The swappable brand folder (below). |
| `@seply/ui/components/markdown-editor` | `MarkdownEditor` (divergence 9): a Plate rich editor that reads and writes **markdown** (GFM: headings, bold, italic, lists, quotes, inline code, code blocks, tables, links). Props: `value`, `onCommit(markdown)` (on blur, only when the text changed), `aria-*`, `placeholder`, `linkAttributes(url)` (extra attributes for a link, e.g. to style in-app links), `linkTargets` (`{ label, href }[]`, offered by name in the link popover) and `linkTargetsNoun`. A change to `value` from elsewhere resets it unless it has focus. Heavy (about 290 kB gzipped): import it lazily. Also exports `markdownEditorPlugins` and `createMarkdownEditor(markdown)`, a headless editor for tests. |
| `@seply/ui/lib/markdown-source` | `deserializeMarkdown(editor, md)` and `serializeMarkdown(editor)`: markdown in and out of a Plate editor, writing every block the person didn't touch back exactly as it was (only new or edited blocks go through Plate's serializer, with `-` bullets, `*` emphasis and fenced code). `MarkdownKit` is the configured Markdown plugin. |

## Tokens

Colours come only from tokens (`bg-background`, `text-suggested-text`, `fill-[var(--kind-teal)]` …), never hex values in components.

- **shadcn tokens** (`--background`, `--card`, `--primary` …) carry the spec's palette, converted from its hex values to oklch. The source hex is in a comment beside each value in `globals.css`. Spec names map as: ground = `--background`, surface = `--card` / `--popover`, ink = `--foreground`, muted ink = `--muted-foreground`, accent = `--primary` (and `--ring`).
- **Our tokens:** `--suggested` (fills, dashes, borders; non-text), `--suggested-text`, `--success`, `--font-reading` (Newsreader), and `--kind-<name>` for the 12 hues. Each has a Tailwind colour (`bg-suggested`, `text-kind-violet` …).
- **Islands:** `.dark` on any element switches its subtree to the dark palette, and `.light` forces the light one inside a dark page. `ThemeProvider` only ever puts `.dark` on `<html>`; `.light` is for islands such as the showcase.
- **Contrast is tested.** `src/styles/tokens.test.ts` parses `globals.css` and asserts, in both themes, on ground and surface: ink, muted ink, accent, suggested-text and success ≥ 4.5:1; `--suggested` and all 12 Kind hues ≥ 3:1.

### Kind hues

Expeditions store the hue's **name**; the colour is always `var(--kind-<name>)`. The hues were chosen in oklch: a fixed hue angle each, with lightness solved so the colour clears a contrast target on the worse of ground and surface, and chroma reduced where it would leave the sRGB gamut.

- **Light:** targeted at ≥ 4.6:1, above the 3:1 the spec asks for fills, so the hues also work as text (the Kind label in a Concept header).
- **Dark:** targeted at ≥ 6:1. The same hues, lighter and slightly less saturated, so they read on warm charcoal without glowing.
- **Brown** is deliberately darker in light mode (and a little dimmer in dark) so it separates from orange and amber by lightness as well as chroma.
- `--chart-1..5` point at blue, teal, amber, violet and red.

Lowest contrast on ground or surface:

| Hue | Light | Ratio | Dark | Ratio |
|---|---|---|---|---|
| blue | `oklch(0.54 0.14 250)` | 4.64 | `oklch(0.702 0.126 250)` | 6.03 |
| teal | `oklch(0.53 0.09 195)` | 4.63 | `oklch(0.692 0.09 195)` | 6.01 |
| green | `oklch(0.526 0.13 150)` | 4.64 | `oklch(0.69 0.117 150)` | 6.02 |
| amber | `oklch(0.546 0.114 75)` | 4.62 | `oklch(0.708 0.117 75)` | 6.03 |
| orange | `oklch(0.554 0.146 50)` | 4.63 | `oklch(0.714 0.135 50)` | 6.00 |
| red | `oklch(0.562 0.17 25)` | 4.61 | `oklch(0.722 0.153 25)` | 6.04 |
| pink | `oklch(0.562 0.16 355)` | 4.62 | `oklch(0.722 0.144 355)` | 6.02 |
| violet | `oklch(0.558 0.16 305)` | 4.63 | `oklch(0.718 0.144 305)` | 6.03 |
| indigo | `oklch(0.552 0.17 275)` | 4.62 | `oklch(0.712 0.149 275)` | 6.05 |
| slate | `oklch(0.54 0.03 255)` | 4.63 | `oklch(0.702 0.027 255)` | 6.00 |
| brown | `oklch(0.49 0.07 55)` | 5.87 | `oklch(0.68 0.07 55)` | 5.41 |
| olive | `oklch(0.536 0.1 115)` | 4.62 | `oklch(0.698 0.09 115)` | 6.01 |

Palette tokens not in the spec's table: fill (`--muted`, `--secondary`: #EDEAE3 / #2C2B28), hover (`--accent`: #F1EFEA / #302E2B), input (#D6D2C9 / #45423D), destructive (#B91C1C / #F08A80) and sidebar ground (#FBFAF7 / #1F1E1C), all taken from the design canvas artboards or chosen to sit between their neighbours.

## Type

IBM Plex Sans (`font-sans`, the interface), IBM Plex Mono (`font-mono`, labels) and Newsreader (`font-reading`, overviews, articles and View questions), all self-hosted through Fontsource. Plex Sans and Newsreader are the variable builds (Newsreader with optical size).

**Prose** uses shadcn **Typeset**: wrap rendered markdown in `className="typeset"`. The shadcn CLI registry has no Typeset item (it ships from the Typeset builder on ui.shadcn.com), so `src/styles/typeset.css` is vendored verbatim from the shadcn repo, with one change: `<mark>` uses `--suggested`. `globals.css` sets its fonts to `--font-reading`.

## Brand

`brand/` is the one swappable folder for the brand (spec 7.5). `apps/web` serves it as its public directory, so its files sit at the site root.

| File | Use |
|---|---|
| `glyph.svg` | The Seply glyph: five pale leaves on a rounded calyx-green tile. Follows `prefers-color-scheme`. |
| `wordmark.svg` | Glyph + "Seply" (Newsreader) + "Learn" (Plex Sans), with the text as outlines, so it needs no fonts. In the app use `<Wordmark>`. |
| `favicon.svg`, `favicon-32.png` | The glyph for browser tabs (it holds at 16px). |
| `icon.svg` | App icon source: the calyx tile full-bleed, leaves inside the maskable safe zone. |
| `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | PWA and iOS icons, rasterised from `icon.svg` (they work as `any` and `maskable`). The manifest arrives with WP-2.7. |

These files use literal colours, because they render outside the app's CSS.

## Allowed dependencies

none (besides third-party libraries).
