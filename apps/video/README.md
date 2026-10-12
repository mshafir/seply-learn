# video

**Lane:** C: Views

The explainer video for the landing site (spec [9.3](../../docs/spec/v1/09-landing-site.md#93-media), WP-7.4): about 60 seconds of motion graphics, 1920 × 1080 at 30 fps, captions burned in and in a WebVTT file, no voiceover. Made with [Remotion](https://www.remotion.dev) 4.0.527 (pinned).

## Contract

- **Product visuals are the real renderers.** Every View on screen is drawn by `@seply/views` from committed fixtures, imported the way a first build imports a file (`@seply/domain` `importExpeditionJson`, then `expeditionFromState`). Canvas Views use the package's own Concept cards and lines (`nodeTypes`, `edgeTypes`, `buildEdges`) at positions from its pure `layout` (ELK); the Comparison Table, Timeline and Map are the package's components as they are. No screen recordings.
- **The app's look.** `@seply/ui` tokens and fonts (`globals.css`), the `Wordmark` and `SeplyGlyph`, and its shadcn components (Tabs, Badge, Button, Avatar). Light theme, flat, no gradients. Amber (`--suggested`) appears only on the agent's suggestion.
- **Motion is a function of the frame.** The app's Canvas tweens with a timer; here each frame computes where every Concept is (eased moves of 300-500 ms between real layouts), so any frame renders the same on its own. CSS transitions and animations are switched off (`src/style.css`).
- **Data:** `packages/domain/fixtures/ebike.json` (synthetic: three made-up bikes, five criteria, two topics, a Learning path and a Comparison Table) for the question-led scenes, and `trip.json` (the synthetic Swiss rail week) for the Timeline and Map. The Map draws `@seply/views`' bundled coarse world under an empty style, so a render never touches the network.
- **Size:** the compositions are laid out at 1280 × 720 CSS pixels, so the app's UI reads at a sensible size, and rendered at `scale: 1.5` to 1920 × 1080 (sharp, including the map's WebGL canvas).

## Storyboard

Times and captions live in `src/timing.ts`; the burned-in captions and `explainer.vtt` both come from it.

| # | Time | Scene | Drawn with |
|---|---|---|---|
| 1 | 0-7 s | A question is typed into a box: "Which e-bike gets me up the hills on my commute?", with "In Seply Learn" and "From your agent, over MCP" | `@seply/ui` Button, Badge |
| 2 | 7-13 s | A chat card and a link card slide in beside it, marked Optional | `@seply/ui` Badge |
| 3 | 13-24 s | The Learning path builds up: Concept cards appear in reading order and their Relationships draw; "Torque (Nm)" shows its Source | `@seply/views` layout, cards, lines |
| 4 | 24-38 s | The bikes glide into the Comparison Table; then the Timeline and the Map of the rail trip | `ComparisonTable`, `ViewRenderer` (Timeline, Map) |
| 5 | 38-48 s | A dashed amber "Torque sensor" and its line appear, "Suggested by the agent"; the layout reflows; a cursor accepts it and it turns solid | the cards' `suggested` state, a reflow between two real layouts |
| 6 | 48-55 s | Maya's and Jonas's cursors move over the View; History gains a new Change | |
| 7 | 55-60 s | Glyph and wordmark, "Turn questions into something you can read and come back to.", seply.app | `Wordmark` |

## Commands

- `pnpm --filter video render`: renders everything into `apps/video/out/` (git-ignored) and fails if the full video's MP4 and WebM come to more than 6 MB together. Set `REMOTION_BROWSER_EXECUTABLE` to use a local Chrome headless shell; otherwise Remotion downloads its own.
- `pnpm --filter video render --stills 90,700,1290`: only those frames of the full video, as PNGs in `out/stills/`. The quick way to check a change.
- `pnpm --filter video studio`: Remotion Studio, to scrub through the compositions.
- `pnpm --filter video test`: the storyboard clock and the WebVTT writer.

## Outputs, CI and the site

**Colour.** Both codecs render with `colorSpace: "bt709"` and `pixelFormat: "yuv420p"`, so `ffmpeg -i` reports `yuv420p(tv, bt709, progressive)`. Remotion's default left them full range (`pc`) with untagged primaries, which hardware decoders in Chrome-family browsers drew as blank white or garbled frames. The posters are WebP, whose lossy format is always BT.601 limited range (`ffmpeg -i` says `tv, bt470bg`); browsers decode them as images, not through the video decoder.

`out/` uses the site's file names (`apps/site/src/media.ts`), so the files go into `apps/site/public/media/video/` as they are:

| File | What |
|---|---|
| `explainer.mp4` | The full video, H.264 (yuv420p, limited range, tagged BT.709), 1920 × 1080, 30 fps, captions burned in, no audio track, `moov` first (faststart) |
| `explainer.webm` | The same, VP9 (yuv420p, limited range, tagged BT.709) |
| `explainer.vtt` | WebVTT captions for it (also burned in; note the site's `<track>` is `default`, so a player may show both) |
| `explainer-poster.webp` | The poster frame (23 s: the Learning path fully drawn), no captions; also `.png` |
| `hero-loop.mp4`, `hero-loop.webm` | The 12 s hero loop: scenes 3-4 (14-26 s) without captions, faded at both ends so it loops cleanly. Muted |
| `hero-loop-poster.webp` | Its poster (the same frame) |
| `manifest.json` | `{ width, height, fps, duration, hero: { start, duration }, files: { name: bytes } }` |

**Rendered only when the inputs change.** `.github/actions/explainer-video` restores the render cached under `explainer-video-v2-<hash>` (the v2 changes to force a re-render; the hash is of `apps/video`, `packages/views`, `packages/ui` and `packages/domain/fixtures`), renders and saves it on a miss, and copies the files where it's told. It runs in:

- **CI** (`ci.yml`, "Explainer video"): renders on a miss and uploads the files as the `explainer-video` artifact (30 days).
- **The site's preview and production deploys** (`preview.yml`): copies them into `apps/site/public/media/video/` before `astro build`. Production runs after CI passed on main, so its render is always cached; a preview that gets there before CI's render renders it itself.

## Licence

Remotion is **source-available, not open source**. Its [licence](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) lets individuals, non-profits and for-profit organisations with up to 3 employees use it for free, commercially too; larger for-profit organisations need a paid Company License ([remotion.pro](https://www.remotion.pro/license)). Seply qualifies for the free licence today; re-check this before the team grows past three. If that changes, the fallback is to drive the same React scenes frame by frame in Playwright and encode with ffmpeg.

## Allowed dependencies

@seply/ui, @seply/views, @seply/domain (apps compose packages; `pnpm check:deps`).
