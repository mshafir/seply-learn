# @seply/site

**Lane:** B: Server & infra (scaffold and deploy); D: App & UI (pages, from WP-7.2)

## Contract

`seply.app`: the static site that explains Seply Learn and sends people to the app at `learn.seply.app` (spec [9. Landing site](../../docs/spec/v1/09-landing-site.md)). An **Astro** static build, served by the `seply-site` Cloudflare Worker: static assets, plus a small Worker script for `/media/*` only (below, under Deploy).

- **Composes `@seply/ui` only** (`pnpm check:deps`): its tokens (`tokens.css`, `tokens-dark.css`), fonts (`fonts.css`, the same Fontsource packages as the app), Typeset (`typeset.css`, for `/self-host` and `/desktop`), the `Wordmark` and `SeplyGlyph` components, `buttonVariants`, `cn`, the brand folder's favicons and wordmark, and `lib/color` for the Open Graph card. It doesn't import `globals.css`, which scans the app's sources for Tailwind classes and carries Base UI fixes the site doesn't need.
- **Colours come from tokens**, as in the app: Tailwind utilities such as `bg-background` and `text-muted-foreground`. No hex values in pages or components (a test checks).
- **Light and dark follow the system, with no JavaScript.** `<html class="theme-system">`, and `src/styles/site.css` imports `@seply/ui/tokens-dark.css` under `(prefers-color-scheme: dark)`; that file's selector is `.dark, .theme-system`, so the app and the site share one dark palette. Tailwind's `dark:` variant is the same media query here.
- **Little JavaScript, and only where spec 9.1 allows it:** the phone menu (`src/scripts/menu.ts`), the Views gallery tabs (`tabs.ts`), copy buttons (`copy.ts`) and the hero loop's start and pause button (`hero-loop.ts`), about 2 KB in all; a test holds every page under 60 KB. Each works without the others, and without JavaScript the page still reads (the first gallery tab shows; snippets have no Copy button). React renders `@seply/ui` components at build time only (`@astrojs/react`, no `client:` directives). The integration emits its client runtime anyway; `astro.config.mjs` (`seply-drop-unused-react-client`) deletes it when nothing refers to it, so it is never deployed.

## Routes

| Path | Source | Notes |
|---|---|---|
| `/` | `src/pages/index.astro` → `src/learn/Home.astro` | The Learn landing page, ported from the approved mockup: one component per section in `src/learn/sections/`, repeated copy in `src/learn/content.ts` |
| `/self-host/` | `src/pages/self-host.astro` → `src/learn/SelfHostGuide.astro` | `docs/self-host.md`, rendered at build time (below) |
| `/desktop/` | `src/pages/desktop.astro` → `src/learn/DesktopGuide.astro` | The desktop download buttons, then `docs/desktop.md` (the install steps), rendered the same way |
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
| `GITHUB_TOKEN` | Optional: sent with the GitHub API call for the desktop downloads (below), for its higher rate limit. CI passes the workflow's token. |
| `SITE_RELEASES=offline` | Skips that call: the desktop buttons open the Releases page. `SITE_RELEASES_FILE=<path>` reads the API's answer from a file instead (the tests use both). |

## The landing page

- **Sections** (`src/learn/sections/`), in order: Hero (the E-bike learning-path sketch under its question), How it works, Video, Views gallery, Agents, Read together, Examples, Self-host, Desktop, Closing; then `SiteFooter` (which links GitHub and `/desktop/`). The header, its phone menu, the footer and the Self-host section show the GitHub link with its mark (`src/components/GitHubIcon.astro`). `SiteHeader` has the inline links from the `md` breakpoint (768 px) and a menu button opening a panel below it.
- **Copy** is the mockup's, word for word. The showcase ids are `SHOWCASE` in `src/learn/content.ts`.
- **The Examples' counts** ("206 CONCEPTS · 12 VIEWS") are read at build time from the public API (`src/learn/counts.ts`: `GET /api/pull` on learn.seply.app, anonymously, folded into live Concepts and Views), so each redeploy has them right. A showcase that can't be read (offline, private) keeps its last known counts (`LAST_KNOWN` in `content.ts`). `SITE_COUNTS=offline` skips the network; the tests set it.
- **Layout:** the mockup's sizes and token use, as Tailwind utilities (`src/lib/styles.ts` holds the shared ones). The hero sketch's boxes are placed in % of the figure and sized in container query units, so it holds down to 320 px.

