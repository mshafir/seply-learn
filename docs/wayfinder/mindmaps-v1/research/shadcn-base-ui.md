# shadcn with Base UI: component inventory and dark mode

Research for ticket [14](../tickets/14-shadcn-base-ui-inventory.md). Checked 2026-09-25. Versions come from the npm registry that day; shadcn facts come from ui.shadcn.com (docs and changelog). The screens are the `.dc.html` artboards in [`prototypes/app-flow/project/`](../prototypes/app-flow/project/), described in [App layout and page flow](../prototypes/app-flow.md).

## Summary

- **Base UI is now shadcn's default.** Since July 2026 (changelog "Base UI as the Default"), `shadcn init` picks Base UI, the docs open on the Base UI tab, and every new component ships for both Base UI and Radix. Base UI itself is stable: `@base-ui/react` **1.8.0** (2026-09-04). The shadcn CLI is **4.21.0** (2026-09-04).
- **The Base UI flavour has almost nothing missing.** The Base UI docs list 64 components and the Radix docs 65. The only difference is **Sonner**: Base UI projects use shadcn's own **Toast**, built on Base UI Toast (July 2026). Code differences: `asChild` becomes `render`, and toasts use `toast.add({...})` instead of Sonner's `toast("...")`.
- **Vite, Tailwind v4 and a shared UI package are supported out of the box.** `shadcn init -t vite --monorepo` scaffolds `apps/web` plus `packages/ui` on Turborepo, with Tailwind v4 set up in CSS (no config file) and dark mode included.
- **The inventory:** 98 UI elements across the 11 screens. 86 of them map onto prebuilt components, either directly or as layout built from prebuilt parts. The other 12 rows come down to **8 divergences**: **7 custom components** (the Expedition canvas, the other View renderers, Thumbnails, live cursors, a Steps indicator, a file drop zone, an Attribute list) and **1 extension** of a prebuilt component (status and provenance variants for Badge).
- **Dark mode:** shadcn tokens come in `:root` / `.dark` pairs, and the Vite theme provider toggles `.dark` on `<html>`. React Flow has `colorMode` plus `--xy-*` variables. For maps, OpenFreeMap serves a `dark` style (plus `fiord`), and Protomaps has `dark` / `black` flavours for self-hosted PMTiles. **vis-timeline has no dark theme** and needs its own override stylesheet. For prose, use **shadcn Typeset** (July 2026), which follows the theme tokens, or `@tailwindcss/typography` with `dark:prose-invert`.
- **Electron (44.4.5)** follows the OS through `prefers-color-scheme` automatically. The in-app toggle should set `nativeTheme.themeSource` over IPC, so native menus, dialogs and scrollbars match.

## shadcn with Base UI: setup and status

### Timeline (from the shadcn changelog)

| Date | Change |
|---|---|
| Feb 2025 | Tailwind v4 support |
| Dec 2025 | `npx shadcn create`, with a choice of Radix or Base UI |
| Jan 2026 | Full Base UI docs; every example rebuilt for both libraries |
| Feb 2026 | All blocks (sidebar, login, dashboard…) available for both libraries |
| Mar 2026 | CLI v4: `--preset`, `--base`, `init --template` (Vite included, "dark mode included for Next.js and Vite"), `--dry-run/--diff`, shadcn skills for coding agents |
| May 2026 | `shadcn/tailwind.css` shared utilities (e.g. `data-open:` variants), `shadcn eject` |
| Jun 2026 | Chat components: MessageScroller, Message, Bubble, Attachment, Marker |
| Jul 2026 | **Base UI becomes the default**; Base UI-only **Toast**; **Typeset** (markdown/prose styling); React Aria added as a third base |
| Aug 2026 | Questionnaire component |
| Sep 2026 | `cn` moves into a `cn` npm package (`shadcn migrate cn`) |

### Initialising (Vite, monorepo, Tailwind v4)

```bash
pnpm dlx shadcn@latest init -t vite --monorepo   # Base UI is the default; -b radix / --base aria for the others
cd apps/web && pnpm dlx shadcn@latest add button card sidebar ...   # installs into packages/ui
```

