// The app's fonts (Fontsource, through @seply/ui/globals.css) load on first
// use; every frame waits until all three faces are ready.
import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";

const FACES = ['400 16px "IBM Plex Sans Variable"', '600 16px "IBM Plex Sans Variable"', '400 16px "IBM Plex Mono"', '500 16px "Newsreader Variable"'];

export function useFonts() {
  const [handle] = useState(() => delayRender("Fonts"));
  useEffect(() => {
    Promise.all(FACES.map((f) => document.fonts.load(f)))
      .then(() => document.fonts.ready)
      .then(() => continueRender(handle));
  }, [handle]);
}
