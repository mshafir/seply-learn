# @seply/site

**Lane:** B: Server & infra (scaffold and deploy); D: App & UI (pages, from WP-7.2)

## Contract

`seply.app`: the static site that explains Seply Learn and sends people to the app at `learn.seply.app` (spec [9. Landing site](../../docs/spec/v1/09-landing-site.md)). An **Astro** static build, served by the `seply-site` Cloudflare Worker (static assets only, no Worker script).

- **Composes `@seply/ui` only** (`pnpm check:deps`): its tokens (`tokens.css`, `tokens-dark.css`), fonts (`fonts.css`, the same Fontsource packages as the app), the `Wordmark` and `SeplyGlyph` components, `buttonVariants`, `cn`, the brand folder's favicons and wordmark, and `lib/color` for the Open Graph card. It doesn't import `globals.css`, which scans the app's sources for Tailwind classes and carries Typeset and Base UI fixes the site doesn't need.
- **Colours come from tokens**, as in the app: Tailwind utilities such as `bg-background` and `text-muted-foreground`. No hex values in pages or components (a test checks).
- **Light and dark follow the system, with no JavaScript.** `<html class="theme-system">`, and `src/styles/site.css` imports `@seply/ui/tokens-dark.css` under `(prefers-color-scheme: dark)`; that file's selector is `.dark, .theme-system`, so the app and the site share one dark palette. Tailwind's `dark:` variant is the same media query here.
- **No JavaScript in the pages** unless a page needs it (spec 9.1 allows the mobile menu, the Views gallery tabs, the video player and copy buttons). React renders `@seply/ui` components at build time only (`@astrojs/react`, no `client:` directives). The integration still emits its client runtime into `_astro/`, but no page loads it. A test checks the pages have no `<script>`.

## Routes

| Path | Source | Notes |
|---|---|---|
| `/` | `src/pages/index.astro` → `src/learn/Home.astro` | The Learn page; a placeholder until WP-7.2 |
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

## The Open Graph card

`src/lib/og.ts` draws the card as SVG and rasterises it with resvg: the brand `wordmark.svg` (its light/dark styles swapped for token colours), the headline in Newsreader Medium at optical size 72 and `seply.app` in IBM Plex Sans, on the light `--background` with a `--calyx` rule. Colours are read from `@seply/ui/tokens.css` and converted from oklch to sRGB with `@seply/ui/lib/color`. fontkit sets the text as outlines from the Fontsource WOFF2 files, which `wawoff2` decompresses first (fontkit can't apply variations to WOFF2), so the card needs no system fonts and renders the same everywhere. The headline lives in `src/learn/copy.ts` with the page's description.

## Commands

```sh
mise exec -- pnpm --filter @seply/site dev        # astro dev on :4321
mise exec -- pnpm --filter @seply/site build      # dist/
mise exec -- pnpm --filter @seply/site preview    # astro preview of dist/; it runs in the background, stop it with `pnpm exec astro preview stop`
mise exec -- pnpm --filter @seply/site typecheck  # astro check (the .astro and .ts files)
mise exec -- pnpm --filter @seply/site test       # builds three ways (test/build.ts), then checks the output
```

`pnpm check` runs `typecheck` and `test`, so CI builds the site on every PR. The tests build production without a token, production with `CF_ANALYTICS_TOKEN`, and a preview, into `node_modules/.site-test/`, and check the routes, meta, canonical URLs, `noindex`, the beacon, the card's size, the dark palette's media query and that pages carry no script or hex colour.

## Deploy

`wrangler.jsonc` is the `seply-site` Worker: `dist/` as static assets, `auto-trailing-slash`, `404-page`, `workers_dev` on. `.github/workflows/preview.yml` deploys it:

- **Production:** after CI passes on `main`, as `seply-site` with `--domain seply.app` (the repo variable `SITE_DOMAIN` overrides it; `none` keeps it on workers.dev), then `scripts/check-deploy.mjs` checks the workers.dev URL and the domain.
- **Previews:** each PR that touches `apps/site`, `apps/video` or `packages/ui` gets `seply-site-pr-<n>` on workers.dev, built with `SITE_ENV=preview`, checked, and commented on the PR. Closing the PR deletes it.

What the owner sets up (the custom domain, the analytics site and token) is in [docs/ops/deploy.md](../../docs/ops/deploy.md#the-site-seplyapp).

## Allowed dependencies

`@seply/ui` (and third-party libraries).
