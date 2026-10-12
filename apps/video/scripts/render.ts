// Renders the explainer and its cuts into out/ (git-ignored):
//
//   explainer.mp4   H.264, 1920 × 1080, 30 fps, captions burned in
//   explainer.webm  VP9, the same
//   hero.mp4        the 12 s muted hero loop (scenes 3-4, no captions)
//   hero.webm
//   poster.png      the poster frame (also poster.webp)
//   captions.vtt    WebVTT captions for the full video
//   manifest.json   what was rendered: files, sizes, durations
//
// `pnpm --filter video render`; `pnpm --filter video render --stills 90,600`
// renders only those frames of the full video, to out/stills/. REMOTION_BROWSER_EXECUTABLE points it at a
// local Chrome; otherwise Remotion downloads its own headless shell.
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition, type Codec } from "@remotion/renderer";
import { enableTailwind } from "@remotion/tailwind-v4";
import { DURATION, FPS, HERO, POSTER_FRAME, toWebVtt } from "../src/timing.ts";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const out = here("../out/");
mkdirSync(out, { recursive: true });

/** 1280 × 720 compositions, scaled to 1920 × 1080. */
const SCALE = 1.5;
/** The full video's two files must stay under 6 MB together (spec 9.3). */
const BUDGET = 6 * 1024 * 1024;

const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
// MapLibre (the Map scene) needs WebGL; ANGLE gives it one in headless Chrome.
const chromiumOptions = { gl: "angle" as const };

console.log("Bundling…");
const serveUrl = await bundle({
  entryPoint: here("../src/index.ts"),
  webpackOverride: (config) => enableTailwind(config),
});

const kb = (file: string) => `${Math.round(statSync(out + file).size / 1024)} KB`;

const stillsArg = process.argv.indexOf("--stills");
if (stillsArg > 0) {
  const frames = (process.argv[stillsArg + 1] ?? "").split(",").map(Number);
  const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps: { captions: true }, browserExecutable, chromiumOptions });
  mkdirSync(out + "stills", { recursive: true });
  for (const frame of frames) {
    const file = `stills/frame-${String(frame).padStart(4, "0")}.png`;
    await renderStill({ serveUrl, composition, inputProps: { captions: true }, frame, output: out + file, scale: SCALE, browserExecutable, chromiumOptions });
    console.log(file);
  }
  process.exit(0);
}

async function video(id: string, file: string, codec: Codec, inputProps: Record<string, unknown>) {
  const composition = await selectComposition({ serveUrl, id, inputProps, browserExecutable, chromiumOptions });
  const started = Date.now();
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec,
    outputLocation: out + file,
    scale: SCALE,
    muted: true,
    // Flat motion graphics compress well; these keep the full video near 2 MB a file.
    crf: codec === "h264" ? 28 : 40,
    ...(codec === "h264" ? { x264Preset: "slow" as const, pixelFormat: "yuv420p" as const } : {}),
    browserExecutable,
    chromiumOptions,
    onProgress: ({ progress }) => process.stdout.write(`\r${file} ${Math.round(progress * 100)}%`),
  });
  console.log(`\r${file}: ${kb(file)} in ${Math.round((Date.now() - started) / 1000)} s`);
}

await video("Explainer", "explainer.mp4", "h264", { captions: true });
await video("Explainer", "explainer.webm", "vp9", { captions: true });
await video("HeroLoop", "hero.mp4", "h264", {});
await video("HeroLoop", "hero.webm", "vp9", {});

const explainer = await selectComposition({ serveUrl, id: "Explainer", inputProps: { captions: false }, browserExecutable, chromiumOptions });
for (const imageFormat of ["png", "webp"] as const) {
  await renderStill({
    serveUrl,
    composition: explainer,
    inputProps: { captions: false },
    frame: POSTER_FRAME,
    output: out + `poster.${imageFormat}`,
    imageFormat,
    scale: SCALE,
    browserExecutable,
    chromiumOptions,
  });
  console.log(`poster.${imageFormat}: ${kb(`poster.${imageFormat}`)}`);
}

writeFileSync(out + "captions.vtt", toWebVtt());

const files = ["explainer.mp4", "explainer.webm", "hero.mp4", "hero.webm", "poster.png", "poster.webp", "captions.vtt"];
const manifest = {
  width: 1920,
  height: 1080,
  fps: FPS,
  duration: DURATION / FPS,
  hero: { start: HERO.from / FPS, duration: HERO.duration / FPS },
  files: Object.fromEntries(files.map((f) => [f, statSync(out + f).size])),
};
writeFileSync(out + "manifest.json", JSON.stringify(manifest, null, 2) + "\n");

const full = manifest.files["explainer.mp4"] + manifest.files["explainer.webm"];
console.log(`explainer.mp4 + explainer.webm: ${(full / 1024 / 1024).toFixed(2)} MB (budget 6 MB)`);
if (full > BUDGET) {
  console.error("Over the 6 MB budget: raise the crf in scripts/render.ts.");
  process.exit(1);
}
