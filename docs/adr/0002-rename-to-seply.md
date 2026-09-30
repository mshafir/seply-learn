# The product is Seply Learn, on seply.app

The product was called **Umbel Learn**, with Umbel as the umbrella for separate LLM tools (Learn, Work, Plan). It is now **Seply Learn**, and **Seply** is the umbrella. Seply is a short, made-up name after the _sepal_, the leaf-like part that holds a flower. It keeps the botanical theme without being tied to one app. Production moves from `learn.umbel.dev` to `learn.seply.app`, and the repo from `mshafir/umbel-learn` to `mshafir/seply-learn`. Branding (wordmark, glyph, colours) is still a placeholder: the old umbel glyph stays until new branding lands.

## Why

- **umbel.io is a live mind-mapping app** ("Mind mapping for visual thinkers", 40,000+ users claimed). That's the same space as this product, which was called "Mindmaps" before, so it risks both confusion and a common-law trademark conflict.
- **UMBEL** was a well-known knowledge-graph ontology (about 34,000 concepts, retired in 2019). It still ranks in search for "Umbel concepts" and "knowledge graph", which is exactly this product's vocabulary.
- The obvious Umbel domains were taken (umbel.com, .app, .io, .co, .ai, .dev).

## Considered Options

- **Keep Umbel** as the public name: rejected, for the reasons above. It would have been fine as an internal codename only.
- **Longer names with rich meaning** (Vasculum, Cairnlore, Florilegium): harder to say and remember.
- **Symbie:** a Czech AI software company already trades as Symbie (symbie.ai), and "Symbi-" is crowded, including an education app.
- **Seply:** no conflict found in software, learning or productivity; `seply.app`, `.io`, `.co` and `.dev` were unregistered. `seply.app` was registered with Cloudflare Registrar.

## Consequences

- **New origin:** browser storage (the `seply-offline` IndexedDB database, the `seply-user` and `seply-theme` keys) and sessions start empty on `learn.seply.app`, and readers sign in again. The keys were renamed from `umbel-*` with no migration shim, because the only user was the owner, pre-launch. Pending edits on the old origin had to be synced before the switch.
- **`learn.umbel.dev` redirects** to `learn.seply.app`. The `umbel.dev` zone stays on Cloudflare, registered with Google Cloud Domains, until its renewal is decided.
- **SQL function names keep the old prefix.** The applied migration `packages/server/drizzle/0001_search.sql` defines `umbel_expedition_search`, `umbel_concept_tsvector`, `umbel_concept_search` and `umbel_article_section_search`. Applied migrations are never edited, and the names are internal, so they stay. A later migration can rename them if it's worth it.
- **Code names changed:** packages are `@seply/*`, CSS custom properties and classes use the `--seply-*` / `.seply-*` prefix, the production Worker is `seply-learn`, previews are `seply-pr-<n>`, and the Hyperdrive configs are `seply-production` / `seply-pr-<n>`. The old `umbel-learn` Worker and `umbel-*` Hyperdrive configs are deleted after the switch.
- **Historical records keep the old name:** `docs/wayfinder/` tickets, research and the map describe decisions as they were made, and still say Umbel.
