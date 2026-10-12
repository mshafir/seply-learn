# 9. Landing site

`seply.app` is a static site that explains Seply Learn and sends people to the app at `learn.seply.app`. It was designed in the [landing page design doc](https://claude.ai/code/artifact/5c04d909-afa4-43a0-9eed-c1864c1efca4) and [mockup](https://claude.ai/artifact/YGyWqSChatVf5bGGQ2dAVh) (owner-only links); this section is the build contract.

## 9.1 Address and stack

- **Address:** the `seply.app` apex serves the Learn page for now. Pages are built under an internal `learn/` route and the apex serves them at `/`, so the page can move to `seply.app/learn` when Seply Plan or Work ship, without breaking links.
- **App:** `apps/site`, an **Astro** static build. It composes `packages/ui` for tokens, fonts, the glyph and the wordmark, so the page and the app share one look. No React at runtime except where a page needs it; the target is no JavaScript beyond the mobile menu, the Views gallery tabs, the video player and copy buttons.
- **Hosting:** a separate Cloudflare Worker with static assets (`seply-site`), on the `seply.app` custom domain. CI deploys it on merge to main, and each pull request that touches `apps/site`, `apps/video` or `packages/ui` gets a preview Worker. Previews send `noindex`.

## 9.2 Pages

- **`/`:** the landing page: header (wordmark, links, Request access; a menu button below the phone breakpoint), hero, How it works, the explainer video, the Views gallery (the five strongest View Types as tabs, then the other six named), working with agents, reading with other people, live embed, public Examples, self-host, closing call, footer.
- **`/self-host`:** rendered at build time from [`docs/self-host.md`](../../self-host.md), so the repo stays its one source. Relative links become GitHub links.
- **404.** Light and dark follow the system, from the app's tokens.
- **Copy** follows the brand voice ([7.5](07-design-system.md#75-branding)) and is written in plain, full sentences. The headline is "Turn questions into something you can read and come back to."; the tagline stays for brand use.
- **Meta:** titles and descriptions per page, a 1200 × 630 Open Graph card generated at build time, canonical URLs, `sitemap.xml`, and the Cloudflare Web Analytics beacon on production only (cookie-free, no banner).

## 9.3 Media

- **Screenshots** are captured by a Playwright script (`apps/site/scripts/capture.ts`) from the public showcase Expeditions on `learn.seply.app`, in light and dark at 1440 × 900 (2× density), and served as AVIF and WebP. Shots of signed-in screens use a demo account whose credentials live only in CI secrets. The list is in the design doc.
- **The explainer video** is motion graphics, about 60 seconds with captions and no voiceover, made with **Remotion** in `apps/video`. It animates the real `packages/views` renderers with committed fixture data (the compute sample and the Swiss rail fixture), never screen recordings. Outputs: MP4 and WebM, a 12-second hero loop, a poster frame and WebVTT captions.
- **Neither is committed.** CI renders them and ships them in the site's assets, re-rendering only when their inputs change (a cache keyed by the inputs' hash).
- **Live embed:** `learn.seply.app/e/:id/embed?view=<id>` renders one public View read-only without the app's chrome, and allows framing only from `seply.app` (`frame-ancestors`). Private and unlisted Expeditions never render there.

## 9.4 Showcases

The public Examples are *AI compute and model internals*, *E-bike for the commute* and *A week on the Swiss rail loop*, owned by the owner's account and set to public. They are tidied through the `seply-learn` MCP server from Claude Code (not the instance AI key): failed Views rebuilt, summaries written, and Swiss rail grown into a complete trip and no longer marked as a test.
