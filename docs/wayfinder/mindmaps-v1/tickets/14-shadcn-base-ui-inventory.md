---
id: 14
title: shadcn with Base UI, component inventory and dark mode
labels: [wayfinder:research]
status: closed
assignee: claude-research-agent
blocked_by: []
---

## Question

Umbel Learn's UI uses **shadcn with Base UI** as the primitive library, prebuilt components wherever possible, and **dark mode**. Find out, against the screens in [App layout and page flow](12-app-layout-and-page-flow.md):

- The current state of shadcn's Base UI support: how to initialise it, which components exist in the Base UI flavour, and any gaps vs the Radix flavour. Tailwind v4 and theming (CSS variables, `.dark` class), plus Vite (not Next) setup.
- **An inventory:** for every UI element on the canvas (headers, rails, cards, segmented controls, tabs, dialogs, toasts, form fields, avatars and stacks, progress, skeletons, badges, side sheets, command/search, dropdowns), the prebuilt component that covers it, or **"diverges"** with the reason.
- Known custom surfaces (the React Flow canvas, View renderers, thumbnails, the markdown reader): which shadcn pieces they can still use inside.
- **Dark mode for the non-shadcn parts:** React Flow (colorMode), MapLibre (a dark basemap style, OpenFreeMap or PMTiles), vis-timeline, and markdown prose (Tailwind typography `dark:prose-invert`).
- Electron: anything special about theme following the OS.

Write findings to `research/shadcn-base-ui.md`, with the inventory as a table.

## Resolution

Findings: [shadcn-base-ui](../research/shadcn-base-ui.md).
- Base UI has been shadcn's default since July 2026 (`@base-ui/react` 1.8.0, shadcn CLI 4.21.0). The Base UI flavour has every component except Sonner: it uses its own Toast (`toast.add`) instead. Radix `asChild` becomes `render`.
- Setup: `shadcn init -t vite --monorepo` scaffolds `apps/web` + `packages/ui` with Tailwind v4 set up in CSS. Electron joins as another workspace with its own `components.json`. Dark mode is `:root`/`.dark` tokens plus the Vite ThemeProvider, with a live `system` listener and a no-flash script added.
- Inventory: 98 UI elements across the 11 screens. 86 are prebuilt or composed from prebuilt parts. **8 divergences:** 7 custom (the Expedition canvas, the other View renderers, Thumbnails, live cursors, Steps, a file drop zone, AttributeList) and 1 extension (status and provenance Badge variants).
- Non-shadcn dark mode: React Flow `colorMode` + `--xy-*` variables mapped to tokens. MapLibre: OpenFreeMap `positron`↔`dark` (or `liberty`↔`fiord`), Protomaps `light`↔`dark` for PMTiles. vis-timeline has no dark theme, so it needs a hand-written override sheet. Prose uses shadcn Typeset, which follows the theme tokens (`prose dark:prose-invert` is the fallback).
- Electron: `prefers-color-scheme` follows the OS. The in-app toggle sets `nativeTheme.themeSource` over IPC. Match `BrowserWindow` `backgroundColor` to the theme to avoid a white flash.