## Media

`src/media.ts` is the manifest of every media slot: the How it works shots, the five gallery shots, the three example shots, the Read together screenshot, the explainer, the hero loop and the live embed. Media is never committed (spec 9.3): CI puts the files in `public/media/` (gitignored) before `astro build`, and a slot whose file is missing renders a labelled placeholder naming the shot.

| Slot | Files under `public/media/` | Filled by |
|---|---|---|
| Screenshots (`IMAGE_SLOTS`) | `shots/<file>-light.webp` (required), `-light.avif`, `-dark.webp`, `-dark.avif` (optional; dark falls back to light), `shots/manifest.json` (where each came from; an `alt` there replaces the slot's) | WP-7.6: `scripts/capture.ts` (below); the site jobs in `preview.yml` copy this week's cached capture in (`.github/actions/site-screenshots`) |
| Explainer | `video/explainer.mp4` and/or `.webm`, `explainer.vtt` (captions), `explainer-poster.webp` | WP-7.4: the site jobs in `preview.yml` copy the cached render in (`.github/actions/explainer-video`); locally, `pnpm --filter video render` and copy `apps/video/out/` |
| Hero loop | `video/hero-loop.mp4` and/or `.webm`, `hero-loop-poster.webp`; replaces the sketch at its own 16:9 (the whole frame; the sketch keeps 7:5), plays unless the reader prefers reduced motion, with a Pause button. It starts once it can play and stays hidden over its poster until its first frame is up (`src/scripts/hero-loop.ts`) | WP-7.4, as above |
| Live embed | `SITE_EMBED_URL` at build time (`https://learn.seply.app/e/<id>/embed?view=<id>`); a lazy iframe, else the Read together screenshot | WP-7.5 |

`MEDIA_DIR` overrides where the build looks (the tests use it).

### Screenshots

`scripts/capture.ts` (Playwright and sharp, pinned) shoots every image slot in light and dark at 1440 × 900 and 2×, and writes `<file>-<theme>.avif|webp` and `manifest.json` to `public/media/shots/` (or `--out`). There's no demo account (hosted sign-in is Google only), so there are two sources:

| Shots | Source |
|---|---|
| Views gallery (01, 02, 03, 05, 07) and Examples (14, plus 02 and 05 again) | The public showcases on learn.seply.app (`CAPTURE_PUBLIC_URL`), read anonymously at `/e/<id>/<viewId>`. A shot whose Expedition isn't readable is skipped and logged, and its slot keeps its placeholder; 01 and 03 have fallback Views (E-bike's Learning path, AI compute's Timeline) whose alt text goes in the manifest. 01 selects MLA, so its prerequisites light up. |
| How it works (16, 17, 15) and Read together (19) | The app as the e2e tests run it: the Worker (`wrangler dev`) with test credentials on a migrated Postgres, started and stopped by the script when `CAPTURE_DATABASE_URL` (or `E2E_DATABASE_URL`) is set and `apps/web` is built, or `CAPTURE_APP_URL` for one already running. Seeded through the API with the committed fixtures: 16 is the create flow with a synthetic E-bike question and a stubbed skim; 17 is the fake build job with E-bike labels and previews; 15 is GQA's article in the compute fixture; 19 is three readers on the E-bike Learning path, seen by one of them. No secrets. |

Each shot waits for the canvas's `data-settled` (the app's readiness signal), fonts and a quiet network, with reduced motion, toasts and carets hidden, and the pointer parked off the canvas. A shot that fails for any other reason fails the run (exit 1) after the rest are done, and its pages are saved as PNGs under `--debug`.

```sh
mise exec -- pnpm --filter @seply/site capture                 # both sources
mise exec -- pnpm --filter @seply/site capture --public-only   # the showcases only
mise exec -- pnpm --filter @seply/site capture --app-only      # the signed-in screens only
mise exec -- pnpm --filter @seply/site capture --only=17-mid-build,19-two-readers
```

In CI, `.github/actions/site-screenshots` restores the capture cached under a hash of this script, `src/media.ts` and `package.json` plus the ISO week, so the public shots refresh weekly; on a miss it starts Postgres in a container, migrates it, builds `apps/web`, captures, and caches the result (unless a shot failed). The site jobs copy it into `public/media/shots/` before `astro build`.

