// The Learning path layouts the canvas scenes draw, computed by @seply/views'
// own pure layout (ELK) once per render tab, behind delayRender.
import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";
import {
  layout,
  learningMap,
  learningPathOverlay,
  topicRoots,
  type Expedition,
  type LearningMap,
  type Overlay,
  type Positions,
  type View,
} from "@seply/views";
import { ebike, ebikeWithSuggestion } from "./data.ts";

export type PathLayout = { map: LearningMap; overlay: Overlay; positions: Positions };

const learnView = ebike.view("learn") as Extract<View, { viewType: "learning-path" }>;
export { learnView };

async function pathLayout(expedition: Expedition): Promise<PathLayout> {
  const map = learningMap(expedition, learnView.settings);
  // Every step shown, as with "Show all steps": the video has no reader to focus one.
  const overlay = learningPathOverlay(map, undefined, { known: new Set(), showAll: true, readingStatus: true });
  const { positions } = await layout(map.scope, learnView, {
    hidden: overlay.hidden,
    bridges: overlay.bridges,
    topics: topicRoots(expedition),
  });
  return { map, overlay, positions };
}

export type Layouts = { base: PathLayout; suggested: PathLayout };

let pending: Promise<Layouts> | undefined;
const loadLayouts = () =>
  (pending ??= Promise.all([pathLayout(ebike.expedition), pathLayout(ebikeWithSuggestion)]).then(([base, suggested]) => ({
    base,
    suggested,
  })));

/** The layouts, once ELK has run; the frame waits for them. */
export function useLayouts(): Layouts | undefined {
  const [handle] = useState(() => delayRender("Learning path layouts"));
  const [layouts, setLayouts] = useState<Layouts>();
  useEffect(() => {
    loadLayouts().then((l) => {
      setLayouts(l);
      continueRender(handle);
    });
  }, [handle]);
  return layouts;
}
