// The explainer: seven scenes over 60 s (spec 9.3). Light theme, captions
// burned in unless `captions` is off (the hero loop and the poster).
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import "./style.css";
import { AppScenes } from "./App.tsx";
import { Backdrop, Captions } from "./chrome.tsx";
import { End } from "./End.tsx";
import { useFonts } from "./Fonts.tsx";
import { Intro } from "./Intro.tsx";
import { FPS, HERO, SCENES } from "./timing.ts";
import { tween } from "./anim.ts";

export type ExplainerProps = { captions: boolean };

export function Explainer({ captions }: ExplainerProps) {
  useFonts();
  const frame = useCurrentFrame();
  const t = frame / FPS;
  return (
    <Backdrop>
      {t < SCENES.concepts.from / FPS && <Intro />}
      {t >= 12.9 && t < SCENES.end.from / FPS && <AppScenes />}
      {t >= SCENES.end.from / FPS - 0.1 && <End at={SCENES.end.from / FPS} />}
      {captions && <Captions />}
    </Backdrop>
  );
}

/** The 12 s hero loop: scenes 3-4 without captions, faded at both ends so it loops cleanly. */
export function HeroLoop() {
  const frame = useCurrentFrame();
  const fade = Math.min(tween(frame, 0, 0.3), 1 - tween(frame, HERO.duration / FPS - 0.3, 0.3));
  return (
    <Backdrop>
      <AbsoluteFill style={{ opacity: fade }}>
        <Sequence from={-HERO.from} layout="none">
          <Explainer captions={false} />
        </Sequence>
      </AbsoluteFill>
    </Backdrop>
  );
}
