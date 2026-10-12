# @seply/site

**Lane:** B: Server & infra (scaffold and deploy); D: App & UI (pages, from WP-7.2)

## Contract

`seply.app`: the static site that explains Seply Learn and sends people to the app at `learn.seply.app` (spec [9. Landing site](../../docs/spec/v1/09-landing-site.md)). An **Astro** static build, served by the `seply-site` Cloudflare Worker (static assets only, no Worker script).

- **Composes `@seply/ui` only** (`pnpm check:deps`): its tokens (`tokens.css`, `tokens-dark.css`), fonts (`fonts.css`, the same Fontsource packages as the app), Typeset (`typeset.css`, for `/self-host`), the `Wordmark` and `SeplyGlyph` components, `buttonVariants`, `cn`, the brand folder's favicons and wordmark, and `lib/color` for the Open Graph card. It doesn't import `globals.css`, which scans the app's sources for Tailwind classes and carries Base UI fixes the site doesn't need.
- **Colours come from tokens**, as in the app: Tailwind utilities such as `bg-background` and `text-muted-foreground`. No hex values in pages or components (a test checks).
- **Light and dark follow the system, with no JavaScript.** `<html class="theme-system">`, and `src/styles/site.css` imports `@seply/ui/tokens-dark.css` under `(prefers-color-scheme: dark)`; that file's selector is `.dark, .theme-system`, so the app and the site share one dark palette. Tailwind's `dark:` variant is the same media query here.
- **Little JavaScript, and only where spec 9.1 allows it:** the phone menu (`src/scripts/menu.ts`), the Views gallery tabs (`tabs.ts`), copy buttons (`copy.ts`) and the hero loop's pause button (`hero-loop.ts`), about 2 KB in all; a test holds every page under 60 KB. Each works without the others, and without JavaScript the page still reads (the first gallery tab shows; snippets have no Copy button). React renders `@seply/ui` components at build time only (`@astrojs/react`, no `client:` directives). The integration emits its client runtime anyway; `astro.config.mjs` (`seply-drop-unused-react-client`) deletes it when nothing refers to it, so it is never deployed.

## Routes

| Path | Source | Notes |
|---|---|---|
| `/` | `src/pages/index.astro` → `src/learn/Home.astro` | The Learn landing page, ported from the approved mockup: one component per section in `src/learn/sections/`, repeated copy in `src/learn/content.ts` |
| `/self-host/` | `src/pages/self-host.astro` → `src/learn/SelfHostGuide.astro` | `docs/self-host.md`, rendered at build time (below) |
| `/404.html` | `src/pages/404.astro` | Served with status 404 for any unknown path (`not_found_handling: "404-page"`); `noindex`, no canonical URL |
| `/og.png` | `src/pages/og.png.ts` → `src/lib/og.ts` | The 1200 × 630 Open Graph card, drawn at build time |
| `/sitemap.xml` | `src/pages/sitemap.xml.ts` | Every page in `src/pages` except the 404, at its canonical URL |
| `/robots.txt` | `src/pages/robots.txt.ts` | Allows everything and names the sitemap |
| `/_headers` | `astro.config.mjs` (`seply-headers`) | Read by Workers static assets, not served: `nosniff`, a referrer policy, and `X-Robots-Tag: noindex` on previews |

**The `learn/` route.** Pages are authored under `src/learn/` and mounted by thin files in `src/pages/` (spec 9.1: built under an internal `learn/` route, served at `/`). Today `src/pages/index.astro` mounts `src/learn/Home.astro` at `/`. When Seply Plan or Work ship and Learn moves to `seply.app/learn`, move the mounts to `src/pages/learn/` and add an Astro `redirects` entry for each old path, so links keep working. We chose mounts over rewriting `/learn/*` to `/` at the edge (a Worker script or `_redirects` proxying) because the static build then holds each page exactly once, at the path it is served from, and canonical URLs and the sitemap come straight from the routes.

**Canonical URLs** are `https://seply.app/<path>/` on every build, previews included, so a preview never competes with production. `trailingSlash: "ignore"` plus the Worker's `auto-trailing-slash` serve `/path` and `/path/` alike.

## Build settings

Read from the environment at `astro build` (`src/lib/env.ts`):

| Variable | Effect |
|---|---|
| `SITE_ENV=preview` | A PR preview: `<meta name="robots" content="noindex">` on every page, `X-Robots-Tag: noindex` in `_headers`, and never the analytics beacon. Anything else builds production. |
| `CF_ANALYTICS_TOKEN` | The Cloudflare Web Analytics site token. When set (and not a preview), every page gets the beacon (`static.cloudflareinsights.com/beacon.min.js`, cookie-free, no banner). CI sets it only for production. |

## The landing page

- **Sections** (`src/learn/sections/`), in order: Hero (the E-bike learning-path sketch under its question), How it works, Video, Views gallery, Agents, Read together, Examples, Self-host, Closing; then `SiteFooter`. `SiteHeader` has the inline links from the `md` breakpoint (768 px) and a menu button opening a panel below it.
- **Copy** is the mockup's, word for word. The E-bike example's summary and the Swiss rail counts are still the mockup's bracketed placeholders (`EXAMPLES` in `src/learn/content.ts`); fill them in when those Expeditions are tidied (spec 9.4). The showcase ids are `SHOWCASE` in the same file.
- **Layout:** the mockup's sizes and token use, as Tailwind utilities (`src/lib/styles.ts` holds the shared ones). The hero sketch's boxes are placed in % of the figure and sized in container query units, so it holds down to 320 px.

