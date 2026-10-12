// A self-settling View (Map, Timeline) drawn by the real renderer: the frame
// waits until it reports itself drawn.
import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";
import { ViewRenderer, type Expedition, type View } from "@seply/views";

// The Map draws the bundled coarse world (Natural Earth) under an empty
// style: no tiles and no network, so every render is the same.
const EMPTY_STYLE = `data:application/json,${encodeURIComponent(JSON.stringify({ version: 8, sources: {}, layers: [] }))}`;
const basemap = { fallbackStyle: { light: EMPTY_STYLE, dark: EMPTY_STYLE } };
const noop = () => {};

export function SettledView({ expedition, view }: { expedition: Expedition; view: View }) {
  const [handle] = useState(() => delayRender(`${view.viewType} View`, { timeoutInMilliseconds: 60_000 }));
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done) continueRender(handle);
  }, [done, handle]);
  // Never leave a frame waiting if the View unmounts first.
  useEffect(() => () => continueRender(handle), [handle]);
  return <ViewRenderer expedition={expedition} view={view} onSelect={noop} transitionMs={0} basemap={basemap} onSettled={() => setDone(true)} />;
}
