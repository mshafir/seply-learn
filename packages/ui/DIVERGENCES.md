# Divergences from prebuilt shadcn

The UI uses prebuilt shadcn (Base UI) components first. Everything custom is listed here: why it exists, what it's built from and which package owns it. Spec: [docs/spec/v1/07-design-system.md §7.1](../../docs/spec/v1/07-design-system.md). The inventory behind this list is in [the shadcn research](../../docs/wayfinder/mindmaps-v1/research/shadcn-base-ui.md).

All 8 are accepted. Entries marked *planned* are not built yet; the work package that builds one fills in its entry.

| # | Divergence | Why | Built from | Owner | Status |
|---|---|---|---|---|---|
| 1 | **Expedition canvas** | No shadcn component draws a pannable graph of Concepts and Relationships with dashed Proposals, streaming placeholders and read checks. | React Flow (`@xyflow/react`) with custom nodes made of Badge, Tooltip, HoverCard and ContextMenu; overlays of Button, ButtonGroup and Tooltip; `--xy-*` variables mapped to tokens; `colorMode={resolvedTheme}`. | `@umbel/views` | planned |
| 2 | **View renderers** (non-canvas: table bands, outline, anatomy, quadrant, rates, lineage, plus Map and Timeline) | Each View Type has its own layout; none is a stock component. | Table (+ TanStack Table), Skeleton, Badge, Collapsible/Accordion, Item; MapLibre for Map; vis-timeline for Timeline. | `@umbel/views` | planned |
| 3 | **Thumbnails** | A miniature per View Type for Library cards and the Views rail. | A fixed SVG per View Type, filled with `var(--kind-*)` and other tokens, inside Card + AspectRatio. | `@umbel/views` | planned |
| 4 | **Live cursors** | Presence on the canvas; shadcn has no cursor overlay. | An absolutely positioned overlay with Avatar colours and a Badge name tag. | `@umbel/views` | planned |
| 5 | **Step indicator** (Sources → Choose Views → Open) | shadcn has no stepper; one component serves the horizontal wizard and the vertical build stage list. | Separator, Badge and Spinner, laid out with flex. | `@umbel/ui` | planned |
| 6 | **File drop zone** | shadcn has no drop target. | A native drag-and-drop area styled with tokens (dashed `--border`), wrapping Button and Input (`type=file`). | `@umbel/ui` | planned |
| 7 | **Attribute list** | A key/value `<dl>`; minor. | A semantic `<dl>` with tokens and type styles; Tooltip for units. | `@umbel/ui` | planned |
| 8 | **Badge variants** (extension) | Build status (`success`, `progress`, `queued`) and provenance (`source`, `background`) need colours shadcn's Badge doesn't have, plus a pulsing status dot. | New `cva` variants on the shadcn Badge, using `--success`, `--suggested`, `--suggested-text` and `--muted`. | `@umbel/ui` | planned |

## Also listed

| Item | Why | Built from | Owner | Status |
|---|---|---|---|---|
| **vis-timeline dark override sheet** (about 60 lines) | vis-timeline has no dark theme and no CSS variables; its stylesheet hard-codes greys, blue items and white backgrounds. | One stylesheet mapping `.vis-timeline`, `.vis-panel`, `.vis-time-axis .vis-text`, `.vis-grid.vis-minor/.vis-major`, `.vis-labelset .vis-label`, `.vis-item` (+ `.vis-selected`, `.vis-range`, `.vis-point .vis-dot`), `.vis-current-time` and `.vis-tooltip` to our tokens, in both modes. | `@umbel/views` | planned |
| **Typeset stylesheet** (vendored, not a divergence) | Typeset is prebuilt shadcn, but not in the CLI registry, so the file is copied in. | `src/styles/typeset.css`, verbatim from shadcn except `<mark>` uses `--suggested`. | `@umbel/ui` | done (WP-0.3) |
| **Brand components** (not a divergence) | The placeholder wordmark and glyph (spec 7.5). | Inline SVG and text with tokens: `src/components/brand.tsx`; standalone files in `brand/`. | `@umbel/ui` | done (WP-0.3) |