## Media

`src/media.ts` is the manifest of every media slot: the How it works shots, the five gallery shots, the three example shots, the Read together screenshot, the explainer, the hero loop and the live embed. Media is never committed (spec 9.3): CI puts the files in `public/media/` (gitignored) before `astro build`, and a slot whose file is missing renders a labelled placeholder naming the shot.

| Slot | Files under `public/media/` | Filled by |
|---|---|---|
| Screenshots (`IMAGE_SLOTS`) | `shots/<file>-light.webp` (required), `-light.avif`, `-dark.webp`, `-dark.avif` (optional; dark falls back to light) | WP-7.6 |
| Explainer | `video/explainer.mp4` and/or `.webm`, `explainer.vtt` (captions), `explainer-poster.webp` | WP-7.4: the site jobs in `preview.yml` copy the cached render in (`.github/actions/explainer-video`); locally, `pnpm --filter video render` and copy `apps/video/out/` |
| Hero loop | `video/hero-loop.mp4` and/or `.webm`, `hero-loop-poster.webp`; replaces the sketch, plays unless the reader prefers reduced motion, with a Pause button | WP-7.4, as above |
| Live embed | `SITE_EMBED_URL` at build time (`https://learn.seply.app/e/<id>/embed?view=<id>`); a lazy iframe, else the Read together screenshot | WP-7.5 |

`MEDIA_DIR` overrides where the build looks (the tests use it).

## /self-host

`src/content.config.ts` loads `docs/self-host.md` as a content collection, so the repo stays its one source. Markdown goes through remark/rehype (`unified()` from `@astrojs/markdown-remark`, not Astro's default Sätteri) with `src/lib/rehype-repo-docs.ts`, which turns relative links into GitHub links (`https://github.com/mshafir/seply-learn/blob/main/…`, resolved against the doc's path) and marks every code block for a Copy button and keyboard scrolling. No syntax highlighting: code blocks use the tokens, like the landing snippets. The page has an "On this page" list of the doc's sections beside it from 1024 px; below that the doc's own list of links serves. Prose is shadcn Typeset, headings in Newsreader. `turbo.json` adds `docs/self-host.md` to the build, test and typecheck inputs.

## The Open Graph card

`src/lib/og.ts` draws the card as SVG and rasterises it with resvg: the brand `wordmark.svg` (its light/dark styles swapped for token colours), the headline in Newsreader Medium at optical size 72 and `seply.app` in IBM Plex Sans, on the light `--background` with a `--calyx` rule. Colours are read from `@seply/ui/tokens.css` and converted from oklch to sRGB with `@seply/ui/lib/color`. fontkit sets the text as outlines from the Fontsource WOFF2 files, which `wawoff2` decompresses first (fontkit can't apply variations to WOFF2), so the card needs no system fonts and renders the same everywhere. The headline lives in `src/learn/copy.ts` with the page's description.

## Commands

```sh
mise exec -- pnpm --filter @seply/site dev        # astro dev on :4321
mise exec -- pnpm --filter @seply/site build      # dist/
mise exec -- pnpm --filter @seply/site preview    # astro preview of dist/; it runs in the background, stop it with `pnpm exec astro preview stop`
mise exec -- pnpm --filter @seply/site typecheck  # astro check (the .astro and .ts files)
mise exec -- pnpm --filter @seply/site test       # builds four ways (test/build.ts), then checks the output
```

`pnpm check` runs `typecheck` and `test`, so CI builds the site on every PR. The tests build production without a token, production with `CF_ANALYTICS_TOKEN`, a preview, and a build with some media files and an embed URL, into `node_modules/.site-test/`. They check the routes, meta, canonical URLs, `noindex`, the beacon, the card's size, the dark palette's media query, the landing sections and their order, the tablist, the media placeholders and files, the `/self-host` links and code blocks, the JavaScript budget, and that no `.astro` file has a hex colour.

## Deploy

`wrangler.jsonc` is the `seply-site` Worker: `dist/` as static assets, `auto-trailing-slash`, `404-page`, `workers_dev` on. `.github/workflows/preview.yml` deploys it:

- **Production:** after CI passes on `main`, as `seply-site` with `--domain seply.app` (the repo variable `SITE_DOMAIN` overrides it; `none` keeps it on workers.dev), then `scripts/check-deploy.mjs` checks the workers.dev URL and the domain.
- **Previews:** each PR that touches `apps/site`, `apps/video` or `packages/ui` gets `seply-site-pr-<n>` on workers.dev, built with `SITE_ENV=preview`, checked, and commented on the PR. Closing the PR deletes it.

What the owner sets up (the custom domain, the analytics site and token) is in [docs/ops/deploy.md](../../docs/ops/deploy.md#the-site-seplyapp).

## Allowed dependencies

`@seply/ui` (and third-party libraries).
