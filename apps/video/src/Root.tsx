// The compositions. They are laid out at 1280 × 720 CSS pixels, so the app's
// UI reads at a sensible size; the renderer scales by 1.5 to 1920 × 1080.
// The poster is a still of Explainer (POSTER_FRAME, captions off).
import { Composition } from "remotion";
import { Explainer, HeroLoop } from "./Explainer.tsx";
import { FRAME } from "./chrome.tsx";
import { DURATION, FPS, HERO } from "./timing.ts";

export function Root() {
  return (
    <>
      <Composition id="Explainer" component={Explainer} durationInFrames={DURATION} fps={FPS} {...FRAME} defaultProps={{ captions: true }} />
      <Composition id="HeroLoop" component={HeroLoop} durationInFrames={HERO.duration} fps={FPS} {...FRAME} />
    </>
  );
}