## The desktop downloads

The Desktop section and `/desktop/` share `src/components/DesktopDownloads.astro`: a button each for macOS (the universal `.dmg`), Windows (the x64 `.exe`) and Linux (the amd64 `.deb`), and smaller links to the Arm and AppImage files. `src/learn/desktop.ts` finds them at build time: it lists the repo's Releases through the GitHub API and takes the newest `desktop-v*` one that isn't a draft or a prerelease, matching each file by the names `apps/desktop/electron-builder.yml` gives them. GitHub's "latest release" link can't be used, because "latest" is the server's Release, and the desktop one is never marked so.

When there is no desktop Release yet, the API can't be read, or a file is missing, the button opens the desktop Releases on GitHub (`releases?q=desktop-v`) instead, so the build never fails on it. The desktop release workflow (`.github/workflows/desktop-release.yml`) redeploys the site after it publishes, so the buttons follow each release; the weekly redeploy catches anything missed.

## /self-host and /desktop

`src/content.config.ts` loads `docs/self-host.md` and `docs/desktop.md` as a content collection, so the repo stays their one source. Both pages are `src/components/RepoDoc.astro`. Markdown goes through remark/rehype (`unified()` from `@astrojs/markdown-remark`, not Astro's default Sätteri) with `src/lib/rehype-repo-docs.ts`, which turns relative links into GitHub links (`https://github.com/mshafir/seply-learn/blob/main/…`, resolved against the doc's path), or into `/self-host/` and `/desktop/` for the two docs the site renders, and marks every code block for a Copy button and keyboard scrolling. No syntax highlighting: code blocks use the tokens, like the landing snippets. Each page has an "On this page" list of the doc's sections beside it from 1024 px; below that the doc's own list of links serves. Prose is shadcn Typeset, headings in Newsreader. `turbo.json` adds both docs to the build, test and typecheck inputs.

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

`pnpm check` runs `typecheck` and `test`, so CI builds the site on every PR. The tests build production without a token, production with `CF_ANALYTICS_TOKEN`, a preview, and a build with some media files and an embed URL, into `node_modules/.site-test/`. They check the routes, meta, canonical URLs, `noindex`, the beacon, the card's size, the dark palette's media query, the landing sections and their order, the tablist, the media placeholders and files, the `/self-host` and `/desktop` pages, the desktop buttons (the Releases page fallback, and a fixture Release's files), the JavaScript budget, and that no `.astro` file has a hex colour.

## Deploy

`wrangler.jsonc` is the `seply-site` Worker: `dist/` as static assets, `auto-trailing-slash`, `404-page`, `workers_dev` on.

**The media script.** Workers static assets answer every request with the whole file and no `Accept-Ranges`, and there is no setting to change that; Chrome-family browsers then load and seek video unreliably. So `/media/*`, and only that (`assets.run_worker_first`), goes through `worker/index.ts`: it fetches the whole file from the `ASSETS` binding and answers a single `Range` with `206` and `Content-Range` (`worker/range.ts`), one past the end with `416`, and anything else (no Range, several ranges, a stale `If-Range`) with the whole file. Every media response says `Accept-Ranges: bytes` and `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` (file names aren't hashed, so not immutable). Every other path never runs the script. `test/range.test.ts` covers it; `scripts/check-deploy.mjs` checks the 206 and 416 on each deploy. `.github/workflows/preview.yml` deploys it:

- **Production:** after CI passes on `main`, as `seply-site` with `--domain seply.app` (the repo variable `SITE_DOMAIN` overrides it; `none` keeps it on workers.dev), then `scripts/check-deploy.mjs` checks the workers.dev URL and the domain.
- **Previews:** each PR that touches `apps/site`, `apps/video` or `packages/ui` gets `seply-site-pr-<n>` on workers.dev, built with `SITE_ENV=preview`, checked, and commented on the PR. Closing the PR deletes it.
- **Weekly and on demand:** the same workflow's `schedule` (Mondays) and `workflow_dispatch` (with `recapture` to ignore the screenshot cache) rebuild and redeploy production from `main`, for fresh screenshots of the showcases and fresh Examples counts.

What the owner sets up (the custom domain, the analytics site and token) is in [docs/ops/deploy.md](../../docs/ops/deploy.md#the-site-seplyapp).

## Allowed dependencies

`@seply/ui` (and third-party libraries).
