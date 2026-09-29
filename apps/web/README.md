# web

**Lane:** D: App & UI

## Contract

The Vite SPA (installable PWA): routes and screens from docs/spec/v1/03-screens-and-flows.md, composed from @umbel/ui, @umbel/views and @umbel/sync.

### Routes (wouter)

| Path | Screen |
|---|---|
| `/sign-in` | Sign in: "Continue with Google" starts Better Auth's Google flow (`POST /api/auth/sign-in/social`). |
| `/` | The Library (spec §3.2, basic): your Expeditions from `GET /api/expeditions`; **New** creates an untitled draft (`POST /api/expeditions`) and opens it; **Import** posts a JSON file to `/api/import` and opens the result. |
| `/e/:id` and `/e/:id/:viewId` | The Expedition screen (spec §3.6) on a View: the URL's, else the best View, else the first. |
| `/showcase` | Every token, Kind hue, type style and component, in both palettes (WP-0.3). |

`/` and `/e/*` need a session (`GET /api/me`); signed out, they redirect to `/sign-in`. The last signed-in user is kept in `localStorage` (`umbel-user`) so a reload without a connection can still load that user's pending edits.

### The Expedition screen

- **Header** (`h-14`): the glyph back to the Library, the title (owners and editors rename it in place, through the sync client), sync status ("Saving", "Offline · N edits waiting") and the **account menu** (name, theme System / Light / Dark, sign out).
- **Views rail**: shadcn `Sidebar` at `--sidebar-width: 272px`, under the header; each entry is the View's name and question. Below 768 px it is a Sheet opened from the header.
- **Canvas pane**: as wide as possible. `src/expedition/canvas-slot.tsx` mounts `@umbel/views`' `ExpeditionView` on the sync client's collections with the selected View and Concept. The **View button** (icon, name, question, settings icon) floats over its top-left corner and opens the View panel; the View is drawn below it.
- **Side panel**: 440 px (`w-110`), opened by selecting a Concept (the Concept panel) or by the View button (the View panel). Below 1200 px it is a right-hand Sheet.
- **View panel** (spec §3.6, §4.2, WP-2.4): `src/expedition/view-panel.tsx`. The description (the View Type doc's opening paragraph), **shared settings** (owners and editors only), **your settings**, "Duplicate" (editors: a copy of the View next to it, as new ops) and "Read the View Type" (the `docs/view-types/<id>.md` file, bundled at build time by `src/expedition/view-type-docs.ts`). Both forms are generated from the View Type's Zod schemas in `@umbel/domain` (`src/expedition/settings/`): `fields.ts` walks a schema into fields (unit tested), `settings-form.tsx` draws them with shadcn Field, Switch, Select, Checkbox, Input and Textarea. The per-View structure overrides (`placement`, `order`, `hide`, `fold`) are not in the form. A shared change is checked against the schema, then written to the View row; the sync client turns it into `view.set` ops by settings path.
- **Personal View settings**: `src/lib/personal-view-settings.ts`. Per reader and View, never shared, defaults from the View Type's personal schema. For now they live in this browser (localStorage) behind the `PersonalViewSettingsStore` interface; the server-side `personal_view_settings` table and per-reader API (WP-2.5) replace the store, not the callers. They reach the View as `personal` (Learning path's "Show all steps" is the same setting as its toolbar toggle).
- **Status chip** (`src/expedition/status-chip.tsx`): View-specific status floating at the bottom of the canvas, e.g. "Path to MLA · 7 of 11 read", with a clear button; the View reports it through `onStatus`.
- **Concept panel** (spec §3.7, WP-1.7): `src/expedition/concept-panel.tsx`, with the pure parts in `reading.ts` (unit tested, `pnpm --filter web test`). A back stack of places: the overview depth (summary, Tags, aliases, Attributes, the overview, "Read the full article", Relationships both ways: "Links to" with each Relationship Type's label, "Linked from" with its inverse label) and the article depth (sections in order). Markdown renders with react-markdown + remark-gfm inside shadcn Typeset (`src/expedition/prose.tsx`; raw HTML is not rendered). In-text `#c/<id>` links and Relationship links push onto the stack; Back pops it; a canvas click starts a new stack. Every overview and article section has a provenance badge: "From the chat, turn N" (segment ids per the seeding contract: `tN` chat turn, `sN` document section) or "Background knowledge". The badge doesn't navigate yet (the Source viewer is a later work package).
- **Data**: `useSyncClient(expeditionId, userId)` (`src/lib/sync.ts`) opens `@umbel/sync`'s client with the fetch transport and the IndexedDB pending store, retries opening with backoff (1 s doubling to 30 s) when the server can't be reached, pulls every 3 s while the page is visible (other tabs' and people's edits, until the live relay of WP-4.1), and disposes it on unmount. `useExpeditionData(collections)` gives the live rows (`useLiveQuery` per collection) for the rail, header and panel.

## Allowed dependencies

@umbel/ui, @umbel/views, @umbel/sync, @umbel/domain.

## Tests

- `e2e/smoke.spec.ts` (`chromium-light`, `chromium-dark`): the build renders in the system theme, against `vite preview`.
- `e2e/app/` (`app-light`, `app-dark`), against the Worker (`wrangler dev`, which serves this build and the API on one origin) and Postgres:
  - `shell.spec.ts`: sign in with the CI-only test credentials, reach the Library, import `packages/domain/fixtures/compute.json`, open it; the rail is 272 px, the canvas fills the rest, the side panel is 440 px (View panel, then a Concept clicked on the Learning path canvas), a Comparison Table View draws, and at 1024 px the panel is a Sheet. Screenshots of each step, in both themes, are attached to the report (`test-results/…/*-light.png`, `*-dark.png`). Also: the account menu's theme toggle.
  - `side-panel.spec.ts`: import the compute fixture, open GQA from the Techniques table, check the rendered overview, Tags, Attributes and Relationships both ways, follow an in-text `#c/` link (the panel navigates, not the page), go back, open the article, and see a provenance badge on the overview and on each section. Screenshots in both themes.
  - `view-panel.spec.ts`: two users in two browser contexts (the second added as an editor in the database). A shared setting (Cause & Effect's mode, then a text setting) changed by one reaches the other's open tab; a personal setting ("Show all steps") stays with the one who set it, across a pull and reloads. Also "Read the View Type", the Learning path status chip and its clear button, and Duplicate. Screenshots in both themes.
  - `offline-reload.spec.ts`: rename the Expedition with the API blocked, reload (still blocked): the edit is still pending in IndexedDB; unblock: it is pushed and the server has it.
- `e2e/api/` (`api`): the Worker's API and the sync client against it.

The Worker projects need `E2E_DATABASE_URL`, a migrated Postgres (CI: a service container). Locally without Docker, [`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres) works; PGlite's socket server does not (its connection multiplexer breaks under the Worker's concurrent requests).

## Notes

- **Theme:** `index.html` has an inline script that sets `.dark` and `color-scheme` before first paint, from the `umbel-theme` key the `ThemeProvider` writes.
- **Public directory** is `packages/ui/brand`, so the favicon and PWA icons are served from the site root and the brand stays one swappable folder.
- **Styles:** `main.tsx` imports `@umbel/ui/globals.css`, then `@xyflow/react/dist/style.css`, then `@umbel/views/canvas.css` (that order).