- The monorepo template creates `apps/web` and `packages/ui` (Turborepo). Components land in `packages/ui/src/components` and are imported as `@workspace/ui/components/button`. **Every workspace needs its own `components.json`**, so the Electron app (`apps/desktop`) gets one with the same `ui`/`utils` aliases pointing at `@workspace/ui`.
- `components.json` records the flavour and style together, e.g. `"style": "base-nova"` (the monorepo docs example). The style can't be changed after init; switching presets with `init --preset` rewrites the components. *Uncertain:* the `components.json` reference page still shows `"new-york"` and looks out of date. Treat `base-<style>` as the current form.
- There are eight styles (Vega, Nova, Maia, Lyra, Mira, Luma, Rhea, Sera) and seven base colours (Neutral, Stone, Zinc, Mauve, Olive, Mist, Taupe). **Stone or Taupe** is the nearest starting point for the canvas's warm ground (#F6F5F1). Ticket 17 overrides the tokens anyway.
- Tailwind v4 is set up in CSS only: `@import "tailwindcss"; @import "shadcn/tailwind.css"; @custom-variant dark (&:is(.dark *));`, then `:root { … }` / `.dark { … }` token blocks, then `@theme inline { --color-x: var(--x) }`. The Vite plugin is `@tailwindcss/vite` (tailwindcss **4.3.3**, 2026-07-16).
- **Base UI portals:** Base UI asks for `isolation: isolate` on the app root (and `body { position: relative }` for iOS 26+ Safari), so popups always sit above page content. This matters here because React Flow and MapLibre both set their own z-index stacks.

### Theming and new tokens

Tokens come in pairs: `--primary` / `--primary-foreground`, and so on, plus `--sidebar-*` and `--chart-1..5`, all in oklch. To add one (the docs use `--warning` as the example), define it in `:root` and `.dark`, then expose it in `@theme inline`. Umbel Learn needs, at minimum:

- `--suggested` (amber: suggested, in progress, "from the source")
- `--success` (the ready status)
- `--kind-*` (one per Concept Kind)
- `--reading` (the font token for Newsreader)

Ticket 17 owns the values.

### Gaps vs Radix

| Area | Radix flavour | Base UI flavour | Impact |
|---|---|---|---|
| Toasts | Sonner (the old Toast is deprecated) | **Toast**, built on Base UI Toast: `toast.add({title, description, type, actionProps})`, `toast.promise`, stacking, swipe | Use Toast. Sonner snippets from blogs and LLMs won't apply. |
| Composition | `asChild` | `render={<a href… />}` | Mechanical, but most third-party snippets and older blocks assume `asChild`. |
| Component list | 65 | 64 (everything except Sonner) | None found for our screens. |
| Command palette | cmdk | cmdk (same) | None. |
| Blocks | all | all (since Feb 2026) | None. |

Community registry items are often Radix-only. Check each one before adding it.

### Dark mode (Vite)

shadcn's Vite recipe is a small `ThemeProvider` (theme `light | dark | system`, saved in `localStorage`, toggling `.dark` on `<html>`) and a `ModeToggle` built from DropdownMenu and Button. Two gaps to close in our copy:

1. In `system` mode, the recipe reads `matchMedia` once. Add a `change` listener so the app follows the OS live.
2. Add an inline script to `index.html` that sets the class before React mounts, so the page doesn't flash light. Also set `color-scheme: light dark` so native scrollbars and form controls match.

Expose `resolvedTheme` from the provider, because React Flow, MapLibre and vis-timeline need the concrete value.

## Inventory

**Covers?** takes one of four values:

- **Yes:** a prebuilt component, styled with className only.
- **Composed:** several prebuilt parts arranged in app layout; no new primitive.
- **Extends:** a new variant or token on a prebuilt component.
- **Diverges:** a custom component.

The Extends and Diverges rows go into `DIVERGENCES.md` (ticket 17).

