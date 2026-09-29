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
- **Side panel**: 440 px (`w-110`), opened by selecting a Concept (the Concept panel) or by the View button (the View panel, a stub). Below 1200 px it is a right-hand Sheet.
- **Concept panel** (spec §3.7, WP-1.7): `src/expedition/concept-panel.tsx`, with the pure parts in `reading.ts` (unit tested, `pnpm --filter web test`). A back stack of places: the overview depth (summary, Tags, aliases, Attributes, the overview, "Read the full article", Relationships both ways: "Links to" with each Relationship Type's label, "Linked from" with its inverse label) and the article depth (sections in order). Markdown renders with react-markdown + remark-gfm inside shadcn Typeset (`src/expedition/prose.tsx`; raw HTML is not rendered). In-text `#c/<id>` links and Relationship links push onto the stack; Back pops it; a canvas click starts a new stack. Every overview and article section has a provenance badge: "From the chat, turn N" (segment ids per the seeding contract: `tN` chat turn, `sN` document section) or "Background knowledge". The badge doesn't navigate yet (the Source viewer is a later work package).
- **Data**: `useSyncClient(expeditionId, userId)` (`src/lib/sync.ts`) opens `@umbel/sync`'s client with the fetch transport and the IndexedDB pending store, retries opening with backoff (1 s doubling to 30 s) when the server can't be reached, and disposes it on unmount. `useExpeditionData(collections)` gives the live rows (`useLiveQuery` per collection) for the rail, header and panel.

## Allowed dependencies

@umbel/ui, @umbel/views, @umbel/sync, @umbel/domain.

## Tests

- `e2e/smoke.spec.ts` (`chromium-light`, `chromium-dark`): the build renders in the system theme, against `vite preview`.
- `e2e/app/` (`app-light`, `app-dark`), against the Worker (`wrangler dev`, which serves this build and the API on one origin) and Postgres:
  - `shell.spec.ts`: sign in with the CI-only test credentials, reach the Library, import `packages/domain/fixtures/compute.json`, open it; the rail is 272 px, the canvas fills the rest, the side panel is 440 px (View panel, then a Concept clicked on the Learning path canvas), a Comparison Table View draws, and at 1024 px the panel is a Sheet. Screenshots of each step, in both themes, are attached to the report (`test-results/…/*-light.png`, `*-dark.png`). Also: the account menu's theme toggle.
  - `side-panel.spec.ts`: import the compute fixture, open GQA from the Techniques table, check the rendered overview, Tags, Attributes and Relationships both ways, follow an in-text `#c/` link (the panel navigates, not the page), go back, open the article, and see a provenance badge on the overview and on each section. Screenshots in both themes.
  - `offline-reload.spec.ts`: rename the Expedition with the API blocked, reload (still blocked): the edit is still pending in IndexedDB; unblock: it is pushed and the server has it.
- `e2e/api/` (`api`): the Worker's API and the sync client against it.

The Worker projects need `E2E_DATABASE_URL`, a migrated Postgres (CI: a service container). Locally without Docker, [`embedded-postgres`](https://www.npmjs.com/package/embedded-postgres) works; PGlite's socket server does not (its connection multiplexer breaks under the Worker's concurrent requests).

## Notes

- **Theme:** `index.html` has an inline script that sets `.dark` and `color-scheme` before first paint, from the `umbel-theme` key the `ThemeProvider` writes.
- **Public directory** is `packages/ui/brand`, so the favicon and PWA icons are served from the site root and the brand stays one swappable folder.
- **Styles:** `main.tsx` imports `@umbel/ui/globals.css`, then `@xyflow/react/dist/style.css`, then `@umbel/views/canvas.css` (that order).