| Screen | UI element | Prebuilt shadcn component (or block) | Covers? | Divergence and why |
|---|---|---|---|---|
| All | App header: wordmark, breadcrumb (Library / Expedition / View), status text | Breadcrumb, Separator, Badge | Composed | The header bar itself is a flex row. No Header component is needed. |
| All | Tooltips on icon buttons, shortcut hints | Tooltip, Kbd | Yes | |
| All | Theme toggle (system / light / dark) | DropdownMenu + Button (shadcn `ModeToggle` recipe) | Yes | Lives in the account menu. |
| All | Narrow-window side panel | Sheet (or Drawer) | Yes | Not on the canvas, but needed below ~1100 px. |
| Library | Global search "Search Concepts, articles and #tags" | InputGroup (icon addon) opening a CommandDialog with results grouped by Expedition, Concept, Tag | Yes | |
| Library | "New graph" primary button | Button (default, with icon) | Yes | |
| Library | Account button (initials) | Avatar + DropdownMenu | Yes | |
| Library | Left nav: My / Shared with me / Drafts with counts | Sidebar (SidebarMenu, SidebarMenuButton `isActive`, SidebarMenuBadge) | Yes | |
| Library | Tag chips in the nav | Badge (secondary, `render` as link), or ToggleGroup to filter | Yes | |
| Library | "Continue reading" banner: icon, title, step, progress, Resume | Item (ItemMedia, ItemContent, ItemActions) + Progress + Button | Yes | |
| Library | Section heading + "Sorted by last opened" | Typography + Select/DropdownMenu for the sort | Yes | |
| Library | "New graph" dashed tile | Card with `border-dashed` (or Empty, outline variant) | Yes | |
| Library | Expedition card: thumbnail, title, summary, avatars, sharing text, counts, date | Card (Header/Content/Footer) + AspectRatio + AvatarGroup | Composed | The thumbnail inside is custom (see Thumbnails). |
| Library | Sharing avatar stack with names on hover | AvatarGroup, AvatarGroupCount, Tooltip | Yes | AvatarGroup is prebuilt now. |
| Library | No Expeditions yet (implied) | Empty | Yes | |
| Source | "← Library" back link | Button (ghost/link, `render={<a>}`) | Yes | |
| Source, Seed | Wizard stepper: 1 Sources · 2 Choose Views · 3 Open | none | **Diverges** | shadcn has no Stepper. A small `Steps` component (an `<ol>` of Badges and Separators) covers this and the build stage list. |
| Source | Source type picker: three large tabs (label + hint) | Tabs (TabsTrigger restyled larger, two-line) | Yes | Or RadioGroup as a Field "Choice Card". Tabs matches the markup (`role=tablist`). |
| Source | Chat paste box with label and help | Field, FieldLabel, Textarea, FieldDescription | Yes | |
| Source | File drop zone "Drop files, or browse" | none (Attachment shows files but isn't a drop target) | **Diverges** | A custom drop target (native DnD or react-dropzone) with Empty and Button inside. Dropped files are listed with Attachment (upload state, remove). |
| Source | "Or a link to read" | Field + Input (`type=url`) | Yes | |
| Source | Goal chips: learn it / compare / decide / plan | ToggleGroup (single, outline, sm) | Yes | |
| Source | "Drafted from general knowledge" note | Alert (or FieldDescription) | Yes | |
| Source | "Add this source" + hint | Button (secondary) | Yes | |
| Source | Sources list: kind, title, meta, remove × | ItemGroup/Item + Badge + Button (icon, ghost); Attachment for files | Yes | |
| Source | "Propose a graph from 3 sources" CTA | Button | Yes | |
| Seed | Heading + "[N] Concepts found" | Badge | Yes | |
| Seed | Proposed View cards: thumbnail, ✓, type label, question, why (toggle) | Field "Choice Card" (FieldLabel wrapping Checkbox + content), laid out as tiles | Composed | Choice Card is a row pattern. We put a thumbnail inside and use a tile grid (className). |
| Seed | "Suggest more Views" dashed tile | Button (outline, `border-dashed`) + Spinner while loading | Yes | |
| Seed | "Ask for a specific View" + Propose it | Field + InputGroup (InputGroupTextarea + InputGroupButton) | Yes | |
| Seed | Footer bar: note, Save draft, "Create graph with N Views" | Button (outline + default) | Composed | |
| Seed | Proposals loading | Skeleton | Yes | |
| Building | Header status "Building · start reading as Views finish" | Badge + Spinner | Yes | |
| Building | "Leave it building; we'll notify you" | Button (link) | Yes | |
| Building, Ready | Views rail with per-View status: dot, label, status pill (building / queued / ready / 60% / failed), step label, bar | Sidebar (SidebarMenuButton size lg, SidebarMenuBadge) + Badge + Progress | **Extends** | Badge only has default / secondary / destructive / outline. Add `success`, `progress` (amber) and `queued` variants, plus a pulsing status dot, on new tokens. |
| Ready | Failed View: reason + Retry / Try another View / Remove | Alert (destructive) inside the rail item + ButtonGroup of small link Buttons | Yes | |
| Building | Floating View button while building | Button (outline) + Spinner in a React Flow `<Panel>` | Yes | |
| Building | Stage panel: ✓ Read 3 sources → Finding Concepts (streaming list, source tags) → Building 4 Views | Item list + Spinner + Badge | **Diverges** (shared with the stepper) | The vertical form of `Steps`. The streamed Concept list inside is Items with a source Badge. |
| Building, Ready | Canvas status line "Linking prerequisites · 9 of 16" / "Writing articles · 23 of 68" | Badge + Spinner (Marker's `shimmer` status is an option) | Yes | Marker is meant for chat threads. Only use it if the look fits. |
| Ready | Ready toast "Anatomy is ready · Open" | Toast (`type: "success"`, `actionProps`) | Yes | |
| Skeletons | Rail rows, panel text and table cells while building | Skeleton, SidebarMenuSkeleton | Yes | |
| Skeletons | Per-View-Type shapes: ghost nodes in slots, "?" cells, axis first, map frame first | Skeleton inside each renderer | **Diverges** (part of the View renderers) | Each renderer draws its own skeleton. Not a new divergence. |
| Graph | Breadcrumb + "v5 · draft" | Breadcrumb + Badge (outline) | Yes | |
| Graph | "Find in this graph" | InputGroup opening CommandDialog (⌘K, Kbd) | Yes | |
| Graph | Presence avatars in the header | AvatarGroup + Tooltip | Yes | |
| Graph | "Ask for more", "Share" | Button (outline / default) | Yes | |
| Graph | Views rail: 12 Views (name + question), "+ Add a View" | Sidebar (SidebarGroup, two-line SidebarMenuButton, SidebarGroupAction); width 272 px via `--sidebar-width` | Yes | |
| Graph | Expedition canvas (nodes, Relationships, pan/zoom) | none | **Diverges** | React Flow. See Custom surfaces. |
| Graph | Concept node: Kind colour edge, tag, read check | Badge inside a custom node | **Diverges** (part of the canvas) | |
| Graph | Floating View button (icon, name, question, settings) | Button (outline, lg, two-line) in React Flow `<Panel>` | Yes | |
| Graph | Path chip "Path to MLA · 7 of 11 read" + clear × | ButtonGroup (Badge-like text + icon Button) | Yes | |
| Graph | Zoom + / − / fit | ButtonGroup (vertical) + icon Buttons + Tooltip, calling `useReactFlow()` | Yes | Replaces React Flow's own `<Controls>`, so the theme matches. |
| Graph | Side panel (440 px, opens on selection, closable) | ResizablePanelGroup (rail · canvas · panel) with ScrollArea; Sheet on narrow windows | Composed | Sidebar supports `side="right"`, but one SidebarProvider already drives the Views rail. A non-modal ResizablePanel is simpler than a second Sidebar. |
| Graph | Concept header: KIND · date, close ×, serif title, tags | Badge + Button (icon, ghost) + typography (`font-reading`) | Yes | |
| Graph | Reading status: Not read yet / Read / I knew this | ToggleGroup (single, outline, joined) | Yes | |
| Graph, Panel | Summary line + overview paragraph with in-text links | Typeset (`.typeset`) around react-markdown output | Yes | |
| Graph, Panel | "Read the full article" link | Item (outline, `render={<a>}`) | Yes | |
| Graph, Panel | LINKS TO / LINKED FROM (Relationship Type + Concept link) | Item (sm) or a list; Relationship Type as Badge (outline) | Yes | |
| Graph | View panel: "← Back to …" | Button (ghost) | Yes | |
| Graph | View settings: Show all steps (30 hidden), Hide what I've read | Field (horizontal) + Switch + FieldDescription | Yes | |
| Graph | "A foundation is core when it's shared by [6 paths]" | Select | Yes | |
| Graph | Targets (#technique, 5+ steps) and Follows (Relationship Types) | Combobox (multiple, chips) | Yes | |
| Graph | "Just for you, or for everyone?" split | Two FieldSets (FieldLegend "Yours" / "Everyone with edit access") + Alert | Yes | |
| Graph | Duplicate this View / Read the View Type | Button (link) | Yes | |
| Panel | Attribute pairs (Maturity: standard, Buys: efficiency…) | none (no description list) | **Diverges** (minor) | A ~20-line `AttributeList` (`<dl>` grid on tokens). Table is too heavy for this, and Item is built for rows. |
| Panel | Article header: "ARTICLE · 3 MIN", title, section jump chips | Badge (`render={<a href="#…">}`) or Button (ghost, xs) | Yes | |
| Panel | "← Back to overview" (panel back stack) | Button (link) | Yes | |
| Panel | Article body: h2, tables, blockquote "From the chat" | Typeset (with `typeset-scroll` for wide tables) | Yes | |
| Panel | Provenance per section: "from the chat" / "background knowledge", link to the source turn | Badge + HoverCard (previews the turn) | **Extends** (same Badge variants as above) | Needs `source` (amber) and `background` (muted) Badge variants. |
| Panel | Editing banner: "JL is editing the article · Saved to draft" | Avatar + Badge (or Marker) | Yes | |
| Panel | Edit form: Title, Kind, Date ("2023"), Summary, Overview (markdown) | Field + Input + Select + Textarea | Yes | Date is fuzzy text, so Input, not Date Picker. A rich markdown editor would be a later divergence. Not needed for v1. |
| Panel | Article: Edit / Redraft with AI | ButtonGroup | Yes | |
| Panel | Relationship rows: type select, Concept, remove; "+ Link to a Concept" | Select + Combobox (Concept picker) + Button (icon) | Yes | |
| Panel | Done | Button | Yes | |
| Grow | Presence: MS, JL, Claude via MCP, "3 here" | AvatarGroup + AvatarGroupCount + AvatarBadge (agent icon) | Yes | |
| Grow | Live cursors on the canvas | none | **Diverges** | A presence overlay in React Flow flow coordinates (a cursor SVG plus a name label). Avatar colours come from tokens. |
| Grow | Dashed proposal nodes and edges on the canvas | custom node/edge styles | **Diverges** (part of the canvas) | |
| Grow | MCP proposal toast: "Claude proposed 2 Concepts · Review / Later" | Toast (`actionProps` = Review; dismissing = Later) | Yes | |
| Grow | Aside tabs: Ask / Suggestions · 6 / Activity | Tabs + Badge (count) | Yes | |
| Grow | Ask thread: user question, assistant answer | MessageScroller + Message + Bubble | Yes | New chat components (June 2026). They handle streaming scroll. |
| Grow | Proposal rows: kind, title, note, ✓ accept / × dismiss | Item (ItemActions with icon Buttons) | Yes | |
| Grow | "Accept all 4", "Write overviews too" | Button + Button (outline) | Yes | |
| Grow | "Ask about this graph" + Ask | Field + InputGroup (InputGroupInput + InputGroupButton) | Yes | |
| Grow | "Uses your API key · …" | FieldDescription | Yes | |
| Grow | Activity tab (not drawn) | Item list / Marker | Yes | |
| Versions | Breadcrumb … / History | Breadcrumb | Yes | |
| Versions | "Snapshot the draft as v6" | Button | Yes | |
| Versions | Snapshot history (id, name, meta; selected) | ItemGroup (`render` as links, active state) | Yes | |
| Versions | Diff summary tiles (201 overviews added…) | Card grid (CardHeader + CardTitle as the figure) | Yes | |
| Versions | Restore a Snapshot (implied) | AlertDialog | Yes | |
| Versions | Share dialog: title, close | Dialog (DialogHeader, DialogTitle, DialogClose) | Yes | |
| Versions | Invite by email + role | InputGroup / ButtonGroup: Input + Select + Button | Yes | |
| Versions | People with roles (Owner, Can edit, Can suggest) | Item + Avatar + Select | Yes | |
| Versions | Public link toggle, "Include the source chat" | Field + Switch (or Checkbox) | Yes | |
| Versions | Link + "Copy link" | InputGroup (read-only Input + InputGroupButton) + Toast "Copied" | Yes | |
| Thumbnails | Tile grid: miniature + View name + question | Card + AspectRatio | Composed | |
| Thumbnails | The miniatures (one per View Type) | none | **Diverges** | Custom SVG per View Type, drawn from the Expedition's best View. |
| Graph (not drawn) | Right-click on a Concept | ContextMenu | Yes | |

### Divergence list (8)

1. **Expedition canvas** (React Flow). Includes Concept nodes, Relationship edges, dashed Proposals, streaming placeholders and read checks.
2. **Other View renderers.** Comparison Table, Map (MapLibre), Timeline (vis-timeline), Anatomy/Outline, and each one's build skeleton.
3. **Thumbnails.** An SVG miniature per View Type.
4. **Live cursors** (a presence overlay on the canvas).
5. **Steps.** The horizontal wizard stepper and the vertical build stage list, as one component.
6. **File drop zone.**
7. **AttributeList** (a key/value `<dl>`). Minor.
8. **Badge variants (extension).** `success`, `progress`, `queued` for build status; `source` and `background` for provenance; plus a pulsing status dot. All on new tokens.

Everything else is prebuilt: 41 distinct shadcn components (Alert, AlertDialog, AspectRatio, Attachment, Avatar/AvatarGroup, Badge, Breadcrumb, Bubble, Button, ButtonGroup, Card, Checkbox, Combobox, Command, ContextMenu, Dialog, DropdownMenu, Empty, Field, HoverCard, Input, InputGroup, Item, Kbd, Message, MessageScroller, Progress, Resizable, ScrollArea, Select, Separator, Sheet, Sidebar, Skeleton, Spinner, Switch, Tabs, Textarea, Toast, ToggleGroup, Tooltip) plus Typeset.

## Custom surfaces and the shadcn parts they can use inside

| Surface | shadcn inside it |
|---|---|
| **React Flow canvas** | Custom nodes built from Badge, Tooltip, HoverCard (Concept preview on hover) and ContextMenu (right-click). Overlays in `<Panel>`: the View button (Button), path chip (ButtonGroup), zoom controls (ButtonGroup + Tooltip). Use `<NodeToolbar>` with ButtonGroup for node actions, and Skeleton for ghost slots. Popovers in nodes must portal out (Base UI portals by default). |
| **Comparison Table View** | Table (and the Data Table recipe with TanStack Table for sorting). Skeleton and a "?" Badge in cells that are still filling. Tooltip for Attribute units. |
| **Map View (MapLibre)** | HTML markers render Badge/Avatar. Popups can host a small Card, or better, open the side panel. Map controls reuse ButtonGroup instead of the built-in `NavigationControl`. |
| **Timeline View (vis-timeline)** | Item templates (vis-timeline's `template` option) can render React into items: Badge for Kind. Zoom/fit controls as ButtonGroup. Tooltip via the item `title`, or a Base UI Popover anchored on selection. |
| **Anatomy / Outline Views** | If these are plain DOM rather than React Flow: Collapsible/Accordion for sections, Item for parts, Badge for techniques. |
| **Thumbnails** | Card + AspectRatio around the SVG. The SVG takes colours from tokens (`fill="var(--kind-idea)"`), so it follows dark mode. |
| **Markdown reader** (overview, article) | Typeset for the prose. In react-markdown `components`: `a` becomes a panel-navigation link with HoverCard, `table` goes through Table or `typeset-scroll`, `blockquote` gets the provenance Badge. |
| **Live cursors** | Avatar colours and a Badge name tag. |

## Dark mode for the non-shadcn parts

**React Flow** (`@xyflow/react` 12.12.0, 2026-09-24):
- Pass `colorMode={resolvedTheme}` (`light | dark | system`). React Flow adds `.dark` to `.react-flow`, and its stylesheet ships a `.react-flow.dark` block.
- Point the `--xy-*` variables at our tokens in both modes: `--xy-background-color`, `--xy-node-background-color-default`, `--xy-edge-stroke-default`, `--xy-handle-background-color-default`, `--xy-selection-background-color-default`, and so on, e.g. `.react-flow { --xy-edge-stroke-default: var(--muted-foreground); }`.
- Import `@xyflow/react/dist/style.css` inside `@layer base`, so Tailwind utilities win (React Flow's own advice for Tailwind).
- Custom nodes use `bg-card text-card-foreground border-border`, so they need nothing extra.
- Kind colours need dark counterparts as `--kind-*` tokens (ticket 17).

**MapLibre** (maplibre-gl 6.11.2, 2026-09-24):
- **OpenFreeMap** serves `positron`, `bright`, `liberty`, **`dark`** and **`fiord`** at `https://tiles.openfreemap.org/styles/<name>` (all checked, HTTP 200). Pairs that work well: `positron` ↔ `dark` (quiet, good under pins), or `liberty` ↔ `fiord`.
- **Self-hosted PMTiles:** `@protomaps/basemaps` has flavours `light`, **`dark`**, `white`, `grayscale`, **`black`**. Build the style with `layers("protomaps", namedFlavor("dark"), {lang})` plus the matching flavour sprite and glyph URLs. `light` ↔ `dark` is the natural pair.
- Switch with `map.setStyle(url)`. A style swap drops runtime-added sources and layers, so either re-add the pins on `style.load` or keep pins as HTML `Marker`s, which survive style changes and are themed by CSS.
- *Uncertain:* whether MapLibre 6's `setStyle(…, {diff:true})` keeps user layers. Test it.
- Give the map container `bg-background` so the empty frame during a swap isn't white.

**vis-timeline** (8.5.4, 2026-08-12):
- **No dark theme and no CSS variables.** I checked `styles/vis-timeline-graph2d.css`: hard-coded greys (`#c8c8c8`, `#dedede`, `#bfbfbf`), blue items (`#3876c2`), white backgrounds.
- Ship one override sheet that maps its classes to our tokens in both modes: `.vis-timeline` (border, background), `.vis-panel`, `.vis-time-axis .vis-text`, `.vis-grid.vis-minor/.vis-major`, `.vis-labelset .vis-label`, `.vis-item` (+ `.vis-selected`, `.vis-range`, `.vis-point .vis-dot`), `.vis-current-time`, `.vis-tooltip`.
- About 60 lines. It's a maintenance cost if vis-timeline changes class names. (Ticket 06 also sketched a d3-scale timeline drawn inside React Flow, which would make this unnecessary.)

**Markdown prose:**
- *Option A (prebuilt, recommended):* **shadcn Typeset**. One CSS file in the UI package, applied with `.typeset`. Its docs say it "already follows your theme colors" in dark mode. There is an optional `.dark .typeset { --typeset-leading }` tweak. It is built for streaming, and utilities override it without `!important`. Set its font to Newsreader via our `--font-reading` token.
- *Option B:* `@tailwindcss/typography` 0.5.20 (in v4, `@plugin "@tailwindcss/typography"`) with `prose dark:prose-invert`, then a custom `prose-*` colour map to hit the warm palette. It works, but it's a second typographic system beside shadcn.

## Electron notes

(Electron 44.4.5, 2026-09-23.)

- The renderer's `prefers-color-scheme` follows the OS automatically, so the shared `ThemeProvider` in "system" mode just works.
- When the reader picks light or dark in the app, send it over IPC to the main process and set `nativeTheme.themeSource = 'light' | 'dark' | 'system'`. That flips `prefers-color-scheme` in the renderer and also themes native menus, context menus, file dialogs and scrollbars.
- `nativeTheme.shouldUseDarkColors` and the `nativeTheme.on('updated')` event let the main process follow along.
- Store the choice in the main process (or `localStorage`, which works under a custom `app://` protocol) so it survives restarts. Apply it before the window shows.
- Avoid the white flash: create the `BrowserWindow` with `backgroundColor` matching the resolved theme and `show: false`, then show on `ready-to-show`. If we use a frameless window with `titleBarOverlay` (Windows/Linux), update its colours with `win.setTitleBarOverlay({color, symbolColor})` on theme change.
- *General Electron knowledge, not re-checked in the dark mode tutorial:* the `updated` event, `backgroundColor` and `setTitleBarOverlay`.
- Put the theme logic in `packages/ui` behind a small adapter: web uses `localStorage` + `matchMedia`; desktop uses a preload bridge (`window.umbel.theme.set/get/onChange`).
- Fonts (Plex, Newsreader) must be bundled, not loaded from Google Fonts, because the desktop app works offline. That's ticket 17.

## Risks

- **Radix-shaped snippets.** Most tutorials, community registries and LLM output still use `asChild` and Sonner. Mitigations: install the shadcn skills (`pnpm dlx skills add shadcn/ui`, which covers both bases), and lint for `asChild` / `sonner` imports.
- **Base UI moves fast** (a minor release roughly monthly: 1.5 in May, 1.6 in Jun, 1.7 in Aug, 1.8 in Sep 2026). shadcn components are copied into our repo, so they're stable, but pin `@base-ui/react`. Use `shadcn add --diff` to pull upstream fixes deliberately.
- **Very recent pieces:** Toast (Jul 2026), Typeset (Jul 2026), chat components (Jun 2026), the `cn` package (Sep 2026). They are less battle-tested. The `cn` migration is optional (`lib/utils.ts` keeps working).
- **Stacking contexts.** Base UI portals, React Flow panels and MapLibre controls all use z-index. Apply `isolation: isolate` to the app root early and test popovers opened from inside nodes and markers.
- **Three-pane layout.** shadcn Sidebar assumes one provider per layout. Using it for the right panel as well would fight it. Using Resizable for the panel is the recommended route, but check keyboard shortcuts and collapse behaviour.
- **Dark mode coverage.** vis-timeline and the Kind colours are hand-themed, and thumbnails must use tokens. A missed hard-coded hex shows up only in dark mode. Add a dark-mode visual check (Storybook or Playwright screenshots) for every View Type.
- **Docs drift.** The `components.json` reference still shows `new-york`, while examples use `base-nova`. Trust the CLI's output over that page.

## Sources

- shadcn changelog: <https://ui.shadcn.com/docs/changelog>. Entries used:
  - [Base UI as the Default (Jul 2026)](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)
  - [Base UI docs (Jan 2026)](https://ui.shadcn.com/docs/changelog/2026-01-base-ui)
  - [Blocks for both (Feb 2026)](https://ui.shadcn.com/docs/changelog/2026-02-blocks)
  - [CLI v4 (Mar 2026)](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4)
  - [Toast (Jul 2026)](https://ui.shadcn.com/docs/changelog/2026-07-toast)
  - [Typeset (Jul 2026)](https://ui.shadcn.com/docs/changelog/2026-07-typeset)
  - [React Aria (Jul 2026)](https://ui.shadcn.com/docs/changelog/2026-07-react-aria)
  - [Chat components (Jun 2026)](https://ui.shadcn.com/docs/changelog/2026-06-chat-components)
  - [shadcn eject (May 2026)](https://ui.shadcn.com/docs/changelog/2026-05-shadcn-eject)
  - [cn package (Sep 2026)](https://ui.shadcn.com/docs/changelog/2026-09-cn)
- shadcn docs:
  - [Vite install](https://ui.shadcn.com/docs/installation/vite)
  - [Monorepo](https://ui.shadcn.com/docs/monorepo)
  - [Theming](https://ui.shadcn.com/docs/theming)
  - [Dark mode (Vite)](https://ui.shadcn.com/docs/dark-mode/vite)
  - [components.json](https://ui.shadcn.com/docs/components-json)
  - [Components (Base UI)](https://ui.shadcn.com/docs/components): the Base and Radix nav lists were compared on 2026-09-25
  - Component pages: [Toast](https://ui.shadcn.com/docs/components/base/toast), [Sonner (Radix)](https://ui.shadcn.com/docs/components/radix/sonner), [Typography/Typeset](https://ui.shadcn.com/docs/components/base/typography), [Field](https://ui.shadcn.com/docs/components/base/field), [Avatar](https://ui.shadcn.com/docs/components/base/avatar), [Item](https://ui.shadcn.com/docs/components/base/item), [Sidebar](https://ui.shadcn.com/docs/components/base/sidebar), [Sheet](https://ui.shadcn.com/docs/components/base/sheet), [Command](https://ui.shadcn.com/docs/components/base/command), [Marker](https://ui.shadcn.com/docs/components/base/marker), [Attachment](https://ui.shadcn.com/docs/components/base/attachment)
- Base UI:
  - [Quick start (portals, isolation)](https://base-ui.com/react/overview/quick-start)
  - [v1.8.0 release, 2026-09-04](https://github.com/mui/base-ui/releases/tag/v1.8.0)
- npm registry, 2026-09-25: `@base-ui/react` 1.8.0, `shadcn` 4.21.0, `@xyflow/react` 12.12.0, `maplibre-gl` 6.11.2, `vis-timeline` 8.5.4, `tailwindcss` 4.3.3, `@tailwindcss/typography` 0.5.20, `electron` 44.4.5, `cn` 0.4.0.
- React Flow: [Theming / colorMode](https://reactflow.dev/learn/customization/theming)
- OpenFreeMap: [Quick start and styles](https://openfreemap.org/quick_start/), `https://tiles.openfreemap.org/styles/{liberty,bright,positron,dark,fiord}`
- Protomaps: [Basemap flavors](https://docs.protomaps.com/basemaps/flavors)
- vis-timeline stylesheet: <https://unpkg.com/vis-timeline@8.5.4/styles/vis-timeline-graph2d.css>
- Electron: [Dark mode tutorial](https://www.electronjs.org/docs/latest/tutorial/dark-mode), `nativeTheme` API
